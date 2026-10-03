// Command templates with typed placeholders, as in Warp Workflows:
//
//   {{name}}              free text
//   {{name:default}}      free text with a default
//   {{name|a|b|c}}        one of a fixed set of choices
//
// The same placeholder may appear more than once; it is asked for once.
// `\{{` escapes a literal "{{".

export interface TemplateParam {
  name: string;
  defaultValue: string | null;
  choices: string[] | null;
}

const PLACEHOLDER_RE = /(\\?)\{\{\s*([A-Za-z_][\w-]*)\s*(?::([^}|]*)|((?:\|[^}|]*)+))?\s*\}\}/g;

export function parseTemplate(template: string): TemplateParam[] {
  const params: TemplateParam[] = [];
  const seen = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    if (m[1]) continue; // escaped
    const name = m[2];
    if (seen.has(name)) continue;
    seen.add(name);
    const choices = m[4]
      ? m[4]
          .split("|")
          .slice(1)
          .map((c) => c.trim())
          .filter(Boolean)
      : null;
    params.push({
      name,
      defaultValue: m[3] !== undefined ? m[3].trim() : (choices?.[0] ?? null),
      choices: choices && choices.length > 0 ? choices : null,
    });
  }
  return params;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (whole, esc: string, name: string) => {
    if (esc) return whole.slice(1);
    return values[name] ?? whole;
  });
}

/** Human label for a parameter name: `branch_name` → "Branch name". */
export function paramLabel(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
