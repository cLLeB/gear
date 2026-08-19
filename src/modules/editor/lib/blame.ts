import type { GitBlameCommit, GitBlameResult } from "@/modules/ai/lib/native";

export type BlameCommit = GitBlameCommit;
export type BlameResult = GitBlameResult;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Compact age for a gutter that has ~10 characters to work with. */
export function formatBlameAge(authorTime: number, nowSeconds: number): string {
  const delta = Math.max(0, Math.floor(nowSeconds - authorTime));
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < MONTH) return `${Math.floor(delta / DAY)}d`;
  if (delta < YEAR) return `${Math.floor(delta / MONTH)}mo`;
  return `${Math.floor(delta / YEAR)}y`;
}

/** First name, or initials for a long one — the gutter cannot show much. */
export function shortAuthor(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (first.length <= 10) return first;
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || first.slice(0, 10);
}

/** Text drawn in the gutter for one line. */
export function blameLabel(
  commit: BlameCommit | null,
  nowSeconds: number,
): string {
  if (!commit) return "";
  if (commit.uncommitted) return "uncommitted";
  return `${shortAuthor(commit.author)} ${formatBlameAge(commit.authorTime, nowSeconds)}`;
}

/** Full detail for the gutter tooltip. */
export function blameTooltip(commit: BlameCommit | null): string {
  if (!commit) return "";
  if (commit.uncommitted) return "Not committed yet";
  const when = new Date(commit.authorTime * 1000).toLocaleString();
  return `${commit.sha.slice(0, 8)}  ${commit.author}  ${when}\n${commit.summary}`;
}

/** Resolves the commit for a 1-based line, or null when it is outside blame. */
export function commitForLine(
  blame: BlameResult | null,
  line: number,
): BlameCommit | null {
  if (!blame || line < 1 || line > blame.lines.length) return null;
  const index = blame.lines[line - 1];
  return blame.commits[index] ?? null;
}

/**
 * Stable colour per commit so neighbouring changes are visually separable
 * without a legend. Hue only — the gutter keeps a single low opacity.
 */
export function blameHue(sha: string): number {
  let h = 0;
  for (let i = 0; i < sha.length; i++) h = (h * 31 + sha.charCodeAt(i)) % 360;
  return h;
}
