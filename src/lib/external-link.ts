import { openUrl } from "@tauri-apps/plugin-opener";

/** Schemes Gear is willing to hand to the OS opener.
 *
 * Link text can come from untrusted places — an OSC 8 hyperlink emitted by a
 * remote process, markdown in a repo, a model response — so anything outside
 * this allowlist (`javascript:`, `file:`, custom app protocols) is dropped
 * rather than forwarded to the shell. */
export function isExternalUrl(href: string): boolean {
  return /^(?:https?:|mailto:|tel:)/i.test(href);
}

export function openExternalUrl(
  href: string,
  onSettled?: () => void,
): Promise<void> {
  if (!isExternalUrl(href)) {
    onSettled?.();
    return Promise.resolve();
  }

  return openUrl(href)
    .catch((error) => {
      console.error("[gear] failed to open external link:", error);
    })
    .finally(() => onSettled?.());
}
