import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

export type AutoArgs = {
  count: number;
  message?: string;
};

export function parseAutoArgs(args: string): AutoArgs | undefined {
  const trimmed = args.trim();
  if (!trimmed) return undefined;

  const [rawCount, ...messageParts] = trimmed.split(/\s+/);
  const count = Number.parseInt(rawCount, 10);

  if (!Number.isSafeInteger(count) || count < 1) return undefined;

  return {
    count,
    message: messageParts.join(" ").trim() || undefined,
  };
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text || undefined;
}

export function getLastUserMessageText(branch: unknown[]): string | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as SessionEntry;
    if (entry.type !== "message" || entry.message.role !== "user") continue;

    const text = textFromContent(entry.message.content);
    if (!text || text.startsWith("/auto")) continue;

    return text;
  }

  return undefined;
}

type AutoRun = {
  message: string;
  remaining: number;
};

export default function (pi: ExtensionAPI) {
  let autoTimer: NodeJS.Timeout | undefined;
  let autoRun: AutoRun | undefined;

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
      ctx.ui.notify(`Auto mode message updated to \"${editedMessage}\".`, "info");
    },
  });

  pi.registerCommand("auto", {
    description: "Send a message N times, waiting for each agent turn to finish before sending the next one. Usage: /auto <count> [message]",
    handler: async (args, ctx) => {
      const parsed = parseAutoArgs(args);

      if (!parsed) {
        ctx.ui.notify("Usage: /auto <count> [message]", "warning");
        return;
      }

      const message = parsed.message ?? getLastUserMessageText(ctx.sessionManager.getBranch());

      if (!message) {
        ctx.ui.notify("No previous user message found. Usage: /auto <count> [message]", "warning");
        return;
      }

      if (autoTimer) clearTimeout(autoTimer);

      autoRun = { message, remaining: parsed.count };
      ctx.ui.notify(
        `Auto mode: sending \"${message}\" ${parsed.count} time(s).`,
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
          autoTimer = setTimeout(tick, 250);
          return;
        }

        autoRun.remaining -= 1;
        pi.sendUserMessage(autoRun.message);
        autoTimer = setTimeout(tick, 250);
      };

      autoTimer = setTimeout(tick, 0);
    },
  });
}
