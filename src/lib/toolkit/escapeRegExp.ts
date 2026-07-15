/**
 * Escape a string so it can be embedded literally inside a RegExp. Useful for
 * turning user search input into a safe pattern.
 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a RegExp that matches the literal input, with optional flags. */
export function literalRegExp(input: string, flags = ""): RegExp {
  return new RegExp(escapeRegExp(input), flags);
}
