// Identifier case analysis and case-preserving replacement. Renaming
// `fooBar` to `bazQux` should turn `FOO_BAR` into `BAZ_QUX`, `foo-bar` into
// `baz-qux`, and `FooBar` into `BazQux` — i.e. keep each occurrence's casing
// convention while swapping the underlying words. That requires splitting an
// identifier into its constituent words across every common convention
// (camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case,
// including acronym runs like `HTMLParser`), detecting an occurrence's style,
// and re-rendering the replacement words in that same style. This is the engine
// behind a "preserve case" find-and-replace.

export type CaseStyle =
  | "lower" | "upper" | "capital"
  | "camel" | "pascal"
  | "snake" | "screamingSnake" | "kebab";

/** Split an identifier into lowercased constituent words across all conventions. */
export function splitWords(identifier: string): string[] {
  if (identifier === "") return [];
  const spaced = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // fooBar -> foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"); // HTMLParser -> HTML Parser
  return spaced
    .split(/[\s_\-]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

/** Detect the casing convention of an identifier occurrence. */
export function detectCase(identifier: string): CaseStyle {
  if (identifier.includes("_")) {
    return identifier === identifier.toUpperCase() ? "screamingSnake" : "snake";
  }
  if (identifier.includes("-")) return "kebab";

  const hasLower = /[a-z]/.test(identifier);
  const hasUpper = /[A-Z]/.test(identifier);
  if (hasUpper && !hasLower) return "upper";
  if (!hasUpper) return "lower";

  const startsUpper = /^[A-Z]/.test(identifier);
  const internalUpper = /[a-z][A-Z]/.test(identifier);
  if (startsUpper) return internalUpper ? "pascal" : "capital";
  return "camel";
}

const capitalize = (w: string): string => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** Render words in a given casing convention. */
export function renderCase(words: string[], style: CaseStyle): string {
  const lower = words.map((w) => w.toLowerCase());
  switch (style) {
    case "lower": return lower.join("");
    case "upper": return lower.join("").toUpperCase();
    case "capital": return capitalize(lower.join(""));
    case "camel": return lower.map((w, i) => (i === 0 ? w : capitalize(w))).join("");
    case "pascal": return lower.map(capitalize).join("");
    case "snake": return lower.join("_");
    case "screamingSnake": return lower.map((w) => w.toUpperCase()).join("_");
    case "kebab": return lower.join("-");
  }
}

/** Convert an identifier from whatever style it is in into the target style. */
export function convertCase(identifier: string, style: CaseStyle): string {
  return renderCase(splitWords(identifier), style);
}

function sameWords(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/**
 * Replace every identifier in `text` whose words match `search` with
 * `replacement`, rendered in the same casing convention as each occurrence.
 * Matching is convention-insensitive: `fooBar`, `foo_bar` and `FOO_BAR` all
 * match a search of `fooBar`.
 */
export function replacePreservingCase(text: string, search: string, replacement: string): string {
  const searchWords = splitWords(search);
  const replacementWords = splitWords(replacement);
  if (searchWords.length === 0) return text;

  // Identifier tokens across conventions include letters, digits, `_` and `-`.
  return text.replace(/[A-Za-z][A-Za-z0-9_-]*/g, (token) => {
    if (!sameWords(splitWords(token), searchWords)) return token;
    return renderCase(replacementWords, detectCase(token));
  });
}
