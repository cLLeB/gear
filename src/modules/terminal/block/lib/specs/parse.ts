// Walks a typed command line through its spec to find what the word under the
// cursor can be. Pure: generators and the filesystem are resolved by the caller.

import type { Arg, Opt, Resolution, Spec, Suggestion } from "./types";

/** Words of `text`, honouring quotes; `trailing` is true when the line ends in a space. */
export function shellWords(text: string): { words: string[]; trailing: boolean } {
  const words: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) {
      cur += text[++i];
      inWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) words.push(cur);
      cur = "";
      inWord = false;
      continue;
    }
    cur += ch;
    inWord = true;
  }
  const trailing = !inWord && !quote;
  if (inWord || quote) words.push(cur);
  return { words, trailing };
}

/** The last command segment of a line: text after the last ; & | ( or newline. */
export function lastSegment(line: string): string {
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (";&|(\n".includes(ch)) start = i + 1;
  }
  return line.slice(start);
}

const matches = (names: string[], word: string) => names.includes(word);

function findOption(opts: Opt[], word: string): Opt | undefined {
  const flag = word.includes("=") ? word.slice(0, word.indexOf("=")) : word;
  return opts.find((o) => matches(o.name, flag));
}

function argAt(args: Arg[] | undefined, index: number): Arg | null {
  if (!args?.length) return null;
  if (index < args.length) return args[index];
  const last = args[args.length - 1];
  return last.variadic ? last : null;
}

function valueItems(arg: Arg | null): Suggestion[] {
  return (arg?.suggestions ?? []).map((label) => ({ label, kind: "value" as const }));
}

/**
 * Resolve the completion context for `words` (the command name first), where
 * the last word is the one being typed when `trailing` is false.
 */
export function resolve(spec: Spec, words: string[], trailing: boolean): Resolution {
  const done = trailing ? words.slice(1) : words.slice(1, -1);
  const current = trailing ? "" : (words[words.length - 1] ?? "");
  let node = spec;
  // Options of the command and every parent subcommand stay valid (git -C …).
  let options: Opt[] = [...(spec.options ?? [])];
  let positional = 0;
  let pending: Arg | null = null;
  let afterDoubleDash = false;

  for (const w of done) {
    if (pending) {
      pending = null;
      continue;
    }
    if (w === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && w.startsWith("-") && w.length > 1) {
      const opt = findOption(options, w);
      if (opt?.args && !w.includes("=")) pending = opt.args;
      continue;
    }
    const sub = positional === 0 && !afterDoubleDash ? node.subcommands?.find((s) => matches(s.name, w)) : undefined;
    if (sub) {
      node = sub;
      // The subcommand's own spelling wins: `compose logs -f` is --follow, not compose's --file.
      options = [...(sub.options ?? []), ...options];
      continue;
    }
    positional += 1;
  }

  if (pending) return { kind: "items", items: valueItems(pending), arg: pending };

  if (!afterDoubleDash && current.startsWith("-")) {
    const seen = new Set<string>();
    const items: Suggestion[] = [];
    for (const o of [...(node.options ?? []), ...options]) {
      for (const n of o.name) {
        if (seen.has(n) || !n.startsWith(current)) continue;
        seen.add(n);
        items.push({ label: n, description: o.description, kind: "option" });
      }
    }
    return { kind: "items", items, arg: null };
  }

  const items: Suggestion[] = [];
  if (positional === 0 && !afterDoubleDash) {
    for (const s of node.subcommands ?? []) {
      // List the main name; an alias (cargo b, npm i) only when it alone matches what was typed.
      const [main, ...aliases] = s.name;
      if (main.startsWith(current)) items.push({ label: main, description: s.description, kind: "subcommand" });
      else {
        const alias = current ? aliases.find((a) => a.startsWith(current)) : undefined;
        if (alias) items.push({ label: alias, description: s.description, kind: "subcommand" });
      }
    }
  }
  const arg = argAt(node.args, positional);
  items.push(...valueItems(arg));
  if (!items.length && !arg) return { kind: "none" };
  return { kind: "items", items: items.filter((i) => i.label.startsWith(current)), arg };
}
