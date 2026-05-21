/**
 * Pure helpers for parsing auto command arguments
 * and extracting user messages from session branches.
 *
 * No SDK runtime dependencies — only type-level imports.
 */

import type { SessionEntry } from "@mariozechner/pi-coding-agent";

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

export function textFromContent(content: unknown): string | undefined {
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
