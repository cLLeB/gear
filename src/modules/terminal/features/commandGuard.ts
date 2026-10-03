// Classify command lines that can destroy data or are hard to undo, so they
// can be confirmed before they run. "danger" is irreversible at scale (wiping
// a disk, deleting home, force-pushing main, dropping a database); "caution"
// is destructive but scoped or recoverable with effort.

export type RiskLevel = "danger" | "caution";

export interface CommandRisk {
  level: RiskLevel;
  reason: string;
}

type Rule = { level: RiskLevel; reason: string; test: (cmd: string) => boolean };

const re = (r: RegExp) => (cmd: string) => r.test(cmd);

/** rm with recursive/force flags and its targets, or null. */
function rmTargets(cmd: string): { flags: string; targets: string[] } | null {
  const m = /(?:^|[;&|]\s*|\bsudo\s+)rm\s+((?:-{1,2}[\w-]+\s+)*)(.*)$/m.exec(cmd);
  if (!m) return null;
  const flags = m[1];
  if (!/(-\w*[rR]\w*|--recursive)/.test(flags)) return null;
  const targets = m[2].split(/[;&|]/)[0].trim().split(/\s+/).filter((t) => t && !t.startsWith("-"));
  return { flags, targets };
}

const CATASTROPHIC_TARGET = /^(\/|\/\*|~\/?|~\/\*|\$HOME\/?|\$\{HOME\}\/?|\*|\.\/?\*?|\.\.\/?|\/(bin|boot|dev|etc|lib|lib64|opt|proc|root|sbin|sys|usr|var|home|Users|System|Library)\/?\*?)$/;

// SQL only counts when it is actually sent to a database: a db client is on
// the line, or the line itself is SQL (a REPL-like pane). `grep 'drop table'`
// is not a risk.
const DB_CLIENT = /\b(psql|mysql|mariadb|sqlite3|duckdb|sqlcmd|clickhouse(-client)?|cockroach\s+sql|snowsql|bq\s+query)\b/i;
const sqlContext = (cmd: string) => DB_CLIENT.test(cmd) || /^\s*(drop|truncate|delete)\b/i.test(cmd);

const RULES: Rule[] = [
  {
    level: "danger",
    reason: "Recursively deletes the filesystem root, your home directory, or everything here",
    test: (cmd) => {
      const rm = rmTargets(cmd);
      return !!rm && (rm.targets.some((t) => CATASTROPHIC_TARGET.test(t.replace(/^["']|["']$/g, ""))) || /--no-preserve-root/.test(cmd));
    },
  },
  { level: "danger", reason: "Formats or overwrites a disk device", test: re(/\b(mkfs(\.\w+)?|wipefs|fdisk|parted|diskutil\s+(erase\w*|partitionDisk))\b|\bdd\b[^|;]*\bof=\/dev\/(?!null\b|zero\b)|>\s*\/dev\/(sd[a-z]|nvme\d|disk\d|hd[a-z])/) },
  { level: "danger", reason: "Fork bomb", test: re(/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&[^}]*\}/) },
  { level: "danger", reason: "Recursively changes permissions or ownership of a system or home tree", test: re(/\bch(mod|own|grp)\s+(-\w*R\w*|--recursive)\b[^;&|]*\s(\/|~|\$HOME)(\s|$|\/\s|\/\*)/) },
  {
    level: "danger",
    reason: "Force-pushes over a shared branch",
    test: (cmd) =>
      /\bgit\s+push\b/.test(cmd) &&
      /(\s--force(?!-with-lease)\b|\s-f\b|\s\+\w)/.test(cmd) &&
      /\b(main|master|trunk|develop|release[\w/-]*|production|prod)\b/.test(cmd),
  },
  { level: "danger", reason: "Drops or truncates database objects", test: (cmd) => sqlContext(cmd) && /\b(drop\s+(database|schema|table)|truncate\s+(table\s+)?\w)/i.test(cmd) },
  { level: "danger", reason: "DELETE without a WHERE clause removes every row", test: (cmd) => sqlContext(cmd) && /\bdelete\s+from\s+\w+/i.test(cmd) && !/\bwhere\b/i.test(cmd) },
  { level: "danger", reason: "Deletes Kubernetes namespaces or every resource", test: re(/\bkubectl\s+delete\s+(ns|namespace|namespaces|all)\b|\bkubectl\s+delete\b.*\s--all\b/) },
  { level: "danger", reason: "Destroys infrastructure", test: re(/\b(terraform|tofu|pulumi)\s+destroy\b|\bcdk\s+destroy\b/) },
  { level: "danger", reason: "Kills every process you own", test: re(/\bkill\s+-(9|KILL)\s+-1\b|\bpkill\s+-9\s+-u\b/) },
  { level: "caution", reason: "Recursive delete", test: (cmd) => rmTargets(cmd) !== null },
  { level: "caution", reason: "Force-push rewrites remote history", test: re(/\bgit\s+push\b.*(\s--force(?!-with-lease)\b|\s-f\b)/) },
  { level: "caution", reason: "Discards uncommitted changes", test: re(/\bgit\s+(reset\s+--hard|checkout\s+(--\s+)?\.(\s|$)|restore\s+(--staged\s+)?\.(\s|$)|clean\s+-\w*[fdx]\w*)/) },
  { level: "caution", reason: "Deletes branches or stashes that may not be merged", test: re(/\bgit\s+(branch\s+-D|stash\s+(clear|drop))\b/) },
  { level: "caution", reason: "Runs a script downloaded from the internet", test: re(/\b(curl|wget|iwr|irm|Invoke-WebRequest)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|fi)?sh\b|\b(irm|iwr)\b[^|]*\|\s*iex\b/) },
  { level: "caution", reason: "Removes all unused Docker data, including volumes", test: re(/\bdocker\s+(system|volume)\s+prune\b.*(--volumes|-a)/) },
  { level: "caution", reason: "Shuts down or restarts the machine", test: re(/(^|[;&|]\s*|sudo\s+)(shutdown|reboot|halt|poweroff)\b/) },
  { level: "caution", reason: "Overwrites a shell or SSH config file", test: re(/(^|[^>])>\s*~\/\.(bashrc|zshrc|profile|bash_profile|ssh\/\w+|gitconfig)\b/) },
];

export function classifyCommand(command: string): CommandRisk | null {
  const cmd = command.trim();
  if (!cmd) return null;
  for (const rule of RULES) {
    if (rule.test(cmd)) return { level: rule.level, reason: rule.reason };
  }
  return null;
}
