/**
 * Extension registration and timer lifecycle.
 * Owns all pi SDK runtime interaction.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { getLastUserMessageText, parseAutoArgs } from "../lib/auto-helpers.js";

const POLL_INTERVAL_MS = 250;

type AutoRun = {
  message: string;
  remaining: number;
};

export default function registerAutoCommand(pi: ExtensionAPI) {
  let autoTimer: NodeJS.Timeout | undefined;
  let autoRun: AutoRun | undefined;

  function stopAuto(ctx: { ui: { notify: Function } }) {
    if (!autoRun && !autoTimer) {
      ctx.ui.notify("No auto mode is running.", "warning");
      return;
    }

    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = undefined;
    autoRun = undefined;
    ctx.ui.notify("Auto mode stopped.", "info");
  }

  pi.registerTool({
    name: "auto_stop",
    label: "Auto Stop",
    description:
      "Stop the currently running /auto loop immediately. Call this when the task is complete before all iterations finish.",
    promptSnippet: "auto_stop() — stop the running /auto loop early",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!autoRun && !autoTimer) {
        return {
          content: [{ type: "text" as const, text: "No auto mode is running." }],
          details: undefined,
        };
      }

      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = undefined;
      autoRun = undefined;
      ctx.ui.notify("Auto mode stopped.", "info");

      return {
        content: [{ type: "text" as const, text: "Auto mode stopped." }],
        details: undefined,
      };
    },
  });

  pi.registerCommand("auto-edit", {
    description: "Edit the message used by a running auto mode. Usage: /auto-edit <message>",
    handler: async (args, ctx) => {
      const editedMessage = args.trim();

      if (!editedMessage) {
        ctx.ui.notify("Usage: /auto-edit <message>", "warning");
        return;
      }

      if (!autoRun) {
        ctx.ui.notify("Auto mode is not running. Start it with /auto <count> [message].", "warning");
        return;
      }

      autoRun.message = editedMessage;
      ctx.ui.notify(`Auto mode message updated to "${editedMessage}".`, "info");
    },
  });

  pi.registerCommand("auto", {
    description:
      "Send a message N times, waiting for each agent turn to finish before sending the next one. Usage: /auto <count> [message] | /auto stop",
    handler: async (args, ctx) => {
      if (args.trim() === "stop") {
        stopAuto(ctx);
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

      if (autoTimer) clearTimeout(autoTimer);

      autoRun = { message, remaining: parsed.count };
      ctx.ui.notify(
        `Auto mode: sending "${message}" ${parsed.count} time(s).`,
        "info",
      );

      const tick = () => {
        if (!autoRun || autoRun.remaining < 1) {
          autoTimer = undefined;
          autoRun = undefined;
          ctx.ui.notify("Auto mode complete.", "info");
          return;
        }

        if (!ctx.isIdle()) {
          autoTimer = setTimeout(tick, POLL_INTERVAL_MS);
          return;
        }

        autoRun.remaining -= 1;
        pi.sendUserMessage(autoRun.message);
        autoTimer = setTimeout(tick, POLL_INTERVAL_MS);
      };

      autoTimer = setTimeout(tick, 0);
    },
  });
}
