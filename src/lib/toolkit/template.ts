export interface TemplateOptions {
  /** Value used for keys missing from the data. Defaults to "" (empty). */
  fallback?: string;
  /** Keep the original "{{key}}" token when a key is missing. Defaults to false. */
  keepMissing?: boolean;
}

/**
 * Interpolate a "{{key}}" mustache-lite template against a data object. Keys
 * support dotted paths ("user.name"). Escaped "\{{" renders a literal "{{".
 */
export function interpolate(
  template: string,
  data: Record<string, unknown>,
  options: TemplateOptions = {},
): string {
  const { fallback = "", keepMissing = false } = options;

  return template.replace(/\\\{\{|\{\{\s*([\w.]+)\s*\}\}/g, (match, path?: string) => {
    if (match === "\\{{") return "{{";
    const value = resolvePath(data, path!);
    if (value === undefined || value === null) return keepMissing ? match : fallback;
    return String(value);
  });
}

function resolvePath(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}

/** List the unique variable names referenced by a template. */
export function templateKeys(template: string): string[] {
  const keys = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) keys.add(m[1]);
  return [...keys];
}
