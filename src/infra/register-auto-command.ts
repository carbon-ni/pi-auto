/**
 * Extension registration — pure wiring.
 *
 * Builds one `AutoLoop` and binds the `/auto` and `/defer` commands, the
 * `auto_stop` tool, and the `session_shutdown` lifecycle hook to it. All state
 * and timer logic lives in `AutoLoop`; this module only translates command
 * arguments and tool results.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import {
  getLastUserMessageText,
  parseAutoArgs,
  parseAutoEditArgs,
  textFromContent,
} from "../lib/auto-helpers.js";
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

  pi.on("input", (event, ctx) => {
    if (event.source !== "interactive" || ctx.isIdle()) return;

    loop.attach(ctx);
    loop.rememberSteering(event.text);
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "user") return;

    const message = textFromContent(event.message.content);
    if (!message) return;
    if (!loop.consumeDeferredSteering(message)) {
      loop.forgetSteering(message);
      return;
    }

    return {
      message: {
        ...event.message,
        content: [{ type: "text" as const, text: "continue" }],
      },
    };
  });

  // The captured port goes stale when another extension (or the user) swaps the
  // session via newSession/fork/switchSession/reload. Auto is bound to the
  // session it started in, so detaching on replacement is the correct behavior.
  pi.on("session_shutdown", () => loop.detach());

  pi.registerCommand("defer", {
    description:
      "Send a different message on the final round of a running auto mode. Usage: /defer <message> | /defer remove",
    handler: async (args, ctx) => {
      loop.attach(ctx);

      const deferredMessage = args.trim();
      if (deferredMessage === "remove") {
        const removedMessage = loop.removeDeferred();
        if (!removedMessage) {
          ctx.ui.notify("No deferred message to remove.", "warning");
          return;
        }

        ctx.ui.notify(`Removed deferred message "${removedMessage}".`, "info");
        return;
      }

      if (!deferredMessage) {
        const deferredSteering = loop.deferLatestSteering();
        if (!deferredSteering) {
          ctx.ui.notify(
            "No queued steering message found. Usage: /defer <message>",
            "warning",
          );
          return;
        }

        if (deferredSteering.target === "followUp") {
          pi.sendUserMessage(deferredSteering.message, { deliverAs: "followUp" });
          ctx.ui.notify(
            `Deferred queued steering message "${deferredSteering.message}" as a follow-up.`,
            "info",
          );
          return;
        }

        ctx.ui.notify(
          `Deferred queued steering message "${deferredSteering.message}" until the final auto round.`,
          "info",
        );
        return;
      }

      if (loop.defer(deferredMessage)) {
        ctx.ui.notify(
          `Deferred "${deferredMessage}" until the final auto round.`,
          "info",
        );
        return;
      }

      if (ctx.isIdle()) {
        ctx.ui.notify(
          "Nothing is running. Start work before deferring a message.",
          "warning",
        );
        return;
      }

      pi.sendUserMessage(deferredMessage, { deliverAs: "followUp" });
      ctx.ui.notify(`Deferred "${deferredMessage}" as a follow-up.`, "info");
    },
  });

  pi.registerCommand("auto", {
    description:
      'Send a message N times, waiting for each agent turn to finish before sending the next one. Usage: /auto <count> [message] | /auto stop | /auto edit|e <number> "<message>"',
    handler: async (args, ctx) => {
      loop.attach(ctx);

      const editedRun = parseAutoEditArgs(args);
      if (/^(?:edit|e)(?:\s|$)/.test(args.trim())) {
        if (!editedRun) {
          ctx.ui.notify('Usage: /auto edit|e <number> "<message>"', "warning");
          return;
        }

        if (!loop.edit(editedRun.message!, editedRun.count)) {
          ctx.ui.notify(
            "Auto mode is not running. Start it with /auto <count> [message].",
            "warning",
          );
          return;
        }

        ctx.ui.notify(
          `Auto mode updated: sending "${editedRun.message}" ${editedRun.count} time(s).`,
          "info",
        );
        return;
      }

      if (args.trim() === "stop") {
        if (!loop.stop()) ctx.ui.notify("No auto mode is running.", "warning");
        return;
      }

      const parsed = parseAutoArgs(args);
      if (!parsed) {
        ctx.ui.notify(
          'Usage: /auto <count> [message] | /auto stop | /auto edit|e <number> "<message>"',
          "warning",
        );
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
