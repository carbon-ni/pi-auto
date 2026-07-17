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
 */

const POLL_INTERVAL_MS = 250;

export type NotifyLevel = "info" | "warning" | "error";

export type LoopPort = {
  isIdle(): boolean;
  ui: { notify(message: string, level?: NotifyLevel): void };
};

type AutoRun = {
  message: string;
  deferredMessage?: string;
  remaining: number;
};

export class AutoLoop {
  private port?: LoopPort;
  private timer?: NodeJS.Timeout;
  private run?: AutoRun;
  private latestSteering?: string;
  private steeringToReplace?: string;

  constructor(private readonly send: (message: string) => void) {}

  attach(port: LoopPort): void {
    this.port = port;
  }

  /** Silent teardown — used on session_shutdown. Does not notify. */
  detach(): void {
    this.clearTimer();
    this.run = undefined;
    this.latestSteering = undefined;
    this.steeringToReplace = undefined;
    this.port = undefined;
  }

  isRunning(): boolean {
    return Boolean(this.run || this.timer);
  }

  start(message: string, count: number): void {
    this.clearTimer();
    this.run = { message, remaining: count };
    this.port?.ui.notify(
      `Auto mode: sending "${message}" ${count} time(s).`,
      "info",
    );
    this.timer = setTimeout(() => this.tick(), 0);
  }

  /** Stops the loop. Returns whether a run was active; notifies only if it was. */
  stop(): boolean {
    const wasRunning = this.isRunning();
    this.clearTimer();
    this.run = undefined;
    if (wasRunning) this.port?.ui.notify("Auto mode stopped.", "info");
    return wasRunning;
  }

  /** Updates the message for future sends. Returns whether a run was active. */
  edit(message: string): boolean {
    if (!this.run) return false;
    this.run.message = message;
    return true;
  }

  /** Uses a message only for the final unsent round. */
  defer(message: string): boolean {
    if (!this.run || this.run.remaining < 1) return false;
    this.run.deferredMessage = message;
    return true;
  }

  rememberSteering(message: string): boolean {
    this.latestSteering = message;
    return true;
  }

  deferLatestSteering():
    | { message: string; target: "auto" | "followUp" }
    | undefined {
    if (!this.latestSteering) return undefined;

    const message = this.latestSteering;
    this.latestSteering = undefined;
    this.steeringToReplace = message;

    if (this.run && this.run.remaining > 0) {
      this.run.deferredMessage = message;
      return { message, target: "auto" };
    }

    return { message, target: "followUp" };
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

  private tick(): void {
    if (!this.run || !this.port) {
      this.clearTimer();
      this.run = undefined;
      return;
    }

    if (this.run.remaining < 1) {
      this.clearTimer();
      this.run = undefined;
      this.port.ui.notify("Auto mode complete.", "info");
      return;
    }

    if (!this.port.isIdle()) {
      this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
      return;
    }

    const message =
      this.run.remaining === 1 && this.run.deferredMessage
        ? this.run.deferredMessage
        : this.run.message;
    this.run.remaining -= 1;
    this.send(message);
    this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
  }
}
