/**
 * Extension registration — pure wiring.
 *
 * Builds one `AutoLoop` and binds the `/auto`, `/auto-edit` commands, the
 * `auto_stop` tool, and the `session_shutdown` lifecycle hook to it. All state
 * and timer logic lives in `AutoLoop`; this module only translates command
 * arguments and tool results.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import { getLastUserMessageText, parseAutoArgs } from "../lib/auto-helpers.js";
import { AutoLoop } from "./auto-loop.js";

export default function registerAutoCommand(pi: ExtensionAPI) {
  const loop = new AutoLoop((message) => pi.sendUserMessage(message));

  pi.registerTool({
    name: "auto_stop",
    label: "Auto Stop",
    description:
      "Stop the currently running /auto loop immediately. Call this when the task is complete before all iterations finish.",
    promptSnippet: "auto_stop() — stop the running /auto loop early",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      loop.attach(ctx);
      const wasRunning = loop.stop();
      return {
        content: [
          {
            type: "text" as const,
            text: wasRunning ? "Auto mode stopped." : "No auto mode is running.",
          },
        ],
        details: undefined,
      };
    },
  });

  // The captured port goes stale when another extension (or the user) swaps the
  // session via newSession/fork/switchSession/reload. Auto is bound to the
  // session it started in, so detaching on replacement is the correct behavior.
  pi.on("session_shutdown", () => loop.detach());

  pi.registerCommand("auto-edit", {
    description: "Edit the message used by a running auto mode. Usage: /auto-edit <message>",
    handler: async (args, ctx) => {
      loop.attach(ctx);

      const editedMessage = args.trim();
      if (!editedMessage) {
        ctx.ui.notify("Usage: /auto-edit <message>", "warning");
        return;
      }

      if (!loop.edit(editedMessage)) {
        ctx.ui.notify(
          "Auto mode is not running. Start it with /auto <count> [message].",
          "warning",
        );
        return;
      }

      ctx.ui.notify(`Auto mode message updated to "${editedMessage}".`, "info");
    },
  });

  pi.registerCommand("auto", {
    description:
      "Send a message N times, waiting for each agent turn to finish before sending the next one. Usage: /auto <count> [message] | /auto stop",
    handler: async (args, ctx) => {
      loop.attach(ctx);

      if (args.trim() === "stop") {
        if (!loop.stop()) ctx.ui.notify("No auto mode is running.", "warning");
        return;
      }

      const parsed = parseAutoArgs(args);
      if (!parsed) {
        ctx.ui.notify("Usage: /auto <count> [message] | /auto stop", "warning");
        return;
      }

      const message =
        parsed.message ?? getLastUserMessageText(ctx.sessionManager.getBranch());
      if (!message) {
        ctx.ui.notify(
          "No previous user message found. Usage: /auto <count> [message]",
          "warning",
        );
        return;
      }

      loop.start(message, parsed.count);
    },
  });
}
