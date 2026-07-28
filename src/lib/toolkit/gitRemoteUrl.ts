export interface GitRemote {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parse an SSH or HTTPS git remote URL into its host/owner/repo parts.
 * Supports scp-style (git@host:owner/repo.git), ssh://, https://, and git://.
 */
export function parseGitRemoteUrl(url: string): GitRemote | null {
  const trimmed = url.trim().replace(/\.git$/, "");

  // URL forms with an explicit scheme: https://, ssh://, git://
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const proto = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(trimmed);
    return proto ? splitPath(stripPort(proto[1]), proto[2]) : null;
  }

  // scp-style: git@github.com:owner/repo
  const scp = /^[^@]+@([^:]+):(.+)$/.exec(trimmed);
  if (scp) return splitPath(stripPort(scp[1]), scp[2]);

  return null;
}

function stripPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

function splitPath(host: string, path: string): GitRemote | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const repo = parts[parts.length - 1];
  const owner = parts.slice(0, -1).join("/");
  return { host, owner, repo };
}
