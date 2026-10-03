// Built-in workflows: commands people look up over and over. Parameters use
// the template syntax in template.ts.

export type Platform = "mac" | "linux" | "windows";

export interface Workflow {
  id: string;
  name: string;
  command: string;
  description?: string;
  tags?: string[];
  /** Omitted means every platform. */
  platforms?: Platform[];
  source: "builtin" | "project" | "user";
}

const UNIX: Platform[] = ["mac", "linux"];

const LIBRARY: Array<Omit<Workflow, "source">> = [
  // git
  { id: "git-undo-commit", name: "Undo last commit, keep changes", command: "git reset --soft HEAD~1", tags: ["git"] },
  { id: "git-amend-msg", name: "Reword last commit message", command: 'git commit --amend -m "{{message}}"', tags: ["git"] },
  { id: "git-new-branch", name: "Create and switch to a branch", command: "git switch -c {{branch}}", tags: ["git"] },
  { id: "git-delete-merged", name: "Delete local branches merged into main", command: "git branch --merged {{base:main}} | grep -vE '^\\*|\\b{{base:main}}\\b' | xargs -r git branch -d", tags: ["git", "cleanup"], platforms: UNIX },
  { id: "git-find-commit", name: "Find commits by message", command: 'git log --oneline --all --grep="{{text}}"', tags: ["git", "search"] },
  { id: "git-pickaxe", name: "Find commits that added or removed text", command: 'git log -S "{{text}}" --oneline --all', tags: ["git", "search"] },
  { id: "git-file-history", name: "History of a file (follow renames)", command: "git log --follow -p -- {{path}}", tags: ["git"] },
  { id: "git-changed-files", name: "Files changed in a commit", command: "git show --stat --oneline {{commit:HEAD}}", tags: ["git"] },
  { id: "git-stash-msg", name: "Stash with a message (incl. untracked)", command: 'git stash push -u -m "{{message}}"', tags: ["git"] },
  { id: "git-sync-fork", name: "Sync branch with upstream", command: "git fetch {{remote:upstream}} && git rebase {{remote:upstream}}/{{branch:main}}", tags: ["git"] },
  { id: "git-blame-range", name: "Blame a line range", command: "git blame -L {{start}},{{end}} -- {{path}}", tags: ["git"] },
  { id: "git-contributors", name: "Contributors by commit count", command: "git shortlog -sne --all", tags: ["git", "stats"] },
  // processes & ports
  { id: "port-who", name: "What is listening on a port", command: "lsof -nP -iTCP:{{port}} -sTCP:LISTEN", tags: ["port", "network"], platforms: UNIX },
  { id: "port-kill", name: "Kill the process on a port", command: "lsof -t -iTCP:{{port}} -sTCP:LISTEN | xargs -r kill -{{signal|TERM|KILL}}", tags: ["port", "kill"], platforms: UNIX },
  { id: "port-who-win", name: "What is listening on a port", command: "Get-NetTCPConnection -LocalPort {{port}} -State Listen | Select-Object OwningProcess,LocalAddress", tags: ["port", "network"], platforms: ["windows"] },
  { id: "proc-find", name: "Find processes by name", command: "pgrep -fil '{{name}}'", tags: ["process"], platforms: UNIX },
  // files
  { id: "find-large", name: "Largest files under a directory", command: "du -ah {{dir:.}} 2>/dev/null | sort -rh | head -n {{count:20}}", tags: ["disk", "files"], platforms: UNIX },
  { id: "find-name", name: "Find files by name", command: "find {{dir:.}} -iname '*{{pattern}}*' -not -path '*/node_modules/*' -not -path '*/.git/*'", tags: ["files", "search"], platforms: UNIX },
  { id: "find-recent", name: "Files modified in the last N minutes", command: "find {{dir:.}} -type f -mmin -{{minutes:30}} -not -path '*/.git/*'", tags: ["files"], platforms: UNIX },
  { id: "replace-all", name: "Replace text across files", command: "rg -l '{{find}}' {{dir:.}} | xargs perl -pi -e 's/{{find}}/{{replace}}/g'", tags: ["files", "refactor"], platforms: UNIX },
  { id: "tar-create", name: "Create a .tar.gz archive", command: "tar -czvf {{archive:archive.tar.gz}} {{paths:.}}", tags: ["archive"] },
  { id: "tar-extract", name: "Extract an archive", command: "tar -xzvf {{archive}} -C {{dir:.}}", tags: ["archive"] },
  { id: "disk-usage", name: "Disk usage by folder (depth 1)", command: "du -h -d 1 {{dir:.}} | sort -rh", tags: ["disk"], platforms: UNIX },
  // network
  { id: "http-headers", name: "Show HTTP response headers", command: "curl -sSI {{url}}", tags: ["http", "network"] },
  { id: "http-json", name: "POST JSON to an endpoint", command: "curl -sS -X {{method|POST|PUT|PATCH}} {{url}} -H 'Content-Type: application/json' -d '{{json:{}}}'", tags: ["http"] },
  { id: "ssh-tunnel", name: "Forward a remote port over SSH", command: "ssh -N -L {{local_port}}:localhost:{{remote_port}} {{host}}", tags: ["ssh", "network"] },
  { id: "dns-lookup", name: "DNS records for a domain", command: "dig +short {{type|A|AAAA|MX|TXT|CNAME|NS}} {{domain}}", tags: ["dns", "network"], platforms: UNIX },
  { id: "serve-dir", name: "Serve the current directory over HTTP", command: "python3 -m http.server {{port:8000}}", tags: ["http", "server"] },
  // containers
  { id: "docker-stop-all", name: "Stop all running containers", command: "docker stop $(docker ps -q)", tags: ["docker"], platforms: UNIX },
  { id: "docker-prune", name: "Remove unused Docker data", command: "docker system prune {{scope|-f|-af|-af --volumes}}", tags: ["docker", "cleanup"] },
  { id: "docker-shell", name: "Open a shell in a container", command: "docker exec -it {{container}} {{shell|sh|bash|zsh}}", tags: ["docker"] },
  { id: "k8s-logs", name: "Follow logs of a deployment", command: "kubectl logs -f deploy/{{deployment}} -n {{namespace:default}} --tail={{lines:100}}", tags: ["kubernetes"] },
  { id: "k8s-pf", name: "Port-forward to a service", command: "kubectl port-forward svc/{{service}} {{local_port}}:{{remote_port}} -n {{namespace:default}}", tags: ["kubernetes"] },
  // packages & languages
  { id: "npm-why", name: "Why is a package installed", command: "{{pm|npm|pnpm|yarn}} why {{package}}", tags: ["node"] },
  { id: "npm-outdated", name: "List outdated dependencies", command: "{{pm|npm|pnpm|yarn}} outdated", tags: ["node"] },
  { id: "py-venv", name: "Create and activate a virtualenv", command: "python3 -m venv {{dir:.venv}} && source {{dir:.venv}}/bin/activate", tags: ["python"], platforms: UNIX },
  { id: "cargo-tree-dup", name: "Duplicate crate versions", command: "cargo tree --duplicates", tags: ["rust"] },
  // misc
  { id: "base64-file", name: "Base64-encode a file", command: "base64 < {{path}}", tags: ["encoding"], platforms: UNIX },
  { id: "random-secret", name: "Generate a random secret", command: "openssl rand -{{encoding|hex|base64}} {{bytes:32}}", tags: ["security"] },
  { id: "cert-expiry", name: "Check a TLS certificate's expiry", command: "echo | openssl s_client -servername {{host}} -connect {{host}}:443 2>/dev/null | openssl x509 -noout -dates", tags: ["tls", "security"], platforms: UNIX },
  { id: "watch-cmd", name: "Re-run a command every N seconds", command: "watch -n {{seconds:2}} '{{command}}'", tags: ["monitor"], platforms: UNIX },
];

export const BUILTIN_WORKFLOWS: Workflow[] = LIBRARY.map((w) => ({ ...w, source: "builtin" }));
