// Per-terminal history of shell-integration (OSC 133) command boundaries,
// anchored with xterm markers so positions survive scrolling and trimming.
// This is what lets plain (non-block) terminals do what iTerm2 and Warp do
// with marks: jump between prompts, copy the last command or its output, and
// feed later features (rerun last command, explain failure, problem matchers).
//
// The handler is registered *non-consuming* (returns false) so the existing
// prompt tracker / block decorations still see every OSC 133 sequence.

import type { IBufferLine, IMarker, Terminal } from "@xterm/xterm";

export interface CommandMark {
  /** Line where the prompt (OSC 133 A) was drawn. */
  prompt: IMarker;
  /** First line of command output (OSC 133 C), once the command executes. */
  output: IMarker | null;
  /** Line where the command finished (OSC 133 D). */
  end: IMarker | null;
  command: string;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

const MAX_MARKS = 500;

export class CommandMarks {
  private marks: CommandMark[] = [];
  private listeners = new Set<(mark: CommandMark) => void>();

  constructor(private readonly term: Pick<Terminal, "registerMarker">) {}

  /** OSC 133 A: a new prompt is being drawn. */
  onPrompt(): void {
    const prompt = this.term.registerMarker(0);
    if (!prompt) return;
    this.marks.push({
      prompt,
      output: null,
      end: null,
      command: "",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
    });
    this.prune();
  }

  /** OSC 133 C[;cmd]: the command line was submitted and is executing. */
  onExecute(command: string, now = Date.now()): void {
    const cur = this.current();
    if (!cur || cur.output) return;
    cur.output = this.term.registerMarker(0) ?? null;
    cur.command = command;
    cur.startedAt = now;
  }

  /** OSC 133 D[;code]: the command finished. */
  onFinish(exitCode: number | null, now = Date.now()): void {
    const cur = this.current();
    if (!cur || !cur.output || cur.end) return;
    cur.end = this.term.registerMarker(0) ?? null;
    cur.exitCode = exitCode;
    cur.finishedAt = now;
    for (const l of this.listeners) l(cur);
  }

  /** Subscribe to completed commands. */
  onCommandFinished(cb: (mark: CommandMark) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Marks whose prompt line is still in the buffer, oldest first. */
  list(): CommandMark[] {
    this.marks = this.marks.filter((m) => !m.prompt.isDisposed);
    return this.marks;
  }

  /** Most recent command that has finished (has output and end markers). */
  lastFinished(): CommandMark | null {
    const list = this.list();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].end && list[i].output) return list[i];
    }
    return null;
  }

  dispose(): void {
    for (const m of this.marks) {
      m.prompt.dispose();
      m.output?.dispose();
      m.end?.dispose();
    }
    this.marks = [];
    this.listeners.clear();
  }

  private current(): CommandMark | undefined {
    return this.marks[this.marks.length - 1];
  }

  private prune(): void {
    while (this.marks.length > MAX_MARKS) {
      const old = this.marks.shift()!;
      old.prompt.dispose();
      old.output?.dispose();
      old.end?.dispose();
    }
  }
}

function osc133Field(data: string): string {
  const semi = data.indexOf(";");
  return semi === -1 ? "" : data.slice(semi + 1);
}

/** Feed one OSC 133 payload into `marks`. Exposed for tests. */
export function applyOsc133(marks: CommandMarks, data: string, now = Date.now()): void {
  const kind = data[0];
  if (kind === "A") marks.onPrompt();
  else if (kind === "C") marks.onExecute(osc133Field(data), now);
  else if (kind === "D") {
    const raw = osc133Field(data).split(";")[0];
    const code = raw === "" ? null : Number.parseInt(raw, 10);
    marks.onFinish(code === null || Number.isNaN(code) ? null : code, now);
  }
}

export function registerCommandMarks(term: Terminal): { marks: CommandMarks; dispose: () => void } {
  const marks = new CommandMarks(term);
  const d = term.parser.registerOscHandler(133, (data) => {
    applyOsc133(marks, data);
    return false; // never consume: other OSC 133 handlers must still run
  });
  return {
    marks,
    dispose: () => {
      d.dispose();
      marks.dispose();
    },
  };
}

/**
 * The prompt line to jump to from `fromLine` (a buffer line, usually the top
 * of the viewport). Lines are sorted ascending; returns null at the edges.
 */
export function adjacentPromptLine(
  promptLines: readonly number[],
  fromLine: number,
  dir: -1 | 1,
): number | null {
  if (dir < 0) {
    for (let i = promptLines.length - 1; i >= 0; i--) {
      if (promptLines[i] < fromLine) return promptLines[i];
    }
    return null;
  }
  for (const line of promptLines) {
    if (line > fromLine) return line;
  }
  return null;
}

type BufferLike = {
  length: number;
  getLine(y: number): Pick<IBufferLine, "translateToString" | "isWrapped"> | undefined;
};

/**
 * Text of buffer lines [from, to), joining soft-wrapped rows back into the
 * logical lines the program printed. Trailing blank lines are dropped.
 */
export function readBufferRange(buffer: BufferLike, from: number, to: number): string {
  const end = Math.min(to, buffer.length);
  const lines: string[] = [];
  for (let y = Math.max(0, from); y < end; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/** Output text of a finished command, or null when its markers are gone. */
export function readCommandOutput(term: Terminal, mark: CommandMark): string | null {
  if (!mark.output || mark.output.isDisposed) return null;
  const endLine = mark.end && !mark.end.isDisposed ? mark.end.line : term.buffer.active.length;
  return readBufferRange(term.buffer.active, mark.output.line, endLine);
}
