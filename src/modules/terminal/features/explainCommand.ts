// Offline command explanations (explainshell-style): split a command line
// into its pipeline/chain segments, redirections, program, subcommand,
// flags and arguments, and describe each from a built-in manual of common
// tools. Unknown flags are reported honestly rather than guessed.

import { parseArgv } from "@/lib/toolkit/parseArgv";
import { splitCommandChain } from "@/lib/toolkit/splitCommandChain";

export interface ExplainPart {
  text: string;
  kind: "operator" | "program" | "subcommand" | "flag" | "argument" | "redirect" | "env";
  explanation: string;
}

type Manual = {
  summary: string;
  flags?: Record<string, string>;
  subcommands?: Record<string, string>;
  /** Short flags that take a value (so "-n 5" consumes "5"). */
  valued?: string;
};

const MANUAL: Record<string, Manual> = {
  ls: { summary: "list directory contents", flags: { "-l": "long listing (permissions, owner, size, date)", "-a": "include entries starting with .", "-A": "include dotfiles except . and ..", "-h": "human-readable sizes", "-t": "sort by modification time", "-r": "reverse the sort order", "-R": "list subdirectories recursively", "-S": "sort by size", "-1": "one entry per line" } },
  grep: { summary: "search text for lines matching a pattern", valued: "efmABC", flags: { "-r": "search directories recursively", "-R": "recursive, following symlinks", "-i": "ignore case", "-v": "invert: lines that do NOT match", "-n": "prefix line numbers", "-l": "print only names of matching files", "-c": "count matching lines", "-E": "extended regular expressions", "-F": "fixed strings, not regex", "-w": "match whole words", "-o": "print only the matched part", "-e": "pattern to search for", "-A": "lines of context after", "-B": "lines of context before", "-C": "lines of context around", "--include": "only search files matching a glob", "--exclude": "skip files matching a glob", "--color": "highlight matches" } },
  find: { summary: "search for files in a directory hierarchy", flags: { "-name": "match the base name against a glob", "-iname": "case-insensitive -name", "-type": "match by type (f file, d directory, l symlink)", "-mtime": "modified N days ago (+N older, -N newer)", "-mmin": "modified N minutes ago", "-size": "match by size (+100M larger than 100MB)", "-maxdepth": "descend at most N levels", "-exec": "run a command on each match ({} is the path)", "-delete": "delete matches", "-print": "print matching paths", "-path": "match the whole path against a glob", "-not": "negate the next test", "-empty": "empty files or directories" } },
  tar: { summary: "create or extract archives", valued: "fC", flags: { "-c": "create an archive", "-x": "extract an archive", "-t": "list archive contents", "-v": "verbose: list files processed", "-f": "archive file name", "-z": "gzip compression", "-j": "bzip2 compression", "-J": "xz compression", "-C": "change to directory first", "--exclude": "skip files matching a pattern" } },
  curl: { summary: "transfer data from or to a URL", valued: "XHdoouAe", flags: { "-X": "HTTP method to use", "-H": "add a request header", "-d": "send data in the request body (implies POST)", "-o": "write output to a file", "-O": "save with the remote file name", "-L": "follow redirects", "-s": "silent: no progress meter", "-S": "show errors even when silent", "-f": "fail on HTTP errors without printing the body", "-I": "fetch headers only (HEAD)", "-i": "include response headers in the output", "-v": "verbose: show the request and response", "-u": "user:password for authentication", "-k": "skip TLS certificate verification (insecure)", "--json": "send JSON and set JSON headers", "-x": "use a proxy" } },
  chmod: { summary: "change file permissions", flags: { "-R": "apply recursively", "-v": "report each change", "+x": "add execute permission", "755": "rwx for owner, r-x for group and others", "644": "rw- for owner, r-- for group and others", "600": "rw- for owner only" } },
  chown: { summary: "change file owner and group", flags: { "-R": "apply recursively", "-h": "change symlinks themselves" } },
  rm: { summary: "remove files or directories", flags: { "-r": "remove directories and their contents recursively", "-R": "same as -r", "-f": "force: ignore missing files, never prompt", "-i": "prompt before every removal", "-v": "report each removal", "--no-preserve-root": "do not refuse to delete /" } },
  cp: { summary: "copy files", flags: { "-r": "copy directories recursively", "-R": "same as -r", "-a": "archive: recursive, preserving attributes", "-i": "prompt before overwrite", "-n": "never overwrite", "-v": "report each copy", "-p": "preserve mode, ownership and timestamps" } },
  mv: { summary: "move or rename files", flags: { "-i": "prompt before overwrite", "-n": "never overwrite", "-f": "force overwrite", "-v": "report each move" } },
  ssh: { summary: "log in to or run commands on a remote machine", valued: "ipLRDlJF", flags: { "-i": "identity (private key) file", "-p": "port to connect to", "-L": "forward a local port to a remote address", "-R": "forward a remote port back to a local address", "-D": "dynamic SOCKS proxy on a local port", "-N": "don't run a remote command (just forward ports)", "-J": "jump through a bastion host", "-A": "forward the SSH agent", "-v": "verbose debugging output", "-t": "force a TTY" } },
  ps: { summary: "report running processes", flags: { aux: "all processes, user-oriented format, including those without a TTY", "-e": "every process", "-f": "full format", "-o": "custom output columns" } },
  kill: { summary: "send a signal to processes", flags: { "-9": "SIGKILL: terminate immediately, cannot be caught", "-15": "SIGTERM: ask to terminate (default)", "-HUP": "SIGHUP: hang up / reload", "-l": "list signal names" } },
  du: { summary: "estimate disk usage", flags: { "-s": "summarize: total per argument", "-h": "human-readable sizes", "-a": "include files, not just directories", "-d": "max depth", "--max-depth": "max depth" } },
  df: { summary: "report free disk space", flags: { "-h": "human-readable sizes", "-T": "show filesystem type" } },
  sort: { summary: "sort lines of text", valued: "kt", flags: { "-n": "numeric sort", "-h": "human-numeric sort (2K < 1G)", "-r": "reverse", "-u": "unique: drop duplicates", "-k": "sort by a key/field", "-t": "field separator" } },
  uniq: { summary: "filter adjacent duplicate lines", flags: { "-c": "prefix lines with occurrence counts", "-d": "only print duplicated lines", "-u": "only print unique lines" } },
  head: { summary: "print the first lines of input", valued: "nc", flags: { "-n": "number of lines", "-c": "number of bytes" } },
  tail: { summary: "print the last lines of input", valued: "nc", flags: { "-n": "number of lines", "-f": "follow: keep printing as the file grows", "-F": "follow by name, surviving rotation" } },
  wc: { summary: "count lines, words and bytes", flags: { "-l": "lines", "-w": "words", "-c": "bytes", "-m": "characters" } },
  xargs: { summary: "build command lines from standard input", valued: "nIP", flags: { "-n": "max arguments per command", "-I": "replace a placeholder with each input item", "-0": "input items are NUL-separated", "-P": "run up to N commands in parallel", "-r": "don't run if input is empty" } },
  sed: { summary: "stream editor: transform text", valued: "e", flags: { "-i": "edit files in place", "-e": "add a script expression", "-n": "don't print lines unless told to", "-E": "extended regular expressions" } },
  awk: { summary: "pattern scanning and text processing language", valued: "Fv", flags: { "-F": "field separator", "-v": "assign a variable" } },
  docker: {
    summary: "manage containers",
    valued: "pvewe",
    subcommands: { run: "create and start a container", ps: "list containers", exec: "run a command in a running container", build: "build an image from a Dockerfile", images: "list images", logs: "show container logs", stop: "stop containers", rm: "remove containers", rmi: "remove images", pull: "download an image", push: "upload an image", compose: "multi-container apps (docker compose)" },
    flags: { "-d": "run in the background (detached)", "-it": "interactive with a TTY", "-p": "publish a port host:container", "-v": "mount a volume host:container", "-e": "set an environment variable", "--rm": "remove the container when it exits", "--name": "name the container", "-a": "all (including stopped)", "-f": "follow / force (depends on subcommand)", "-t": "tag (build) or TTY (run)" },
  },
  git: {
    summary: "version control",
    valued: "mbC",
    subcommands: { status: "show changed files", add: "stage changes", commit: "record staged changes", push: "upload commits to a remote", pull: "fetch and integrate remote changes", fetch: "download remote refs without merging", checkout: "switch branches or restore files", switch: "switch branches", branch: "list, create or delete branches", merge: "join histories", rebase: "replay commits onto another base", log: "show commit history", diff: "show changes", reset: "move HEAD (and optionally the index/worktree)", stash: "shelve changes", clone: "copy a repository", restore: "restore working-tree files", tag: "manage tags", cherry: "find unmerged commits", "cherry-pick": "apply a commit onto HEAD", revert: "make a commit that undoes another", clean: "remove untracked files", bisect: "binary-search for a bad commit", remote: "manage remotes", show: "show an object (e.g. a commit)" },
    flags: { "-m": "message", "-a": "all (stage tracked changes / list all branches)", "-b": "create a new branch", "-u": "set upstream / include untracked", "--force": "overwrite remote history", "-f": "force", "--force-with-lease": "force-push only if the remote is as you last saw it", "--hard": "discard working-tree and index changes", "--soft": "keep changes staged", "--oneline": "one line per commit", "--graph": "draw the branch graph", "--amend": "replace the last commit", "-p": "patch: show or select hunks", "--staged": "use the index (staged changes)", "--cached": "use the index (staged changes)", "-d": "delete (merged branch / untracked dirs)", "-D": "force-delete a branch", "-x": "also remove ignored files", "-n": "dry run", "--all": "all refs" },
  },
  npm: { summary: "Node package manager", subcommands: { install: "install dependencies", i: "install dependencies", ci: "clean install from the lockfile", run: "run a package.json script", test: "run the test script", start: "run the start script", publish: "publish the package", uninstall: "remove a dependency", update: "update dependencies", outdated: "list outdated dependencies", audit: "check for vulnerabilities", exec: "run a package binary" }, flags: { "-D": "save as a dev dependency", "--save-dev": "save as a dev dependency", "-g": "install globally", "--global": "install globally", "-y": "accept defaults" } },
  kubectl: { summary: "control Kubernetes clusters", valued: "nfl", subcommands: { get: "list resources", describe: "show resource details", apply: "create or update from a manifest", delete: "delete resources", logs: "print container logs", exec: "run a command in a container", "port-forward": "forward local ports to a pod", rollout: "manage rollouts", scale: "change replica count", config: "manage kubeconfig" }, flags: { "-n": "namespace", "-A": "all namespaces", "-f": "file/manifest, or follow logs", "-o": "output format (yaml, json, wide)", "-l": "label selector", "-it": "interactive TTY", "-w": "watch for changes" } },
  ln: { summary: "make links between files", flags: { "-s": "symbolic link", "-f": "replace existing destination", "-n": "treat a symlinked directory destination as a file" } },
  mkdir: { summary: "create directories", flags: { "-p": "create parents as needed, no error if it exists", "-m": "set permissions" } },
  sudo: { summary: "run a command as another user (root by default)", valued: "u", flags: { "-u": "run as this user", "-E": "preserve the environment", "-i": "login shell", "-s": "shell" } },
  rsync: { summary: "fast file copy and sync", flags: { "-a": "archive: recursive, preserve permissions/times/links", "-v": "verbose", "-z": "compress during transfer", "-P": "show progress, keep partial files", "--delete": "delete destination files missing from the source", "-n": "dry run", "--exclude": "skip files matching a pattern" } },
  jq: { summary: "process JSON", flags: { "-r": "raw output (no JSON quotes)", "-c": "compact output", "-s": "slurp all inputs into one array", "-e": "exit status reflects the result" } },
  echo: { summary: "print arguments", flags: { "-n": "no trailing newline", "-e": "interpret backslash escapes" } },
  cat: { summary: "print and concatenate files", flags: { "-n": "number lines", "-A": "show non-printing characters" } },
  ping: { summary: "test network reachability", valued: "cW", flags: { "-c": "number of packets", "-W": "timeout per reply" } },
};

const OPERATOR_TEXT: Record<string, string> = {
  "|": "pipe: send the previous command's output to the next command's input",
  "&&": "run the next command only if the previous one succeeded",
  "||": "run the next command only if the previous one failed",
  ";": "run the next command regardless",
  "&": "run the previous command in the background",
};

function redirectText(raw: string): string | null {
  const tok = restore(raw);
  if (/^2>&1$/.test(tok)) return "send stderr to wherever stdout goes";
  if (/^&>/.test(tok)) return "send both stdout and stderr to a file";
  if (/^2>>?/.test(tok)) return tok.startsWith("2>>") ? "append stderr to a file" : "write stderr to a file";
  if (/^>>/.test(tok)) return "append stdout to a file";
  if (/^\d?>/.test(tok)) return "write stdout to a file (overwriting it)";
  if (/^</.test(tok)) return "read stdin from a file";
  return null;
}

function explainSegment(segment: string): ExplainPart[] {
  const parts: ExplainPart[] = [];
  const argv = parseArgv(segment);
  let i = 0;
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) {
    parts.push({ text: argv[i], kind: "env", explanation: `set environment variable ${argv[i].split("=")[0]} for this command` });
    i++;
  }
  if (i >= argv.length) return parts;
  let program = argv[i].replace(/^.*\//, "");
  parts.push({ text: argv[i], kind: "program", explanation: MANUAL[program]?.summary ?? "program (no built-in description)" });
  i++;
  // sudo/env/time wrap another command: explain the wrapped program too.
  if (program === "sudo" || program === "time" || program === "nohup") {
    while (i < argv.length && argv[i].startsWith("-")) {
      parts.push({ text: argv[i], kind: "flag", explanation: MANUAL[program]?.flags?.[argv[i]] ?? "option" });
      i++;
    }
    if (i < argv.length) return [...parts, ...explainSegment(argv.slice(i).join(" "))];
  }
  const man = MANUAL[program];
  let expectSub = !!man?.subcommands;
  for (; i < argv.length; i++) {
    const tok = argv[i];
    const redirect = redirectText(tok);
    if (redirect) {
      parts.push({ text: tok, kind: "redirect", explanation: redirect });
      continue;
    }
    if (expectSub && !tok.startsWith("-")) {
      expectSub = false;
      const sub = man?.subcommands?.[tok];
      parts.push({ text: tok, kind: "subcommand", explanation: sub ?? "subcommand" });
      if (program === "docker" && tok === "compose") program = "docker";
      continue;
    }
    if (tok.startsWith("-") && tok !== "-" && tok !== "--") {
      const [flag, inline] = tok.split("=", 2);
      const direct = man?.flags?.[flag];
      if (direct) {
        parts.push({ text: tok, kind: "flag", explanation: inline !== undefined ? `${direct} = ${inline}` : direct });
        const short = /^-([A-Za-z])$/.exec(flag);
        if (short && man?.valued?.includes(short[1]) && inline === undefined && i + 1 < argv.length) {
          parts.push({ text: argv[++i], kind: "argument", explanation: `value for ${flag}` });
        }
        continue;
      }
      // Bundled short flags: -xzvf → -x -z -v -f
      if (/^-[A-Za-z]{2,}$/.test(tok) && man?.flags) {
        const letters = tok.slice(1).split("");
        const known = letters.map((l) => man.flags![`-${l}`]);
        if (known.every(Boolean)) {
          parts.push({ text: tok, kind: "flag", explanation: letters.map((l, k) => `-${l}: ${known[k]}`).join("; ") });
          const last = letters[letters.length - 1];
          if (man.valued?.includes(last) && i + 1 < argv.length) parts.push({ text: argv[++i], kind: "argument", explanation: `value for -${last}` });
          continue;
        }
      }
      parts.push({ text: tok, kind: "flag", explanation: "option (not in the built-in manual — see the tool's --help)" });
      continue;
    }
    const known = man?.flags?.[tok]; // e.g. "aux", "755", "+x"
    parts.push({ text: tok, kind: "argument", explanation: known ?? "argument" });
  }
  return parts;
}

// "2>&1" and "&>" contain "&" but are redirections, not background operators.
const AMP = "\u0000AMP\u0000";
const protect = (s: string) => s.replace(/(\d?)>&(\d|-)/g, `$1>${AMP}$2`).replace(/&>/g, `${AMP}>`);
const restore = (s: string) => s.split(AMP).join("&");

export function explainCommand(line: string): ExplainPart[] {
  const out: ExplainPart[] = [];
  for (const seg of splitCommandChain(protect(line))) {
    if (seg.command) out.push(...explainSegment(seg.command).map((p) => ({ ...p, text: restore(p.text) })));
    if (seg.operator) out.push({ text: seg.operator, kind: "operator", explanation: OPERATOR_TEXT[seg.operator] });
  }
  return out;
}

// ------------------------------------------------------------- action

import { app } from "@/app/appBridge";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { lastFinishedCommand, leafGridSelection } from "../lib/useTerminalSession";

const KIND_LABEL: Record<ExplainPart["kind"], string> = {
  env: "Environment",
  program: "Program",
  subcommand: "Subcommand",
  flag: "Option",
  argument: "Argument",
  redirect: "Redirection",
  operator: "Operator",
};

export async function explainCommandAction(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const seed = (leaf !== null ? leafGridSelection(leaf)?.trim() || lastFinishedCommand(leaf)?.command : "") ?? "";
  const line = await inputBox({
    title: "Explain a command",
    value: seed.split("\n")[0],
    placeholder: "e.g. find . -name '*.log' -mtime +7 -delete",
    validate: (v) => (v.trim() ? null : "Enter a command"),
  });
  if (!line) return;
  const parts = explainCommand(line);
  await quickPick(
    parts.map((p, i) => ({
      label: p.text,
      description: KIND_LABEL[p.kind],
      detail: p.explanation,
      keywords: [p.explanation],
      value: i,
    })),
    { title: line, placeholder: "Filter parts…" },
  );
}
