// Ways to reference "this file / these lines" when pasting into a terminal,
// a chat with an AI agent, an issue, or docs.

export interface PathRefInput {
  path: string;
  root: string | null;
  line: number;
  column: number;
  endLine: number;
}

export interface PathRef {
  label: string;
  value: string;
}

function relative(path: string, root: string | null): string {
  const p = path.replace(/\\/g, "/");
  if (!root) return p;
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

export function pathReferences(input: PathRefInput): PathRef[] {
  const rel = relative(input.path, input.root);
  const name = rel.replace(/^.*\//, "");
  const range = input.endLine > input.line ? `${input.line}-${input.endLine}` : `${input.line}`;
  return [
    { label: "Relative path", value: rel },
    { label: "Absolute path", value: input.path },
    { label: "Relative path:line:column", value: `${rel}:${input.line}:${input.column}` },
    { label: "Agent mention (@path#L)", value: `@${rel}#L${range.replace("-", "-L")}` },
    { label: "Markdown link", value: `[${name}${input.endLine > input.line ? ` L${range}` : `:${input.line}`}](${rel.split("/").map(encodeURIComponent).join("/")}#L${range.replace("-", "-L")})` },
    { label: "File name", value: name },
    { label: "Directory", value: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "." },
  ];
}
