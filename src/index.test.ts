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
  return {
    registerCommand: vi.fn((name, cmd) => {
      commands[name] = cmd;
    }),
    sendUserMessage: vi.fn(),
    _commands: commands,
  };
}

function createMockCtx(isIdle = true, branch: unknown[] = []) {
  return {
    ui: { notify: vi.fn() },
    isIdle: () => isIdle,
    sessionManager: { getBranch: () => branch },
  };
}

describe("registerAutoCommand", () => {
  it("registers the auto command", () => {
    const pi = createMockPi();
    registerAutoCommand(pi as any);
    expect(pi.registerCommand).toHaveBeenCalledWith("auto", expect.any(Object));
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

    // tick(0) fires
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

    // First send at tick(0)
    vi.advanceTimersByTime(0);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

    // Advance through remaining ticks (250ms each: poll + send)
    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(3);

    // No more sends after count exhausted
    vi.advanceTimersByTime(250);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(3);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Auto mode complete.", "info");

    vi.useRealTimers();
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
    // Not idle — timer re-schedules without sending
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(0);

    // Become idle
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

    // Stop it
    await pi._commands.auto.handler("stop", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Auto mode stopped.", "info");

    // Advance time — no more sends
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
});
