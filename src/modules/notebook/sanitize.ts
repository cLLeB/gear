// Allowlist HTML sanitizer for notebook outputs (pandas tables, rich reprs)
// and rendered Markdown: keeps structural / formatting tags, drops scripts,
// event handlers, iframes, forms and non-data/non-http URLs.

const ALLOWED = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span", "strong",
  "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "var", "svg", "g", "path", "circle", "rect", "line", "polyline",
  "polygon", "text", "tspan", "defs", "style",
]);
const ATTRS = new Set(["class", "style", "title", "alt", "colspan", "rowspan", "align", "valign", "width", "height", "href", "src", "id", "type", "checked", "disabled", "open",
  "viewbox", "d", "fill", "stroke", "stroke-width", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "points", "transform", "xmlns", "font-size", "text-anchor"]);

function safeUrl(v: string, img: boolean): boolean {
  const s = v.trim().toLowerCase();
  if (img) return s.startsWith("data:image/") || s.startsWith("https:") || s.startsWith("http:");
  return s.startsWith("https:") || s.startsWith("http:") || s.startsWith("#") || s.startsWith("mailto:");
}

/** Sanitized HTML string (requires a DOM). */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return "";
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        // Unknown wrappers keep their text; dangerous elements go entirely.
        if (["script", "iframe", "object", "embed", "form", "link", "meta", "base", "noscript", "template", "frame", "frameset", "applet"].includes(tag)) child.remove();
        else {
          walk(child);
          child.replaceWith(...child.childNodes);
        }
        continue;
      }
      for (const a of [...child.attributes]) {
        const name = a.name.toLowerCase();
        if (!ATTRS.has(name) || name.startsWith("on")) child.removeAttribute(a.name);
        else if ((name === "href" || name === "src") && !safeUrl(a.value, tag === "img")) child.removeAttribute(a.name);
        else if (name === "style" && /expression|url\s*\(|javascript:|@import/i.test(a.value)) child.removeAttribute(a.name);
      }
      if (tag === "input" && child.getAttribute("type") !== "checkbox") child.remove();
      if (tag === "a") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      if (tag === "style") child.textContent = (child.textContent ?? "").replace(/@import[^;]*;?|url\s*\([^)]*\)|expression\s*\(/gi, "");
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
