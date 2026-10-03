// Quick select: pull the "things you'd want to copy" out of what's on screen —
// WezTerm's QuickSelect and Kitty's hints kitten. Order of patterns matters:
// earlier kinds claim their span, so a URL's path is not re-reported as a path.

export type TokenKind =
  | "url"
  | "email"
  | "uuid"
  | "sha"
  | "ip"
  | "path"
  | "hexcolor"
  | "number";

export interface QuickToken {
  kind: TokenKind;
  text: string;
  /** How many times it appeared; repeated tokens rank higher. */
  count: number;
}

const PATTERNS: Array<{ kind: TokenKind; re: RegExp }> = [
  { kind: "url", re: /\b(?:https?|ftp|file|ssh|git):\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g },
  { kind: "email", re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  { kind: "uuid", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { kind: "sha", re: /\b[0-9a-f]{7,40}\b/g },
  { kind: "ip", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{1,5})?\b/g },
  {
    kind: "path",
    re: /(?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?|\b[\w.@+-]+(?:\/[\w.@+-]+)+\b|\b[A-Za-z]:\\[\w\\.@+ -]+/g,
  },
  { kind: "hexcolor", re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g },
  { kind: "number", re: /(?<![\w.])\d{4,}(?![\w.])/g },
];

function isPlausibleSha(s: string): boolean {
  // Must mix letters and digits; pure digits are numbers, pure letters are words.
  return /\d/.test(s) && /[a-f]/.test(s);
}

export function extractTokens(text: string): QuickToken[] {
  const found = new Map<string, QuickToken>();
  const order: string[] = [];
  for (const line of text.split("\n")) {
    const claimed: Array<[number, number]> = [];
    const free = (s: number, e: number) => !claimed.some(([a, b]) => s < b && e > a);
    for (const { kind, re } of PATTERNS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const s = m.index!;
        const e = s + m[0].length;
        if (!free(s, e)) continue;
        if (kind === "sha" && !isPlausibleSha(m[0])) continue;
        if (kind === "path" && m[0].length < 3) continue;
        claimed.push([s, e]);
        const key = `${kind}\u0000${m[0]}`;
        const prev = found.get(key);
        if (prev) prev.count++;
        else {
          found.set(key, { kind, text: m[0], count: 1 });
          order.push(key);
        }
      }
    }
  }
  // Most recent (bottom of the screen) first, as that's usually what you want.
  return order.reverse().map((k) => found.get(k)!);
}

export const TOKEN_LABELS: Record<TokenKind, string> = {
  url: "URLs",
  email: "Emails",
  uuid: "UUIDs",
  sha: "Hashes",
  ip: "IP addresses",
  path: "Paths",
  hexcolor: "Colors",
  number: "Numbers",
};
