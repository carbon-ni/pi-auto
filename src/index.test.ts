import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import autoExtension, { getLastUserMessageText, parseAutoArgs } from "./index.js";

describe("package config", () => {
  it("declares pi extension entrypoint for directory loading", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      pi?: { extensions?: string[] };
    };

    expect(packageJson.pi?.extensions).toContain("./src/index.ts");
  });
});

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
});

describe("auto command", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createHarness() {
    const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
    const sentMessages: string[] = [];
    const notifications: string[] = [];
    const pi = {
      registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
        commands.set(name, command);
      }),
      sendUserMessage: vi.fn((message: string) => {
        sentMessages.push(message);
      }),
    };
    const ctx = {
      isIdle: vi.fn(() => true),
      sessionManager: { getBranch: vi.fn(() => []) },
      ui: { notify: vi.fn((message: string) => notifications.push(message)) },
    };

    autoExtension(pi as any);

    return { autoCommand: commands.get("auto")!, autoEditCommand: commands.get("auto-edit")!, ctx, notifications, sentMessages };
  }

  it("edits the running auto message for future sends", async () => {
    const { autoCommand, autoEditCommand, ctx, sentMessages } = createHarness();

    await autoCommand.handler("3 first", ctx);
    await vi.advanceTimersByTimeAsync(1);

    await autoEditCommand.handler("second", ctx);
    await vi.advanceTimersByTimeAsync(500);

    expect(sentMessages).toEqual(["first", "second", "second"]);
  });

  it("rejects editing auto message when auto mode is not running", async () => {
    const { autoEditCommand, ctx, notifications } = createHarness();

    await autoEditCommand.handler("second", ctx);

    expect(notifications).toContain("Auto mode is not running. Start it with /auto <count> [message].");
  });
});
