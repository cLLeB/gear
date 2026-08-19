import { toast } from "sonner";

const PREVIEW_CHARS = 60;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS)}…`
    : flat;
}

/**
 * A program tried to take over the system clipboard from inside a running
 * command. Rather than dropping it (breaking legitimate copy helpers) or
 * applying it (letting hostile output poison the next paste), the write is
 * offered to the user with the text it would install.
 */
export function confirmClipboardWrite(text: string, apply: () => void): void {
  toast("A command wants to set your clipboard", {
    description: preview(text),
    action: { label: "Allow", onClick: apply },
  });
}
