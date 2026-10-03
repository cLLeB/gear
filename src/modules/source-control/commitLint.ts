// Commit message lint: the commitlint/conventional-commits checks plus the
// classic git hygiene rules (50/72, blank line after the subject, imperative
// mood, no trailing period). Returns friendly, actionable findings.

export type LintLevel = "error" | "warning";

export interface CommitLintIssue {
  level: LintLevel;
  message: string;
}

export const CONVENTIONAL_TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"] as const;

const HEADER_RE = /^(\w+)(\(([^()]*)\))?(!)?: (.*)$/;

// Past tense / third person openers that should be imperative ("add", not "added").
const NON_IMPERATIVE = /^(added|adds|adding|fixed|fixes|fixing|updated|updates|updating|removed|removes|removing|changed|changes|changing|created|creates|implemented|implements|refactored|refactors|improved|improves|renamed|renames|moved|moves|deleted|deletes|bumped|bumps)\b/i;

export interface CommitLintOptions {
  /** Enforce the Conventional Commits header format. */
  conventional?: boolean;
  subjectMax?: number;
  bodyLineMax?: number;
}

export function lintCommitMessage(message: string, options: CommitLintOptions = {}): CommitLintIssue[] {
  const { conventional = true, subjectMax = 72, bodyLineMax = 100 } = options;
  const issues: CommitLintIssue[] = [];
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  // Lines starting with "#" are stripped by git's default cleanup.
  const meaningful = lines.filter((l) => !l.startsWith("#"));
  const header = meaningful[0] ?? "";
  if (header.trim() === "") return [{ level: "error", message: "The subject line is empty" }];
  if (/^(fixup|squash|amend)! /.test(header) || /^Merge /.test(header) || /^Revert "/.test(header)) return [];

  let subject = header;
  if (conventional) {
    const m = HEADER_RE.exec(header);
    if (!m) {
      issues.push({ level: "error", message: 'Use "type(scope): subject", e.g. "fix(editor): keep cursor on save"' });
    } else {
      const [, type, , scope, , rest] = m;
      subject = rest;
      if (!(CONVENTIONAL_TYPES as readonly string[]).includes(type)) {
        issues.push({ level: type === type.toLowerCase() ? "warning" : "error", message: `Unknown type "${type}" (expected ${CONVENTIONAL_TYPES.join(", ")})` });
      }
      if (scope !== undefined && scope.trim() === "") issues.push({ level: "error", message: "The scope in parentheses is empty" });
      if (/^[A-Z][a-z]/.test(subject)) issues.push({ level: "warning", message: "Start the subject in lower case" });
    }
  } else if (/^[a-z]/.test(header)) {
    issues.push({ level: "warning", message: "Capitalise the subject line" });
  }
  if (subject.trim() === "") issues.push({ level: "error", message: "The subject is empty" });
  if (header.length > subjectMax) issues.push({ level: "warning", message: `Subject is ${header.length} characters; keep it within ${subjectMax}` });
  if (/[.。]\s*$/.test(header)) issues.push({ level: "warning", message: "Drop the trailing period from the subject" });
  if (NON_IMPERATIVE.test(subject.trim())) {
    const verb = NON_IMPERATIVE.exec(subject.trim())![1].toLowerCase();
    issues.push({ level: "warning", message: `Use the imperative mood ("${verb.replace(/(ed|es|s|ing)$/, "")}…", not "${verb}…")` });
  }
  if (/\s$/.test(header)) issues.push({ level: "warning", message: "Remove trailing whitespace from the subject" });
  if (meaningful.length > 1 && meaningful[1].trim() !== "") {
    issues.push({ level: "error", message: "Leave a blank line between the subject and the body" });
  }
  const longBody = meaningful.slice(2).findIndex((l) => l.length > bodyLineMax && !/https?:\/\//.test(l));
  if (longBody !== -1) issues.push({ level: "warning", message: `Body line ${longBody + 3} is longer than ${bodyLineMax} characters` });
  return issues;
}
