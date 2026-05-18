import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getLastUserMessageText, parseAutoArgs } from "./index.js";

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
