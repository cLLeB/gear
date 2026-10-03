// "Did you mean …?" for mistyped commands, in the spirit of zsh's `correct`
// and thefuck. Sources, best first:
//   1. the tool's own hint in its output (git, npm, cargo, docker, pip print
//      "The most similar command is …" / "Did you mean …");
//   2. edit distance against known subcommands of popular CLIs;
//   3. edit distance against known program names (built-ins plus programs
//      the user has run successfully in this session).

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

const SUBCOMMANDS: Record<string, readonly string[]> = {
  git: [
    "add", "am", "bisect", "blame", "branch", "checkout", "cherry-pick", "clean", "clone", "commit",
    "config", "diff", "fetch", "grep", "init", "log", "merge", "mv", "pull", "push", "rebase",
    "reflog", "remote", "reset", "restore", "revert", "rm", "show", "stash", "status", "switch",
    "tag", "worktree",
  ],
  npm: ["install", "uninstall", "update", "run", "test", "start", "build", "publish", "init", "audit", "outdated", "link", "ci", "exec", "version", "pack", "login", "whoami"],
  pnpm: ["install", "add", "remove", "update", "run", "test", "start", "build", "exec", "dlx", "outdated", "why", "store", "publish", "init"],
  yarn: ["install", "add", "remove", "upgrade", "run", "test", "start", "build", "dlx", "why", "init", "publish"],
  cargo: ["build", "check", "clean", "doc", "new", "init", "run", "test", "bench", "update", "search", "publish", "install", "uninstall", "fmt", "clippy", "add", "remove", "tree", "fix"],
  docker: ["build", "run", "ps", "images", "pull", "push", "exec", "logs", "stop", "start", "restart", "rm", "rmi", "compose", "network", "volume", "inspect", "tag", "login", "system"],
  kubectl: ["get", "describe", "apply", "delete", "logs", "exec", "port-forward", "create", "edit", "scale", "rollout", "config", "top", "explain", "label", "annotate"],
  go: ["build", "run", "test", "get", "install", "mod", "fmt", "vet", "generate", "clean", "env", "version", "work", "doc"],
  pip: ["install", "uninstall", "freeze", "list", "show", "download", "wheel", "check", "config", "search"],
  brew: ["install", "uninstall", "upgrade", "update", "search", "info", "list", "doctor", "cleanup", "services", "tap", "outdated"],
};

const PROGRAMS: readonly string[] = [
  ...Object.keys(SUBCOMMANDS),
  "ls", "cd", "cat", "less", "grep", "find", "sed", "awk", "curl", "wget", "ssh", "scp", "rsync",
  "make", "cmake", "python", "python3", "node", "deno", "bun", "npx", "rustc", "rustup", "java",
  "javac", "gradle", "mvn", "dotnet", "ruby", "gem", "bundle", "rails", "php", "composer", "code",
  "vim", "nvim", "nano", "emacs", "tmux", "htop", "top", "ps", "kill", "pkill", "chmod", "chown",
  "mkdir", "rmdir", "touch", "cp", "mv", "rm", "ln", "tar", "zip", "unzip", "gzip", "echo", "printf",
  "export", "source", "which", "whoami", "history", "clear", "terraform", "helm", "aws", "gcloud",
  "az", "gh", "jq", "yq", "rg", "fd", "bat", "eza", "fzf", "zoxide", "uv", "poetry", "pytest", "tsc",
  "vite", "next", "eslint", "prettier", "biome", "podman", "minikube", "kind", "ansible",
];

/** The suggestion the tool itself printed, if any. */
export function toolHint(output: string): string | null {
  const patterns = [
    /The most similar commands? (?:is|are)\s*\n\s*(\S+)/, // git
    /Did you mean (?:this|one of these)\?\s*\n\s*(?:npm |pnpm |yarn )?(\S+)/i, // npm
    /a (?:sub)?command with a similar name exists: `([^`]+)`/i, // cargo
    /Did you mean[: ]+['"`]?([\w.:-]+)['"`]?\??/i, // docker, pip, many
    /maybe you meant[: ]+['"`]?([\w.:-]+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(output);
    if (m) return m[1];
  }
  return null;
}

function closest(word: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const limit = word.length <= 3 ? 1 : 2;
  for (const c of candidates) {
    if (c === word) return null; // already valid: not a typo of this kind
    const d = osaDistance(word, c);
    if (d < bestD || (d === bestD && best !== null && c.length < best.length)) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= limit ? best : null;
}

export interface TypoContext {
  command: string;
  exitCode: number | null;
  output: string;
  /** Programs that ran successfully recently, to learn the user's own tools. */
  knownPrograms?: Iterable<string>;
}

const NOT_FOUND_RE = /command not found|not recognized as (?:an internal|the name)|No such file or directory|Unknown command|is not a \w+ command|unrecognized subcommand|no such command|unknown (?:sub)?command/i;

/** A corrected command line, or null when no confident fix exists. */
export function suggestCorrection(ctx: TypoContext): string | null {
  if (ctx.exitCode === 0 || ctx.exitCode === null) return null;
  const words = ctx.command.trim().split(/\s+/);
  if (words.length === 0 || words[0] === "") return null;
  const looksNotFound = ctx.exitCode === 127 || NOT_FOUND_RE.test(ctx.output);
  if (!looksNotFound) return null;

  const [program, sub, ...rest] = words;
  const hint = toolHint(ctx.output);

  if (sub !== undefined && SUBCOMMANDS[program]) {
    const fixed = hint && SUBCOMMANDS[program].includes(hint) ? hint : closest(sub, SUBCOMMANDS[program]);
    if (fixed && fixed !== sub) return [program, fixed, ...rest].join(" ");
  }
  if (ctx.exitCode === 127 || /command not found|not recognized/i.test(ctx.output)) {
    const known = new Set([...PROGRAMS, ...(ctx.knownPrograms ?? [])]);
    const fixed = closest(program, known);
    if (fixed) return [fixed, ...words.slice(1)].join(" ");
  }
  if (hint && sub !== undefined && hint !== sub && /^[\w-]+$/.test(hint)) {
    return [program, hint, ...rest].join(" ");
  }
  return null;
}
