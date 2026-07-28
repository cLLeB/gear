/** Split an identifier into lowercase words across camelCase, snake, kebab, spaces. */
export function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** convert to camelCase */
export function toCamelCase(input: string): string {
  const words = splitWords(input);
  return words
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join("");
}

/** convert to PascalCase */
export function toPascalCase(input: string): string {
  return splitWords(input)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** convert to snake_case */
export function toSnakeCase(input: string): string {
  return splitWords(input).join("_");
}

/** convert to kebab-case */
export function toKebabCase(input: string): string {
  return splitWords(input).join("-");
}

/** convert to CONSTANT_CASE */
export function toConstantCase(input: string): string {
  return splitWords(input).join("_").toUpperCase();
}
