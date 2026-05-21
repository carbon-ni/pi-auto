/**
 * Extension registration and timer lifecycle.
 * Owns all pi SDK runtime interaction.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getLastUserMessageText, parseAutoArgs } from "../lib/auto-helpers.js";

export default function registerAutoCommand(pi: ExtensionAPI) {
  let autoTimer: NodeJS.Timeout | undefined;

  pi.registerCommand("auto", {
    description:
      "Send a message N times, waiting for each agent turn to finish before sending the next one. Usage: /auto <count> [message]",
    handler: async (args, ctx) => {
      const parsed = parseAutoArgs(args);

      if (!parsed) {
        ctx.ui.notify("Usage: /auto <count> [message]", "warning");
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

      let remaining = parsed.count;
      ctx.ui.notify(
        `Auto mode: sending "${message}" ${parsed.count} time(s).`,
        "info",
      );

      const tick = () => {
        if (remaining < 1) {
          autoTimer = undefined;
          ctx.ui.notify("Auto mode complete.", "info");
          return;
        }

        if (!ctx.isIdle()) {
          autoTimer = setTimeout(tick, 250);
          return;
        }

        remaining -= 1;
        pi.sendUserMessage(message);
        autoTimer = setTimeout(tick, 250);
      };

      autoTimer = setTimeout(tick, 0);
    },
  });
}
