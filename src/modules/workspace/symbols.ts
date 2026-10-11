// Workspace-wide symbol search without a language server: one regex over all
// files finds declarations in the common languages, then each hit is parsed
// into a name and kind.

/** For the native (Rust regex) grep; matches the start of a declaration. */
export const SYMBOL_GREP_PATTERN = [
  // JS/TS/Rust/Go/Python/Ruby/Swift/Kotlin/PHP/C#/Java keywords
  String.raw`^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(pub(\([\w:]+\))?\s+)?(public\s+|private\s+|protected\s+|internal\s+)?(static\s+)?(final\s+|sealed\s+|data\s+|open\s+)?(function\*?|class|interface|type|enum|struct|trait|impl|mod|fn|def|func|module|protocol|object|record|namespace)\s+(\([^)]*\)\s*)?[A-Za-z_$]`,
  // const foo = (…) => / function
  String.raw`^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*(:[^=]+)?=\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(:\s*[^=]+)?=>`,
].join("|");

export interface WorkspaceSymbol {
  name: string;
  kind: string;
}

const KIND_ALIASES: Record<string, string> = {
  fn: "function",
  def: "function",
  func: "function",
  "function*": "function",
  mod: "module",
  impl: "impl",
};

export function parseSymbol(text: string): WorkspaceSymbol | null {
  const arrow = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(text);
  if (arrow && /=>/.test(text)) return { name: arrow[1], kind: "function" };
  const m =
    /\b(function\*?|class|interface|type|enum|struct|trait|impl|mod|fn|def|func|module|protocol|object|record|namespace)\s+(?:<[^>]*>\s*)?(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*(?:\s+for\s+[A-Za-z_$][\w$]*)?)/.exec(text);
  if (!m) return null;
  // Go methods: func (r *Recv) Name(
  const goMethod = /^\s*func\s+\([^)]*\)\s*([A-Za-z_]\w*)/.exec(text);
  const name = goMethod ? goMethod[1] : m[2];
  return { name, kind: KIND_ALIASES[m[1]] ?? m[1] };
}
