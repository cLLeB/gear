// Spec-driven completion for the terminal input: subcommands, options and
// live argument values for known CLIs. Returns null when no spec applies, so
// the input falls back to its path and word completion.

import type { Completion } from "@codemirror/autocomplete";
import { generate } from "./generators";
import { lastSegment, resolve, shellWords } from "./parse";
import { specFor } from "./specs";
import type { Arg } from "./types";

export type SpecCompletion = {
  /** Options for the word being typed (may be empty when only paths apply). */
  options: Completion[];
  /** The argument wants filesystem paths too. */
  wantsPaths: boolean;
};

const TYPE: Record<string, string> = { subcommand: "method", option: "property", value: "constant" };
const BOOST: Record<string, number> = { value: 2, subcommand: 1, option: 0 };

/**
 * Completions for the cursor at the end of `lineBefore` (the input text up to
 * the cursor), or null when the command has no spec.
 */
export async function specCompletions(lineBefore: string, cwd: string | null): Promise<SpecCompletion | null> {
  const { words, trailing } = shellWords(lastSegment(lineBefore));
  // Skip leading env assignments and sudo/npx-style wrappers.
  while (words.length > 1 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || words[0] === "sudo")) words.shift();
  if (words.length === 0 || (words.length === 1 && !trailing)) return null;
  const spec = specFor(words[0]);
  if (!spec) return null;
  const res = resolve(spec, words, trailing);
  if (res.kind === "none") return null;

  const current = trailing ? "" : (words[words.length - 1] ?? "");
  const options: Completion[] = res.items.map((i) => ({
    label: i.label,
    detail: i.description,
    type: TYPE[i.kind],
    boost: BOOST[i.kind],
  }));
  const arg: Arg | null = res.arg;
  if (arg?.generator && cwd && !current.startsWith("-")) {
    const values = await generate(arg.generator, cwd);
    const have = new Set(options.map((o) => o.label));
    for (const v of values) {
      if (have.has(v.label) || !v.label.startsWith(current)) continue;
      options.push({ label: v.label, detail: v.description, type: "constant", boost: 3 });
    }
  }
  return { options, wantsPaths: !!arg?.template && !current.startsWith("-") };
}
