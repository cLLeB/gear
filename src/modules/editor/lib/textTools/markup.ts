// Pretty-print and minify XML/HTML. A small tokenizer splits tags, text,
// comments, CDATA, doctypes and processing instructions; the printer
// indents nesting, keeps text-only elements on one line, never touches the
// contents of <pre>, <textarea>, <script> and <style>, and knows HTML's void
// elements so <br> and <img> don't open a level.

type Node =
  | { kind: "open"; name: string; raw: string; selfClosing: boolean }
  | { kind: "close"; name: string; raw: string }
  | { kind: "text"; raw: string }
  | { kind: "raw"; raw: string }; // comment, CDATA, doctype, PI, preserved body

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const PRESERVE = new Set(["pre", "textarea", "script", "style"]);

export function tokenizeMarkup(src: string): Node[] {
  const out: Node[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      const stop = end === -1 ? src.length : end + 3;
      out.push({ kind: "raw", raw: src.slice(i, stop) });
      i = stop;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i);
      const stop = end === -1 ? src.length : end + 3;
      out.push({ kind: "raw", raw: src.slice(i, stop) });
      i = stop;
    } else if (src.startsWith("<!", i) || src.startsWith("<?", i)) {
      const end = src.indexOf(">", i);
      const stop = end === -1 ? src.length : end + 1;
      out.push({ kind: "raw", raw: src.slice(i, stop) });
      i = stop;
    } else if (src[i] === "<" && /[A-Za-z/]/.test(src[i + 1] ?? "")) {
      // Find the tag end, skipping quoted attribute values.
      let j = i + 1;
      let q: string | null = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (c === ">") break;
      }
      const raw = src.slice(i, j + 1);
      const close = /^<\/\s*([\w:.-]+)/.exec(raw);
      if (close) out.push({ kind: "close", name: close[1].toLowerCase(), raw: `</${close[1]}>` });
      else {
        const name = /^<\s*([\w:.-]+)/.exec(raw)?.[1] ?? "";
        const selfClosing = /\/\s*>$/.test(raw);
        out.push({ kind: "open", name: name.toLowerCase(), raw: raw.replace(/\s+/g, " ").replace(/\s+(\/?)>$/, "$1>"), selfClosing });
        if (PRESERVE.has(name.toLowerCase()) && !selfClosing) {
          const endTag = new RegExp(`</\\s*${name}\\s*>`, "i");
          const rest = src.slice(j + 1);
          const m = endTag.exec(rest);
          const bodyEnd = m ? m.index : rest.length;
          if (bodyEnd > 0) out.push({ kind: "raw", raw: rest.slice(0, bodyEnd) });
          i = j + 1 + bodyEnd;
          continue;
        }
      }
      i = j + 1;
    } else {
      const next = src.indexOf("<", i + 1);
      const stop = next === -1 ? src.length : next;
      out.push({ kind: "text", raw: src.slice(i, stop) });
      i = stop;
    }
  }
  return out;
}

export function formatMarkup(src: string, indentUnit = "  "): string {
  const nodes = tokenizeMarkup(src.trim());
  const lines: string[] = [];
  let depth = 0;
  const pad = () => indentUnit.repeat(depth);
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    if (n.kind === "text") {
      const t = n.raw.replace(/\s+/g, " ").trim();
      if (t) lines.push(pad() + t);
      continue;
    }
    if (n.kind === "raw") {
      // Preserved bodies keep their own layout.
      lines.push(n.raw.startsWith("<") ? pad() + n.raw : n.raw.replace(/^\n+|\s+$/g, ""));
      continue;
    }
    if (n.kind === "close") {
      depth = Math.max(0, depth - 1);
      lines.push(pad() + n.raw);
      continue;
    }
    const isVoid = n.selfClosing || VOID.has(n.name);
    // <a>text</a> stays on one line.
    const a = nodes[k + 1];
    const b = nodes[k + 2];
    if (!isVoid && a?.kind === "text" && b?.kind === "close" && b.name === n.name && !a.raw.includes("\n\n")) {
      lines.push(pad() + n.raw + a.raw.replace(/\s+/g, " ").trim() + b.raw);
      k += 2;
      continue;
    }
    if (!isVoid && a?.kind === "close" && a.name === n.name) {
      lines.push(pad() + n.raw + a.raw);
      k += 1;
      continue;
    }
    if (!isVoid && PRESERVE.has(n.name) && a?.kind === "raw" && b?.kind === "close") {
      lines.push(pad() + n.raw + a.raw + b.raw);
      k += 2;
      continue;
    }
    lines.push(pad() + n.raw);
    if (!isVoid) depth++;
  }
  return lines.join("\n");
}

export function minifyMarkup(src: string): string {
  return tokenizeMarkup(src)
    .filter((n) => !(n.kind === "raw" && n.raw.startsWith("<!--") && !n.raw.startsWith("<!--[if")))
    .map((n) => (n.kind === "text" ? n.raw.replace(/\s+/g, " ") : n.raw))
    .join("")
    .replace(/>\s+</g, "><")
    .trim();
}
