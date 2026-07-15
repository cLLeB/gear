const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const UNESCAPES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&#x27;": "'",
};

/** Escape the five XML/HTML-significant characters for safe interpolation. */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Reverse escapeHtml, including a few common numeric entities. */
export function unescapeHtml(input: string): string {
  return input.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/g, (m) => UNESCAPES[m]);
}
