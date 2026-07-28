export interface GitStatusEntry {
  /** Staged (index) status code, e.g. "M", "A", "D", "R", or " ". */
  index: string;
  /** Unstaged (working tree) status code. */
  working: string;
  path: string;
  /** Original path for renames/copies. */
  origPath?: string;
  staged: boolean;
  untracked: boolean;
}

/**
 * Parse `git status --porcelain` (v1) output into structured entries. Handles
 * renames ("R  old -> new") and untracked ("?? path") lines.
 */
export function parseGitStatus(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];

  for (const line of output.split("\n")) {
    if (line.length < 4) continue;
    const index = line[0];
    const working = line[1];
    let rest = line.slice(3);
    let origPath: string | undefined;

    if (index === "R" || index === "C") {
      const arrow = rest.indexOf(" -> ");
      if (arrow !== -1) {
        origPath = rest.slice(0, arrow);
        rest = rest.slice(arrow + 4);
      }
    }

    entries.push({
      index,
      working,
      path: rest,
      origPath,
      staged: index !== " " && index !== "?",
      untracked: index === "?" && working === "?",
    });
  }
  return entries;
}
