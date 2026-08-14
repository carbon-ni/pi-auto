/**
 * AutoLoop — owns the mutable state and timer lifecycle for `/auto`.
 *
 * Depends on an injected `send` callback plus a `LoopPort` (a structural slice of
 * the extension command/tool context). This keeps it free of any SDK runtime
 * import, so it is unit-testable with a plain object and fake timers.
 *
 * Lifecycle:
 * - `attach(port)` binds the current command/tool context. Call it from every
 *   handler before operating — the port carries `isIdle` and `notify`.
 * - `detach()` is a silent teardown for `session_shutdown`: the captured port
 *   goes stale when the session is replaced, so the loop must stop without
 *   touching it. No notification.
 *
 * Busy model:
 * - `port.isIdle()` is only false while the harness runs the LLM turn. It stays
 *   TRUE during pre-prompt auto-compaction and manual `/compact`, so polling it
 *   alone lets the loop send while the harness is compacting — pi then throws
 *   and drops the message. Compaction is tracked via extension events instead:
 *   `session_before_compact` / `session_compact`.
 * - `sendPending` is true from the moment a message is sent until the whole
 *   turn settles (`agent_settled`, pi >= 0.84.1). This closes the gap where
 *   `isIdle()` is true but the harness is still busy — e.g. between the end of
 *   compaction and the run start.
 */

import { formatAutoStatus } from '../lib/auto-helpers.js';

const POLL_INTERVAL_MS = 250;

// Safety net: if compaction never reports completion (e.g. a manual /compact
// that was aborted), the loop would wait forever. These bounds resume it with
// a warning. They are generous on purpose — clearing early would re-enter the
// compaction race this guard exists to prevent.
const COMPACTION_STALE_MS = 10 * 60 * 1000;

// A sent message normally produces a turn that ends with an `agent_settled`
// event. If the turn never starts (e.g. auth failure), resume after this long.
const SEND_PENDING_STALE_MS = 10 * 60 * 1000;

const DEFAULT_STATUS_KEY = 'pi-auto';

export type NotifyLevel = 'info' | 'warning' | 'error';

export type LoopPort = {
  isIdle(): boolean;
  ui: {
    notify(message: string, level?: NotifyLevel): void;
    setStatus(key: string, text: string | undefined): void;
  };
};

type AutoRun = {
  message: string;
  deferredMessage?: string;
  remaining: number;
  total: number;
};

export class AutoLoop {
  private port?: LoopPort;
  private timer?: NodeJS.Timeout;
  private run?: AutoRun;
  private latestSteering?: string;
  private steeringToReplace?: string;

  /** True while the harness is compacting (auto or manual). Gates sends. */
  private compacting = false;
  private compactingSince?: number;

  /**
   * True from the moment a message is sent until its turn fully settles
   * (`agent_settled`). Prevents sending the next message while the harness is
   * still busy even though `isIdle()` already reports true.
   */
  private sendPending = false;
  private sendSince?: number;

  constructor(
    private readonly send: (message: string) => void,
    private readonly statusKey = DEFAULT_STATUS_KEY,
  ) {}

  attach(port: LoopPort): void {
    this.port = port;
  }

  /** Silent teardown — used on session_shutdown. Does not notify. */
  detach(): void {
    this.clearTimer();
    this.run = undefined;
    this.latestSteering = undefined;
    this.steeringToReplace = undefined;
    this.compacting = false;
    this.compactingSince = undefined;
    this.sendPending = false;
    this.sendSince = undefined;
    this.port = undefined;
  }

  /** The harness started compacting (auto or manual). Block sends until it ends. */
  onCompactionStart(): void {
    this.compacting = true;
    this.compactingSince = Date.now();
    if (this.run && this.port) {
      this.port.ui.notify(
        'Auto mode: waiting for compaction to finish...',
        'info',
      );
    }
  }

  /** Compaction reported completion (session_compact). Safe to resume once idle. */
  onCompactionEnd(): void {
    this.compacting = false;
    this.compactingSince = undefined;
    if (this.run && this.port) {
      this.port.ui.notify(
        'Auto mode: compaction finished, continuing.',
        'info',
      );
    }
  }

  /**
   * The full turn settled (pi `agent_settled`): run, retries, and post-run
   * auto-compaction are all done. Clears the pending-send guard and any stale
   * compaction flag (compaction that failed without a `session_compact`).
   */
  onAgentSettled(): void {
    this.sendPending = false;
    this.sendSince = undefined;
    this.compacting = false;
    this.compactingSince = undefined;
  }

  isRunning(): boolean {
    return Boolean(this.run || this.timer);
  }

  start(message: string, count: number): void {
    this.clearTimer();
    this.run = { message, remaining: count, total: count };
    // A pending send belongs to a previous run; a fresh run may send at once.
    // `compacting` is intentionally NOT reset — a compaction in flight when the
    // run starts must still gate the first send.
    this.sendPending = false;
    this.sendSince = undefined;
    this.port?.ui.notify(
      `Auto mode: sending "${message}" ${count} time(s).`,
      'info',
    );
    this.setStatus(0, count);
    this.timer = setTimeout(() => this.tick(), 0);
  }

  /** Stops the loop. Returns whether a run was active; notifies only if it was. */
  stop(): boolean {
    const wasRunning = this.isRunning();
    this.clearTimer();
    this.run = undefined;
    if (wasRunning) {
      this.port?.ui.notify('Auto mode stopped.', 'info');
      this.clearStatus();
    }
    return wasRunning;
  }

  /** Updates the remaining count and message for future sends. */
  edit(message: string, count: number): boolean {
    if (!this.run) return false;
    this.run.message = message;
    this.run.remaining = count;
    this.run.total = count;
    this.run.deferredMessage = undefined;
    this.setStatus(0, count);
    return true;
  }

  /** Uses a message only for the final unsent round. */
  defer(message: string): boolean {
    if (!this.run || this.run.remaining < 1) return false;
    this.run.deferredMessage = message;
    return true;
  }

  /** Removes and returns the message deferred for the final unsent round. */
  removeDeferred(): string | undefined {
    if (!this.run?.deferredMessage) return undefined;
    const message = this.run.deferredMessage;
    this.run.deferredMessage = undefined;
    return message;
  }

  rememberSteering(message: string): boolean {
    this.latestSteering = message;
    return true;
  }

  deferLatestSteering():
    { message: string; target: 'auto' | 'followUp' } | undefined {
    if (!this.latestSteering) return undefined;

    const message = this.latestSteering;
    this.latestSteering = undefined;
    this.steeringToReplace = message;

    if (this.run && this.run.remaining > 0) {
      this.run.deferredMessage = message;
      return { message, target: 'auto' };
    }

    return { message, target: 'followUp' };
  }

  consumeDeferredSteering(message: string): boolean {
    if (this.steeringToReplace !== message) return false;
    this.steeringToReplace = undefined;
    return true;
  }

  forgetSteering(message: string): void {
    if (this.latestSteering === message) this.latestSteering = undefined;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setStatus(sent: number, total: number): void {
    this.port?.ui.setStatus(this.statusKey, formatAutoStatus(sent, total));
  }

  private clearStatus(): void {
    this.port?.ui.setStatus(this.statusKey, undefined);
  }

  private tick(): void {
    if (!this.run || !this.port) {
      this.clearTimer();
      this.run = undefined;
      this.clearStatus();
      return;
    }

    if (this.run.remaining < 1) {
      this.clearTimer();
      this.run = undefined;
      this.port.ui.notify('Auto mode complete.', 'info');
      this.clearStatus();
      return;
    }

    this.recoverStaleState();

    // Busy means: the harness is streaming/processing, compacting, or a sent
    // message has not settled yet. Only send when all three are clear.
    if (!this.port.isIdle() || this.compacting || this.sendPending) {
      this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
      return;
    }

    const message =
      this.run.remaining === 1 && this.run.deferredMessage
        ? this.run.deferredMessage
        : this.run.message;
    this.run.remaining -= 1;
    this.sendPending = true;
    this.sendSince = Date.now();
    this.send(message);
    this.setStatus(this.run.total - this.run.remaining, this.run.total);
    this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
  }

  /**
   * Safety net for signals that never arrive: a compaction that did not report
   * completion (e.g. an aborted manual /compact) or a send that never produced
   * a turn (e.g. auth failure). Resumes with a warning instead of waiting
   * forever. The busy gates are re-checked after recovery, so a still-running
   * compaction still blocks the send.
   */
  private recoverStaleState(): void {
    const now = Date.now();

    if (
      this.compacting &&
      this.compactingSince !== undefined &&
      now - this.compactingSince > COMPACTION_STALE_MS
    ) {
      this.compacting = false;
      this.compactingSince = undefined;
      this.port?.ui.notify(
        'Auto mode: compaction did not report completion; resuming.',
        'warning',
      );
    }

    if (
      this.sendPending &&
      this.sendSince !== undefined &&
      (this.port?.isIdle() ?? false) &&
      !this.compacting &&
      now - this.sendSince > SEND_PENDING_STALE_MS
    ) {
      this.sendPending = false;
      this.sendSince = undefined;
      this.port?.ui.notify(
        'Auto mode: last message produced no response; continuing.',
        'warning',
      );
    }
  }
}
