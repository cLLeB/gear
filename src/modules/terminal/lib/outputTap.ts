// A decoded, line-oriented view of live PTY output for features that watch
// what programs print (dev-server URLs, secrets, triggers, activity). Bytes
// are decoded per leaf with a streaming decoder so multi-byte characters
// split across chunks survive, ANSI is stripped, and complete lines are
// delivered in batches. Nothing is decoded while no one is listening.

import { stripAnsi } from "@/lib/lang/ansi";

export type OutputLinesListener = (leafId: number, lines: string[]) => void;
export type OutputActivityListener = (leafId: number, bytes: number) => void;
export type OutputBytesListener = (leafId: number, bytes: Uint8Array) => void;

const lineListeners = new Set<OutputLinesListener>();
const activityListeners = new Set<OutputActivityListener>();
const bytesListeners = new Set<OutputBytesListener>();

const MAX_PARTIAL = 8 * 1024;

export class LineSplitter {
  private decoder = new TextDecoder("utf-8");
  private partial = "";

  /** Feed raw bytes; returns completed, ANSI-stripped lines. */
  push(bytes: Uint8Array): string[] {
    const text = this.decoder.decode(bytes, { stream: true });
    return this.pushText(text);
  }

  pushText(text: string): string[] {
    const combined = this.partial + text;
    const parts = combined.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    // A program redrawing one line with \r (progress bars) never ends it;
    // keep only the latest redraw and cap the size.
    const cr = this.partial.lastIndexOf("\r");
    if (cr !== -1) this.partial = this.partial.slice(cr + 1);
    if (this.partial.length > MAX_PARTIAL) this.partial = this.partial.slice(-MAX_PARTIAL);
    return parts.map((l) => {
      const lastCr = l.lastIndexOf("\r");
      return stripAnsi(lastCr === -1 ? l : l.slice(lastCr + 1));
    });
  }
}

const splitters = new Map<number, LineSplitter>();

/** Called by the session layer for every chunk of PTY output. */
export function tapPtyOutput(leafId: number, bytes: Uint8Array): void {
  for (const l of activityListeners) l(leafId, bytes.byteLength);
  for (const l of bytesListeners) l(leafId, bytes);
  if (lineListeners.size === 0) return;
  let splitter = splitters.get(leafId);
  if (!splitter) {
    splitter = new LineSplitter();
    splitters.set(leafId, splitter);
  }
  const lines = splitter.push(bytes);
  if (lines.length === 0) return;
  for (const l of lineListeners) {
    try {
      l(leafId, lines);
    } catch (e) {
      console.error("[gear] output listener failed:", e);
    }
  }
}

export function forgetTapLeaf(leafId: number): void {
  splitters.delete(leafId);
}

export function onTerminalOutputLines(cb: OutputLinesListener): () => void {
  lineListeners.add(cb);
  return () => {
    lineListeners.delete(cb);
  };
}

export function onTerminalOutputActivity(cb: OutputActivityListener): () => void {
  activityListeners.add(cb);
  return () => {
    activityListeners.delete(cb);
  };
}

/** Raw PTY bytes, undecoded (for recorders). Keep listeners cheap. */
export function onTerminalOutputBytes(cb: OutputBytesListener): () => void {
  bytesListeners.add(cb);
  return () => {
    bytesListeners.delete(cb);
  };
}
