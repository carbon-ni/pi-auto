import { describe, expect, it, vi } from "vitest";

import { AutoLoop, type LoopPort } from "./auto-loop.js";

function createPort(isIdle = true): LoopPort {
  return {
    isIdle: () => isIdle,
    ui: { notify: vi.fn() },
  };
}

describe("AutoLoop", () => {
  it("is not running before start", () => {
    const loop = new AutoLoop(vi.fn());
    expect(loop.isRunning()).toBe(false);
  });

  it("notifies and sends immediately when idle", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    const port = createPort(true);
    loop.attach(port);

    loop.start("go", 1);
    expect(port.ui.notify).toHaveBeenCalledWith(
      'Auto mode: sending "go" 1 time(s).',
      "info",
    );

    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenCalledWith("go");

    vi.useRealTimers();
  });

  it("sends the message N times then completes", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    const port = createPort(true);
    loop.attach(port);

    loop.start("go", 3);

    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(3);
    expect(loop.isRunning()).toBe(false);
    expect(port.ui.notify).toHaveBeenCalledWith("Auto mode complete.", "info");

    vi.useRealTimers();
  });

  it("waits when not idle, then sends once idle", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    let idle = false;
    const port: LoopPort = { isIdle: () => idle, ui: { notify: vi.fn() } };
    const loop = new AutoLoop(send);
    loop.attach(port);

    loop.start("go", 1);
    vi.advanceTimersByTime(0);
    expect(send).not.toHaveBeenCalled();

    idle = true;
    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("stop returns true, notifies stopped and halts a running loop", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    const port = createPort(true);
    loop.attach(port);

    loop.start("go", 10);
    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenCalledTimes(1);

    expect(loop.stop()).toBe(true);
    expect(port.ui.notify).toHaveBeenCalledWith("Auto mode stopped.", "info");

    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(loop.isRunning()).toBe(false);

    vi.useRealTimers();
  });

  it("stop returns false and does not notify when nothing is running", () => {
    const send = vi.fn();
    const port = createPort();
    const loop = new AutoLoop(send);
    loop.attach(port);

    expect(loop.stop()).toBe(false);
    expect(port.ui.notify).not.toHaveBeenCalled();
  });

  it("edit updates the remaining count and message used by future sends", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    loop.attach(createPort(true));

    loop.start("first", 3);
    vi.advanceTimersByTime(0);

    expect(loop.edit("second", 2)).toBe(true);
    vi.advanceTimersByTime(500);

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(send).toHaveBeenNthCalledWith(3, "second");

    vi.useRealTimers();
  });

  it("edit returns false when nothing is running", () => {
    const loop = new AutoLoop(vi.fn());
    expect(loop.edit("x", 1)).toBe(false);
  });

  it("defers a message until the final round", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    loop.attach(createPort(true));

    loop.start("continue", 3);
    vi.advanceTimersByTime(0);

    expect(loop.defer("final task")).toBe(true);
    vi.advanceTimersByTime(500);

    expect(send).toHaveBeenNthCalledWith(1, "continue");
    expect(send).toHaveBeenNthCalledWith(2, "continue");
    expect(send).toHaveBeenNthCalledWith(3, "final task");

    vi.useRealTimers();
  });

  it("defer returns false when nothing is running", () => {
    const loop = new AutoLoop(vi.fn());
    expect(loop.defer("final task")).toBe(false);
  });

  it("defers the latest observed steering message and replaces it once", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    loop.attach(createPort(true));

    loop.start("continue", 2);
    vi.advanceTimersByTime(0);

    expect(loop.rememberSteering("final task")).toBe(true);
    expect(loop.deferLatestSteering()).toEqual({
      message: "final task",
      target: "auto",
    });
    expect(loop.consumeDeferredSteering("other task")).toBe(false);
    expect(loop.consumeDeferredSteering("final task")).toBe(true);
    expect(loop.consumeDeferredSteering("final task")).toBe(false);

    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenNthCalledWith(1, "continue");
    expect(send).toHaveBeenNthCalledWith(2, "final task");

    vi.useRealTimers();
  });

  it("forgets observed steering once it is delivered normally", () => {
    const loop = new AutoLoop(vi.fn());
    loop.attach(createPort(false));
    loop.start("continue", 2);

    loop.rememberSteering("already delivered");
    loop.forgetSteering("already delivered");

    expect(loop.deferLatestSteering()).toBeUndefined();
  });

  it("defers observed steering without a running auto mode", () => {
    const loop = new AutoLoop(vi.fn());

    expect(loop.rememberSteering("final task")).toBe(true);
    expect(loop.deferLatestSteering()).toEqual({
      message: "final task",
      target: "followUp",
    });
    expect(loop.consumeDeferredSteering("final task")).toBe(true);
  });

  it("cannot defer when no steering message was observed", () => {
    const loop = new AutoLoop(vi.fn());
    expect(loop.deferLatestSteering()).toBeUndefined();
    expect(loop.consumeDeferredSteering("final task")).toBe(false);
  });

  it("start cancels a prior run and starts fresh", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    loop.attach(createPort(true));

    loop.start("a", 2);
    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenNthCalledWith(1, "a");

    loop.start("b", 1);
    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenNthCalledWith(2, "b");
    expect(send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(2);
    expect(loop.isRunning()).toBe(false);

    vi.useRealTimers();
  });

  it("detach silently tears down a running loop without notifying", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const port = createPort(true);
    const loop = new AutoLoop(send);
    loop.attach(port);

    loop.start("go", 5);
    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenCalledTimes(1);

    loop.detach();

    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(loop.isRunning()).toBe(false);
    expect(port.ui.notify).not.toHaveBeenCalledWith("Auto mode stopped.", "info");
    expect(port.ui.notify).not.toHaveBeenCalledWith("Auto mode complete.", "info");

    vi.useRealTimers();
  });

  it("can start again after detach", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const loop = new AutoLoop(send);
    loop.attach(createPort(true));

    loop.start("go", 2);
    vi.advanceTimersByTime(0);
    loop.detach();

    loop.attach(createPort(true));
    loop.start("again", 1);
    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenLastCalledWith("again");

    vi.useRealTimers();
  });
});
