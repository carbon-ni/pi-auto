import { describe, expect, it, vi } from "vitest";
import { getLastUserMessageText, parseAutoArgs, textFromContent } from "./lib/auto-helpers.js";
import registerAutoCommand from "./infra/register-auto-command.js";

// --- lib/auto-helpers ---

describe("parseAutoArgs", () => {
  it("parses repeat count without message", () => {
    expect(parseAutoArgs("3")).toEqual({ count: 3, message: undefined });
  });

  it("parses repeat count with custom message", () => {
    expect(parseAutoArgs("3 keep going")).toEqual({
      count: 3,
      message: "keep going",
    });
  });

  it("rejects missing count", () => {
    expect(parseAutoArgs("")).toBeUndefined();
  });

  it("rejects invalid count", () => {
    expect(parseAutoArgs("abc keep going")).toBeUndefined();
  });

  it("rejects count below one", () => {
    expect(parseAutoArgs("0 keep going")).toBeUndefined();
  });

  it("rejects count exceeding upper bound", () => {
    expect(parseAutoArgs("101 go")).toBeUndefined();
    expect(parseAutoArgs("999999999 go")).toBeUndefined();
  });

  it("accepts count at upper bound (100)", () => {
    expect(parseAutoArgs("100 go")).toEqual({ count: 100, message: "go" });
  });
});

describe("textFromContent", () => {
  it("extracts text from string content", () => {
    expect(textFromContent("hello")).toBe("hello");
  });

  it("extracts text from structured content parts", () => {
    expect(
      textFromContent([{ type: "text", text: "hello" }, { type: "text", text: "world" }]),
    ).toBe("hello\nworld");
  });

  it("returns undefined for empty string", () => {
    expect(textFromContent("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(textFromContent("   ")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(textFromContent([])).toBeUndefined();
  });

  it("returns undefined for non-text parts", () => {
    expect(textFromContent([{ type: "image", url: "x" }])).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(textFromContent(null)).toBeUndefined();
  });
});

describe("getLastUserMessageText", () => {
  it("returns the latest user text message", () => {
    expect(
      getLastUserMessageText([
        { type: "message", message: { role: "user", content: [{ type: "text", text: "first" }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
        { type: "message", message: { role: "user", content: [{ type: "text", text: "last" }] } },
      ]),
    ).toBe("last");
  });

  it("ignores auto command messages if present", () => {
    expect(
      getLastUserMessageText([
        { type: "message", message: { role: "user", content: [{ type: "text", text: "previous task" }] } },
        { type: "message", message: { role: "user", content: [{ type: "text", text: "/auto 3" }] } },
      ]),
    ).toBe("previous task");
  });

  it("returns undefined when no previous user text exists", () => {
    expect(getLastUserMessageText([])).toBeUndefined();
  });

  it("skips entries with invalid structure", () => {
    expect(
      getLastUserMessageText([
        { type: "other" },
        { type: "message", message: { role: "user", content: [{ type: "text", text: "found" }] } },
      ]),
    ).toBe("found");
  });
});

// --- infra/register-auto-command ---

function createMockPi() {
  const commands: Record<string, { description: string; handler: Function }> = {};
  const tools: Record<string, { name: string; execute: Function }> = {};
  const handlers: Record<string, Function[]> = {};
  return {
    registerCommand: vi.fn((name, cmd) => {
      commands[name] = cmd;
    }),
    registerTool: vi.fn((def) => {
      tools[def.name] = def;
    }),
    on: vi.fn((event: string, handler: Function) => {
      (handlers[event] ??= []).push(handler);
    }),
    sendUserMessage: vi.fn(),
    _commands: commands,
    _tools: tools,
    _handlers: handlers,
  };
}

function emit(pi: ReturnType<typeof createMockPi>, event: string, payload: unknown) {
  for (const handler of pi._handlers[event] ?? []) handler(payload);
}

function createMockCtx(isIdle = true, branch: unknown[] = []) {
  return {
    ui: { notify: vi.fn() },
    isIdle: () => isIdle,
    sessionManager: { getBranch: () => branch },
  };
}

describe("registerAutoCommand", () => {
  it("registers the auto, auto-edit, and defer commands", () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    expect(pi.registerCommand).toHaveBeenCalledWith("auto", expect.any(Object));
    expect(pi.registerCommand).toHaveBeenCalledWith("auto-edit", expect.any(Object));
    expect(pi.registerCommand).toHaveBeenCalledWith("defer", expect.any(Object));
  });

  it("warns on invalid args", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx();
    await pi._commands.auto.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /auto <count> [message] | /auto stop", "warning");
  });

  it("warns when no message found", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true, []);
    await pi._commands.auto.handler("3", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No previous user message found. Usage: /auto <count> [message]",
      "warning",
    );
  });

  it("sends message immediately when idle", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true, [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } },
    ]);

    await pi._commands.auto.handler("1", ctx);

    vi.advanceTimersByTime(0);
    expect(pi.sendUserMessage).toHaveBeenCalledWith("go");

    vi.useRealTimers();
  });

  it("sends message N times when idle", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true, [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } },
    ]);

    await pi._commands.auto.handler("3", ctx);

    vi.advanceTimersByTime(0);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(3);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Auto mode complete.", "info");

    vi.useRealTimers();
  });

  it("edits the running auto message for future sends", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true);

    await pi._commands.auto.handler("3 first", ctx);
    vi.advanceTimersByTime(0);

    await pi._commands["auto-edit"].handler("second", ctx);
    vi.advanceTimersByTime(500);

    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(1, "first");
    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(2, "second");
    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(3, "second");

    vi.useRealTimers();
  });

  it("warns when editing auto message while auto mode is not running", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx();

    await pi._commands["auto-edit"].handler("second", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Auto mode is not running. Start it with /auto <count> [message].",
      "warning",
    );
  });

  it("warns when auto-edit message is empty", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx();

    await pi._commands["auto-edit"].handler("   ", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /auto-edit <message>", "warning");
  });

  it("sends a deferred message only on the final auto round", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true);

    await pi._commands.auto.handler("3 continue", ctx);
    vi.advanceTimersByTime(0);
    await pi._commands.defer.handler("final task", ctx);
    vi.advanceTimersByTime(500);

    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(1, "continue");
    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(2, "continue");
    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(3, "final task");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Deferred "final task" until the final auto round.',
      "info",
    );

    vi.useRealTimers();
  });

  it("queues an explicit deferred message as a follow-up without auto mode", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(false);

    await pi._commands.defer.handler("final task", ctx);

    expect(pi.sendUserMessage).toHaveBeenCalledWith("final task", {
      deliverAs: "followUp",
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Deferred "final task" as a follow-up.',
      "info",
    );
  });

  it("warns when an explicit defer has no active work", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true);

    await pi._commands.defer.handler("final task", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Nothing is running. Start work before deferring a message.",
      "warning",
    );
  });

  it("defers the latest queued steering message when no argument is given", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    let idle = true;
    const ctx = {
      ...createMockCtx(),
      isIdle: () => idle,
    };

    await pi._commands.auto.handler("2 continue", ctx);
    vi.advanceTimersByTime(0);

    idle = false;
    await pi._handlers.input[0](
      { text: "final task", source: "interactive" },
      ctx,
    );
    await pi._commands.defer.handler("", ctx);

    const steeringMessage = {
      role: "user",
      content: [{ type: "text", text: "final task" }],
      timestamp: 123,
    };
    const replacement = await pi._handlers.message_end[0](
      { type: "message_end", message: steeringMessage },
      ctx,
    );
    idle = true;
    vi.advanceTimersByTime(250);

    expect(replacement).toEqual({
      message: {
        ...steeringMessage,
        content: [{ type: "text", text: "continue" }],
      },
    });
    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(1, "continue");
    expect(pi.sendUserMessage).toHaveBeenNthCalledWith(2, "final task");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Deferred queued steering message "final task" until the final auto round.',
      "info",
    );

    vi.useRealTimers();
  });

  it("defers queued steering as a follow-up without auto mode", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(false);

    await pi._handlers.input[0](
      { text: "do this later", source: "interactive" },
      ctx,
    );
    await pi._commands.defer.handler("", ctx);

    const steeringMessage = {
      role: "user",
      content: [{ type: "text", text: "do this later" }],
      timestamp: 123,
    };
    const replacement = await pi._handlers.message_end[0](
      { type: "message_end", message: steeringMessage },
      ctx,
    );

    expect(replacement?.message.content).toEqual([
      { type: "text", text: "continue" },
    ]);
    expect(pi.sendUserMessage).toHaveBeenCalledWith("do this later", {
      deliverAs: "followUp",
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Deferred queued steering message "do this later" as a follow-up.',
      "info",
    );
  });

  it("does not record extension-generated auto messages as steering", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true);

    await pi._commands.auto.handler("2 continue", ctx);
    vi.advanceTimersByTime(0);
    await pi._handlers.input[0](
      { text: "continue", source: "extension" },
      ctx,
    );
    await pi._commands.defer.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No queued steering message found. Usage: /defer <message>",
      "warning",
    );

    vi.useRealTimers();
  });

  it("warns when defer has no argument or observed steering message", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx();

    await pi._commands.defer.handler("   ", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No queued steering message found. Usage: /defer <message>",
      "warning",
    );
  });

  it("waits when not idle then sends when idle", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    let idle = false;
    const ctx = {
      ui: { notify: vi.fn() },
      isIdle: () => idle,
      sessionManager: {
        getBranch: () => [
          { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } },
        ],
      },
    };

    await pi._commands.auto.handler("1", ctx);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(0);

    idle = true;
    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("stops auto on /auto stop", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true, [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } },
    ]);

    await pi._commands.auto.handler("10", ctx);
    vi.advanceTimersByTime(0);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    await pi._commands.auto.handler("stop", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Auto mode stopped.", "info");

    vi.advanceTimersByTime(1000);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("stops auto even if not running on /auto stop", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx();

    await pi._commands.auto.handler("stop", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No auto mode is running.", "warning");
  });

  it.each([
    "new",
    "fork",
    "resume",
    "reload",
    "quit",
  ] as const)(
    "stops the auto loop on session_shutdown reason=%s (captured ctx goes stale)",
    async (reason) => {
      vi.useFakeTimers();
      const pi = createMockPi();
      registerAutoCommand(pi as any);
      const ctx = createMockCtx(true, [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } },
      ]);

      await pi._commands.auto.handler("5", ctx);
      vi.advanceTimersByTime(0);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

      // Simulate the session being replaced (e.g. pi-context-pruner newSession/fork).
      // The captured command ctx is now stale; the tick loop must not run again.
      emit(pi, "session_shutdown", { type: "session_shutdown", reason });

      vi.advanceTimersByTime(10_000);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    },
  );

  it("can start auto again after session_shutdown", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true, [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } },
    ]);

    await pi._commands.auto.handler("2", ctx);
    vi.advanceTimersByTime(0);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    emit(pi, "session_shutdown", { type: "session_shutdown", reason: "new" });

    // Restart on the fresh session — new loop works.
    await pi._commands.auto.handler("1", ctx);
    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Auto mode complete.", "info");

    vi.useRealTimers();
  });
});

// --- auto_stop tool ---

describe("auto_stop tool", () => {
  it("registers the auto_stop tool", () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "auto_stop" }),
    );
  });

  it("stops a running auto loop", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx(true, [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } },
    ]);

    // Start auto with 10 iterations
    await pi._commands.auto.handler("10", ctx);
    vi.advanceTimersByTime(0);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    // Call auto_stop
    const result = await pi._tools.auto_stop.execute("id", {}, undefined, undefined, ctx);
    expect(result.content[0].text).toBe("Auto mode stopped.");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Auto mode stopped.", "info");

    // No more sends
    vi.advanceTimersByTime(1000);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("returns message when no auto loop is running", async () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    const ctx = createMockCtx();

    const result = await pi._tools.auto_stop.execute("id", {}, undefined, undefined, ctx);
    expect(result.content[0].text).toBe("No auto mode is running.");
  });
});
