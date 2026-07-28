import { parseArgv } from "./parseArgv";

/** Extract the executable name from a command line, ignoring env-var prefixes. */
export function extractCommandName(line: string): string | null {
  const tokens = parseArgv(line);
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; // FOO=bar prefix
    const base = token.replace(/\\/g, "/").split("/").pop() ?? token;
    return base || null;
  }
  return null;
}

const DANGER_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-\w*\s+)*-?\w*[rf]/i, // rm -rf and friends
  /\bmkfs\b/i,
  /\bdd\b.*\bof=\/dev\//i,
  />\s*\/dev\/sd[a-z]/i,
  /:\(\)\s*\{.*\|.*&\s*\}/, // fork bomb
  /\bchmod\s+-R\s+0?777\s+\//i,
  /\bgit\s+push\s+.*--force/i,
  /\bsudo\s+rm\b/i,
];

/** Heuristically flag command lines that are likely destructive. */
export function isDangerousCommand(line: string): boolean {
  return DANGER_PATTERNS.some((re) => re.test(line));
}
