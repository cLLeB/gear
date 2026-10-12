// Records what is typed and which command keys are pressed in a code editor,
// and plays the recording back through the same handlers the keyboard uses.

import { Prec, type Extension } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { toast } from "sonner";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { compact, describe, keyStep, parseCount, parseSaved, upsert, type SavedMacro, type Step } from "./model";

const STORE_KEY = "gear.editorMacros";
const TOAST_ID = "gear-macro-recording";

let recording: Step[] | null = null;
let playing = false;
let last: Step[] = [];

export function isRecording(): boolean {
  return recording !== null;
}

function saved(): SavedMacro[] {
  try {
    return parseSaved(localStorage.getItem(STORE_KEY));
  } catch {
    return [];
  }
}

function store(list: SavedMacro[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    toast.error("Could not save the macro (storage is unavailable).");
  }
}

function showRecording(): void {
  toast.loading(`Recording macro — ${compact(recording ?? []).length} steps`, { id: TOAST_ID, duration: Number.POSITIVE_INFINITY, action: { label: "Stop", onClick: () => stopRecording() } });
}

function note(step: Step): void {
  if (!recording || playing) return;
  recording.push(step);
  showRecording();
}

/** Added to every code editor; idle unless a recording is in progress. */
export function macroRecorder(): Extension {
  return [
    // Highest precedence: a keymap that handles the key would otherwise stop it from being seen here.
    Prec.highest(
      EditorView.domEventHandlers({
        keydown(event) {
          if (!recording || playing) return false;
          const step = keyStep(event);
          if (step) note(step);
          return false;
        },
      }),
    ),
    // Returning false lets the editor (and auto-closing brackets, etc.) handle the text as usual.
    EditorView.inputHandler.of((_view, _from, _to, text) => {
      note({ t: "text", text });
      return false;
    }),
  ];
}

export function startRecording(): void {
  if (!getActiveEditor()) return void toast.info("Click into a file first — macros record what you do in the editor.");
  recording = [];
  showRecording();
  getActiveEditor()?.view.focus();
}

export function stopRecording(): void {
  if (!recording) return;
  last = compact(recording);
  recording = null;
  toast.dismiss(TOAST_ID);
  if (last.length) toast.success(`Macro recorded: ${describe(last, 70)}`);
  else toast.info("Nothing was recorded.");
  getActiveEditor()?.view.focus();
}

export function toggleRecording(): void {
  if (recording) stopRecording();
  else startRecording();
}

function typeText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const insert = () => view.state.update(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: "input.type" });
  for (const handler of view.state.facet(EditorView.inputHandler)) if (handler(view, from, to, text, insert)) return;
  view.dispatch(insert());
}

function playOnce(view: EditorView, steps: Step[]): void {
  for (const s of steps) {
    if (s.t === "text") typeText(view, s.text);
    else runScopeHandlers(view, new KeyboardEvent("keydown", { key: s.key, code: s.code, ctrlKey: s.ctrl, altKey: s.alt, shiftKey: s.shift, metaKey: s.meta, bubbles: true, cancelable: true }), "editor");
  }
}

/**
 * Plays `steps` `times` times. With `untilEnd`, keeps going until the cursor
 * reaches the last line, stops moving down, or a pass changes nothing (so it cannot loop forever).
 */
export function play(steps: Step[], times = 1, untilEnd = false): number {
  const view = getActiveEditor()?.view;
  if (!view) return void toast.info("Click into a file first."), 0;
  if (!steps.length) return void toast.info("There is no macro yet — record one first."), 0;
  if (recording) stopRecording();
  playing = true;
  let done = 0;
  try {
    const limit = untilEnd ? 10000 : times;
    while (done < limit) {
      const before = { doc: view.state.doc, head: view.state.selection.main.head, line: view.state.doc.lineAt(view.state.selection.main.head).number };
      playOnce(view, steps);
      done++;
      if (!untilEnd) continue;
      const head = view.state.selection.main.head;
      if (view.state.doc.eq(before.doc) && head === before.head) break;
      const line = view.state.doc.lineAt(head).number;
      // A macro that does not move down a line would repeat on the same line until the limit.
      if (line <= before.line || line >= view.state.doc.lines) break;
    }
  } finally {
    playing = false;
  }
  view.focus();
  return done;
}

export function playLast(): void {
  play(last);
}

export async function playLastTimes(): Promise<void> {
  if (!last.length) return void toast.info("There is no macro yet — record one first.");
  const v = await inputBox({ title: "Play the macro how many times?", placeholder: "10", validate: (t: string) => (parseCount(t) ? null : "Enter a number from 1 to 10000") });
  const n = v ? parseCount(v) : null;
  if (n) toast.success(`Macro played ${play(last, n)} times`);
}

export function playLastToEnd(): void {
  if (!last.length) return void toast.info("There is no macro yet — record one first.");
  toast.success(`Macro played ${play(last, 1, true)} times, to the end of the file`);
}

export async function saveLast(): Promise<void> {
  if (!last.length) return void toast.info("There is no macro yet — record one first.");
  const name = (await inputBox({ title: "Save macro as", placeholder: "Name", prompt: describe(last, 80) }))?.trim();
  if (!name) return;
  store(upsert(saved(), { name, steps: last }));
  toast.success(`Saved macro “${name}”`);
}

export async function runSaved(): Promise<void> {
  const list = saved();
  if (!list.length) return void toast.info("No saved macros yet. Record one, then “Macro: Save last recording…”.");
  const pick = await quickPick(
    list.map((m) => ({ label: m.name, detail: describe(m.steps, 100), value: m })),
    { title: "Run a saved macro" },
  );
  if (!pick) return;
  last = pick.steps;
  play(pick.steps);
}

export async function deleteSaved(): Promise<void> {
  const list = saved();
  if (!list.length) return void toast.info("No saved macros.");
  const pick = await quickPick(
    list.map((m) => ({ label: m.name, detail: describe(m.steps, 100), value: m })),
    { title: "Delete which macro?" },
  );
  if (!pick) return;
  store(list.filter((m) => m !== pick));
  toast.success(`Deleted macro “${pick.name}”`);
}

export function showLast(): void {
  if (!last.length) return void toast.info("There is no macro yet — record one first.");
  toast.info(describe(last, 300), { duration: 10000 });
}

export const MACRO_ACTIONS = [
  { id: "macro.toggle", label: "Macro: Start / stop recording", keywords: ["macro", "record", "repeat", "keystrokes", "automate"], run: toggleRecording },
  { id: "macro.play", label: "Macro: Play last recording", keywords: ["macro", "replay", "repeat", "play"], run: playLast },
  { id: "macro.playTimes", label: "Macro: Play last recording N times…", keywords: ["macro", "replay", "repeat", "times", "count"], run: () => void playLastTimes() },
  { id: "macro.playToEnd", label: "Macro: Play last recording to the end of the file", keywords: ["macro", "replay", "every line", "all lines", "end of file"], run: playLastToEnd },
  { id: "macro.save", label: "Macro: Save last recording…", keywords: ["macro", "save", "name", "keep"], run: () => void saveLast() },
  { id: "macro.run", label: "Macro: Run a saved macro…", keywords: ["macro", "saved", "run", "play"], run: () => void runSaved() },
  { id: "macro.delete", label: "Macro: Delete a saved macro…", keywords: ["macro", "saved", "delete", "remove"], run: () => void deleteSaved() },
  { id: "macro.show", label: "Macro: Show what the last recording does", keywords: ["macro", "steps", "inspect", "show"], run: showLast },
];
