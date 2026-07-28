/** Uppercase the first character, leaving the rest unchanged. */
export function capitalize(input: string): string {
  return input.length === 0 ? input : input[0].toUpperCase() + input.slice(1);
}

/** Lowercase the first character, leaving the rest unchanged. */
export function uncapitalize(input: string): string {
  return input.length === 0 ? input : input[0].toLowerCase() + input.slice(1);
}

/** Swap the case of every character. */
export function swapCase(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    out += ch === lower ? ch.toUpperCase() : lower;
  }
  return out;
}

/** Capitalize the first letter of each whitespace-separated word. */
export function capitalizeWords(input: string): string {
  return input.replace(/\S+/g, (word) => capitalize(word));
}
