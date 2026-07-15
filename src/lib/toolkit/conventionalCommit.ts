export interface ConventionalCommit {
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
}

const HEADER_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

/**
 * Parse the header line of a Conventional Commit message. Returns null when the
 * line does not follow the `type(scope)!: description` shape.
 */
export function parseConventionalCommit(header: string): ConventionalCommit | null {
  const match = HEADER_RE.exec(header.trim());
  if (!match) return null;
  return {
    type: match[1].toLowerCase(),
    scope: match[2] ?? null,
    breaking: match[3] === "!",
    description: match[4].trim(),
  };
}

/** Build a conventional commit header from parts. */
export function formatConventionalCommit(commit: ConventionalCommit): string {
  const scope = commit.scope ? `(${commit.scope})` : "";
  const bang = commit.breaking ? "!" : "";
  return `${commit.type}${scope}${bang}: ${commit.description}`;
}
