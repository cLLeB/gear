// Language-aware code edits that don't need a language server: debug-print
// insertion/removal (Turbo Console Log style), surround-with templates,
// extract-to-variable, string concatenation → template literal, line numbers.

export type LangFamily = "js" | "py" | "rs" | "go" | "java" | "cs" | "rb" | "php" | "c" | "sh" | "kt" | "swift" | "other";

export function langFamily(languageId: string, path = ""): LangFamily {
  const id = `${languageId} ${path}`.toLowerCase();
  if (/typescript|javascript|\.m?[jt]sx?\b|jsx|tsx|vue|svelte/.test(id)) return "js";
  if (/python|\.py\b/.test(id)) return "py";
  if (/rust|\.rs\b/.test(id)) return "rs";
  if (/\bgo\b|golang|\.go\b/.test(id)) return "go";
  if (/kotlin|\.kts?\b/.test(id)) return "kt";
  if (/java\b|\.java\b/.test(id)) return "java";
  if (/csharp|c#|\.cs\b/.test(id)) return "cs";
  if (/ruby|\.rb\b/.test(id)) return "rb";
  if (/php/.test(id)) return "php";
  if (/swift/.test(id)) return "swift";
  if (/\bc\b|cpp|c\+\+|\.(c|cc|cpp|h|hpp)\b/.test(id)) return "c";
  if (/shell|bash|zsh|\.sh\b|powershell/.test(id)) return "sh";
  return "other";
}

/** Marker so inserted prints can be found and removed again. */
export const DEBUG_MARK = "🔍";

/** A print statement for `expr` labelled with file:line. */
export function debugLogFor(family: LangFamily, expr: string, label: string): string {
  const tag = `${DEBUG_MARK} ${label} ${expr}`;
  const str = JSON.stringify(tag);
  switch (family) {
    case "js":
      return `console.log(${str}, ${expr});`;
    case "py":
      return `print(f"${tag.replace(/"/g, '\\"').replace(/[{}]/g, (c) => c + c)} = {${expr}!r}")`;
    case "rs":
      return `dbg!(&${expr}); // ${DEBUG_MARK} ${label}`;
    case "go":
      return `fmt.Printf("${tag.replace(/"/g, '\\"')} = %+v\\n", ${expr})`;
    case "java":
      return `System.out.println(${str} + " = " + ${expr});`;
    case "kt":
      return `println("${tag.replace(/"/g, '\\"')} = $${/^\w+$/.test(expr) ? expr : `{${expr}}`}")`;
    case "cs":
      return `Console.WriteLine($"${tag.replace(/"/g, '""').replace(/[{}]/g, (c) => c + c)} = {${expr}}");`;
    case "rb":
      return `p(${str}, ${expr})`;
    case "php":
      return `error_log(${str} . ' = ' . print_r(${expr}, true));`;
    case "swift":
      return `print(${str}, ${expr})`;
    case "c":
      return `fprintf(stderr, "${tag.replace(/"/g, '\\"')}\\n"); /* ${DEBUG_MARK} */`;
    case "sh":
      return `echo "${tag.replace(/"/g, '\\"')} = ${/^\w+$/.test(expr) ? `$${expr}` : expr}" >&2`;
    default:
      return `// ${tag}`;
  }
}

/** Remove whole lines carrying the debug marker (and, optionally, any console.log/print). */
export function removeDebugLines(text: string, all = false, family: LangFamily = "other"): { text: string; removed: number } {
  const generic: Record<LangFamily, RegExp | null> = {
    js: /^\s*console\.(log|debug|info|trace|dir|table)\(.*\);?\s*$/,
    py: /^\s*print\(.*\)\s*$/,
    rs: /^\s*(dbg!|println!|eprintln!)\(.*\);?\s*$/,
    go: /^\s*fmt\.Print(ln|f)?\(.*\)\s*$/,
    java: /^\s*System\.(out|err)\.print(ln|f)?\(.*\);\s*$/,
    kt: /^\s*println\(.*\)\s*$/,
    cs: /^\s*Console\.Write(Line)?\(.*\);\s*$/,
    rb: /^\s*(p|puts|pp)[ (].*$/,
    php: /^\s*(var_dump|print_r|error_log)\(.*\);\s*$/,
    swift: /^\s*(print|debugPrint)\(.*\)\s*$/,
    c: /^\s*(printf|fprintf\(stderr)\(.*\);\s*$/,
    sh: null,
    other: null,
  };
  const lines = text.split("\n");
  const keep = lines.filter((l) => !(l.includes(DEBUG_MARK) || (all && generic[family]?.test(l))));
  return { text: keep.join("\n"), removed: lines.length - keep.length };
}

export interface SurroundTemplate {
  label: string;
  /** `$BODY` is replaced by the indented selection; `$I` by one indent unit. */
  template: string;
}

const C_LIKE: SurroundTemplate[] = [
  { label: "if", template: "if (condition) {\n$BODY\n}" },
  { label: "if / else", template: "if (condition) {\n$BODY\n} else {\n$I\n}" },
  { label: "for", template: "for (let i = 0; i < n; i++) {\n$BODY\n}" },
  { label: "while", template: "while (condition) {\n$BODY\n}" },
  { label: "block { }", template: "{\n$BODY\n}" },
];

export function surroundTemplates(family: LangFamily): SurroundTemplate[] {
  switch (family) {
    case "js":
      return [
        { label: "try / catch", template: "try {\n$BODY\n} catch (error) {\n$Iconsole.error(error);\n}" },
        { label: "try / finally", template: "try {\n$BODY\n} finally {\n$I\n}" },
        ...C_LIKE,
        { label: "for…of", template: "for (const item of items) {\n$BODY\n}" },
        { label: "async IIFE", template: "(async () => {\n$BODY\n})();" },
        { label: "function", template: "function name() {\n$BODY\n}" },
        { label: "#region", template: "// #region name\n$BODY\n// #endregion" },
      ];
    case "py":
      return [
        { label: "try / except", template: "try:\n$BODY\nexcept Exception as error:\n${I}raise" },
        { label: "if", template: "if condition:\n$BODY" },
        { label: "for", template: "for item in items:\n$BODY" },
        { label: "while", template: "while condition:\n$BODY" },
        { label: "with", template: "with resource as r:\n$BODY" },
        { label: "def", template: "def name():\n$BODY" },
      ];
    case "rs":
      return [
        { label: "if", template: "if condition {\n$BODY\n}" },
        { label: "loop", template: "loop {\n$BODY\n}" },
        { label: "for", template: "for item in items {\n$BODY\n}" },
        { label: "unsafe", template: "unsafe {\n$BODY\n}" },
        { label: "block { }", template: "{\n$BODY\n}" },
        { label: "fn", template: "fn name() {\n$BODY\n}" },
      ];
    case "go":
      return [
        { label: "if err != nil", template: "if err != nil {\n$BODY\n}" },
        { label: "if", template: "if condition {\n$BODY\n}" },
        { label: "for", template: "for i := 0; i < n; i++ {\n$BODY\n}" },
        { label: "for range", template: "for _, item := range items {\n$BODY\n}" },
        { label: "go func", template: "go func() {\n$BODY\n}()" },
        { label: "func", template: "func name() {\n$BODY\n}" },
      ];
    case "rb":
      return [
        { label: "begin / rescue", template: "begin\n$BODY\nrescue StandardError => e\n${I}raise\nend" },
        { label: "if", template: "if condition\n$BODY\nend" },
        { label: "each", template: "items.each do |item|\n$BODY\nend" },
        { label: "def", template: "def name\n$BODY\nend" },
      ];
    case "sh":
      return [
        { label: "if", template: 'if [ condition ]; then\n$BODY\nfi' },
        { label: "for", template: 'for item in "$@"; do\n$BODY\ndone' },
        { label: "while", template: "while condition; do\n$BODY\ndone" },
        { label: "function", template: "name() {\n$BODY\n}" },
        { label: "subshell ( )", template: "(\n$BODY\n)" },
      ];
    case "java":
    case "cs":
    case "kt":
    case "php":
    case "c":
    case "swift":
      return [
        { label: "try / catch", template: family === "swift" ? "do {\n$BODY\n} catch {\n${I}print(error)\n}" : `try {\n$BODY\n} catch (${family === "cs" ? "Exception e" : family === "kt" ? "e: Exception" : family === "php" ? "\\Throwable $e" : family === "c" ? "..." : "Exception e"}) {\n$I\n}` },
        ...C_LIKE,
      ];
    default:
      return C_LIKE;
  }
}

/** Indent `body` one level and drop it into `template`, all relative to `baseIndent`. */
export function applySurround(template: string, body: string, baseIndent: string, unit: string): string {
  const lines = body.replace(/\n$/, "").split("\n");
  const common = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  const indented = lines.map((l) => (l.trim() ? baseIndent + unit + l.slice(Number.isFinite(common) ? common : 0) : "")).join("\n");
  return template
    .split("\n")
    .map((l) => (l === "$BODY" ? indented : baseIndent + l.replace(/\$\{I\}|\$I/g, unit)))
    .join("\n");
}

/** Text-based extract-variable: declaration line + the replacement for the selection. */
export function extractVariable(family: LangFamily, name: string, expr: string): { declaration: string; reference: string } {
  const decl: Record<LangFamily, string> = {
    js: `const ${name} = ${expr};`,
    py: `${name} = ${expr}`,
    rs: `let ${name} = ${expr};`,
    go: `${name} := ${expr}`,
    java: `var ${name} = ${expr};`,
    kt: `val ${name} = ${expr}`,
    cs: `var ${name} = ${expr};`,
    rb: `${name} = ${expr}`,
    php: `$${name} = ${expr};`,
    swift: `let ${name} = ${expr}`,
    c: `auto ${name} = ${expr};`,
    sh: `${name}=${expr}`,
    other: `const ${name} = ${expr};`,
  };
  const reference = family === "php" ? `$${name}` : family === "sh" ? `"$${name}"` : name;
  return { declaration: decl[family], reference };
}

/** Suggest a variable name for an expression: user.profile.name → name, getUser() → user. */
export function suggestName(expr: string): string {
  const call = /([A-Za-z_]\w*)\s*\([^()]*\)\s*$/.exec(expr);
  let base = call ? call[1].replace(/^(get|fetch|load|read|find|compute|calc|make|create|build)(?=[A-Z_])/, "") : (/([A-Za-z_]\w*)\s*$/.exec(expr)?.[1] ?? "");
  base = base.replace(/^_+/, "");
  if (!base || /^\d/.test(base)) return /^["'`]/.test(expr.trim()) ? "text" : /^\d/.test(expr.trim()) ? "value" : "value";
  return base[0].toLowerCase() + base.slice(1);
}

/** 'Hello ' + name + '!' → `Hello ${name}!` (JS/TS). Returns null when it isn't a concatenation. */
export function concatToTemplate(expr: string): string | null {
  const parts: string[] = [];
  let i = 0;
  let cur = "";
  let depth = 0;
  const s = expr.trim();
  while (i < s.length) {
    const c = s[i];
    if ((c === "'" || c === '"' || c === "`") && depth === 0) {
      const q = c;
      let j = i + 1;
      while (j < s.length && s[j] !== q) j += s[j] === "\\" ? 2 : 1;
      cur += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "+" && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
    i++;
  }
  parts.push(cur.trim());
  if (parts.length < 2 || !parts.some((p) => /^["'`]/.test(p))) return null;
  const body = parts
    .map((p) => {
      const m = /^(["'])([\s\S]*)\1$/.exec(p);
      if (m) return m[2].replace(/\\(["'])/g, "$1").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
      const t = /^`([\s\S]*)`$/.exec(p);
      if (t) return t[1];
      return `\${${p}}`;
    })
    .join("");
  return `\`${body}\``;
}

/** Prefix lines with numbers ("1. ", padded) or strip such prefixes. */
export function addLineNumbers(text: string, start = 1, sep = ". "): string {
  const lines = text.split("\n");
  const width = String(start + lines.length - 1).length;
  return lines.map((l, i) => `${String(start + i).padStart(width)}${sep}${l}`).join("\n");
}

export function removeLineNumbers(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*\d+(?:[.):|]\s?|\s+|\t)/, ""))
    .join("\n");
}
