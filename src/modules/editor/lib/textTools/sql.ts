// A pragmatic SQL formatter. It tokenizes (so strings, comments, quoted
// identifiers and $$-bodies are never altered), upper-cases keywords, puts
// each major clause on its own line, lists SELECT columns one per line,
// breaks AND/OR conditions, and indents parenthesised subqueries.

type Tok = { type: "word" | "string" | "comment" | "punct" | "number" | "space"; text: string };

const KEYWORDS = new Set(
  (
    "select from where and or not in is null like ilike between exists as on using join inner left right full outer cross natural " +
    "group by order having limit offset fetch first rows only union all intersect except distinct insert into values update set " +
    "delete returning with recursive case when then else end asc desc nulls create table view index drop alter add column " +
    "primary key foreign references default unique check constraint if replace truncate begin commit rollback over partition window " +
    "filter lateral true false cast interval date timestamp"
  ).split(" "),
);

// Clauses that start a new line at the current indentation.
const CLAUSES = [
  "select distinct", "select", "from", "where", "group by", "order by", "having", "limit", "offset", "fetch",
  "union all", "union", "intersect", "except", "insert into", "values", "update", "set", "delete from",
  "returning", "with recursive", "with", "window",
  "left outer join", "right outer join", "full outer join", "left join", "right join", "full join",
  "inner join", "cross join", "natural join", "join", "on conflict",
];

export function tokenizeSql(sql: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\s+/.exec(rest))) toks.push({ type: "space", text: m[0] });
    else if ((m = /^--[^\n]*/.exec(rest)) || (m = /^\/\*[\s\S]*?\*\//.exec(rest))) toks.push({ type: "comment", text: m[0] });
    else if ((m = /^'(?:[^']|'')*'/.exec(rest)) || (m = /^"(?:[^"]|"")*"/.exec(rest)) || (m = /^`[^`]*`/.exec(rest)) || (m = /^\[[^\]]*\]/.exec(rest)))
      toks.push({ type: "string", text: m[0] });
    else if ((m = /^(\$\w*\$)[\s\S]*?\1/.exec(rest))) toks.push({ type: "string", text: m[0] });
    else if ((m = /^\d+(\.\d+)?/.exec(rest))) toks.push({ type: "number", text: m[0] });
    else if ((m = /^[A-Za-z_][\w$]*/.exec(rest))) toks.push({ type: "word", text: m[0] });
    else if ((m = /^(::|<>|!=|<=|>=|\|\||->>|->)/.exec(rest))) toks.push({ type: "punct", text: m[0] });
    else toks.push({ type: "punct", text: sql[i] });
    i += toks[toks.length - 1].text.length;
  }
  return toks;
}

export interface SqlFormatOptions {
  indent?: string;
  uppercase?: boolean;
}

export function formatSql(sql: string, options: SqlFormatOptions = {}): string {
  const indentUnit = options.indent ?? "  ";
  const upper = options.uppercase ?? true;
  const toks = tokenizeSql(sql).filter((t) => t.type !== "space");
  const out: string[] = [];
  let line = "";
  let depth = 0;
  // Per paren level: did it open a subquery (indented block) or an expression?
  const parenStack: boolean[] = [];
  let clause = "";
  let betweenPending = false;
  let caseDepth = 0;
  const caseIndent: string[] = [];

  const ind = () => indentUnit.repeat(depth);
  const newline = (extra = 0) => {
    if (line.trim() !== "") out.push(line.replace(/\s+$/, ""));
    line = indentUnit.repeat(depth + extra);
  };
  const append = (text: string) => {
    if (line.trim() === "") line += text;
    else if (/[(.]$/.test(line) || text === "," || text === ")" || text === "." || text === ";" || text.startsWith("::")) line += text;
    else line += ` ${text}`;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "comment") {
      if (t.text.startsWith("--")) {
        append(t.text);
        newline();
      } else append(t.text);
      continue;
    }
    if (t.type === "word") {
      const lower = t.text.toLowerCase();
      // Longest multi-word clause match starting here.
      const words = [lower];
      for (let j = i + 1; j < toks.length && words.length < 3 && toks[j].type === "word"; j++) words.push(toks[j].text.toLowerCase());
      const hit = CLAUSES.map((c) => c.split(" ")).find((c) => c.every((w, k) => words[k] === w));
      if (hit && caseDepth === 0) {
        newline();
        const text = hit.join(" ");
        append(upper ? text.toUpperCase() : text);
        clause = text;
        i += hit.length - 1;
        if (["select", "select distinct", "set", "group by", "order by", "values", "returning"].includes(text)) newline(1);
        continue;
      }
      if (lower === "between") betweenPending = true;
      if (lower === "case") {
        caseDepth++;
        caseIndent.push(/^\s*/.exec(line)![0]);
      }
      if (lower === "end" && caseDepth > 0) {
        caseDepth--;
        caseIndent.pop();
      }
      if ((lower === "and" || lower === "or") && caseDepth === 0) {
        if (lower === "and" && betweenPending) {
          betweenPending = false;
        } else if (clause === "where" || clause === "having" || clause.endsWith("join") || clause === "on conflict") {
          newline(1);
        }
      }
      if ((lower === "when" || lower === "else") && caseDepth > 0) {
        if (line.trim() !== "") out.push(line.replace(/\s+$/, ""));
        line = caseIndent[caseIndent.length - 1] + indentUnit;
      }
      if (lower === "on" && clause.endsWith("join")) newline(1);
      append(KEYWORDS.has(lower) && upper ? t.text.toUpperCase() : t.text);
      continue;
    }
    if (t.text === "(") {
      const next = toks[i + 1];
      const sub = next?.type === "word" && /^(select|with)$/i.test(next.text);
      parenStack.push(sub);
      const prev = toks[i - 1];
      // Function calls hug their parenthesis: count(x), not count (x).
      if (prev?.type === "word" && !KEYWORDS.has(prev.text.toLowerCase()) && line.trim() !== "") line += "(";
      else append("(");
      if (sub) {
        depth++;
        newline();
      }
      continue;
    }
    if (t.text === ")") {
      const sub = parenStack.pop();
      if (sub) {
        depth = Math.max(0, depth - 1);
        newline();
        line = ind();
      }
      append(")");
      continue;
    }
    if (t.text === ",") {
      append(",");
      const inList = parenStack.length === 0 || parenStack[parenStack.length - 1] === true;
      if (inList && ["select", "select distinct", "set", "group by", "order by", "returning", "values"].includes(clause)) newline(1);
      continue;
    }
    if (t.text === ";") {
      append(";");
      newline();
      out.push("");
      clause = "";
      continue;
    }
    append(t.text);
  }
  newline();
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}
