// Renderer pool eliminated. Each terminal session now owns its xterm instance
// directly. This file exists only to preserve the refitSlot export used by
// index.ts and any other callers that haven't been updated yet.
export { refitSlot, pasteIntoLeaf } from "./useTerminalSession";
