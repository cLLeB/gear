import type { UIMessage } from "@ai-sdk/react";

const CONTEXT_BLOCK_RE =
  /<(?:file|selection|snippet)[^>]*>[\s\S]*?<\/(?:file|selection|snippet)>/g;
const GEAR_CMD_RE = /<Gear-command[^>]*\/>/g;

function cleanUserText(text: string): string {
  return text
    .replace(GEAR_CMD_RE, "")
    .replace(CONTEXT_BLOCK_RE, "")
    .trim();
}

export function exportConversationAsMarkdown(
  messages: UIMessage[],
  title: string,
): void {
  const date = new Date().toLocaleString();
  const lines: string[] = [`# ${title || "Conversation"}`, ``, `_Exported ${date}_`, ``];

  for (const m of messages) {
    const role = m.role === "user" ? "User" : "Assistant";
    const textParts: string[] = [];

    for (const part of m.parts) {
      if (part.type === "text") {
        const raw = (part as { text?: string }).text ?? "";
        const clean = m.role === "user" ? cleanUserText(raw) : raw.trim();
        if (clean) textParts.push(clean);
      } else if (part.type === "reasoning") {
        const raw = (part as { text?: string }).text ?? "";
        if (raw.trim()) {
          textParts.push(`<details>\n<summary>Reasoning</summary>\n\n${raw.trim()}\n\n</details>`);
        }
      }
    }

    if (textParts.length === 0) continue;

    lines.push(`---`, ``, `**${role}**`, ``);
    lines.push(textParts.join("\n\n"));
    lines.push(``);
  }

  const markdown = lines.join("\n");
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (title || "conversation")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  a.download = `${safeName || "conversation"}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
