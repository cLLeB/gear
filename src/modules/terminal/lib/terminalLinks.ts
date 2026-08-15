import { openExternalUrl } from "@/lib/external-link";

/** xterm `linkHandler` for OSC 8 hyperlinks. The terminal loses focus when the
 *  OS opener steals it, so focus is restored once the open settles. `focus` is
 *  a thunk because the Terminal is constructed with this handler. */
export function createTerminalLinkHandler(focus: () => void) {
  return {
    activate: (_event: MouseEvent, uri: string) =>
      void openExternalUrl(uri, focus),
  };
}
