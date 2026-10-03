// Build web links to a file and line range on the forge hosting a repo —
// GitHub, GitLab (incl. self-hosted), Bitbucket, Gitea/Forgejo/Codeberg,
// Azure DevOps and sourcehut — pinned to a commit so the link never drifts.

import { parseGitRemoteUrl } from "@/lib/toolkit/gitRemoteUrl";

export type Forge = "github" | "gitlab" | "bitbucket" | "gitea" | "azure" | "sourcehut";

export function detectForge(host: string): Forge {
  const h = host.toLowerCase();
  if (h.includes("github")) return "github";
  if (h.includes("bitbucket")) return "bitbucket";
  if (h.includes("dev.azure.com") || h.includes("visualstudio.com")) return "azure";
  if (h.includes("sr.ht")) return "sourcehut";
  if (h.includes("codeberg") || h.includes("gitea") || h.includes("forgejo")) return "gitea";
  // Self-hosted GitLab is the most common unknown host.
  return "gitlab";
}

export interface PermalinkInput {
  remoteUrl: string;
  /** Commit sha or branch name. */
  ref: string;
  /** Path relative to the repo root, forward slashes. */
  path: string;
  startLine: number;
  endLine?: number;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export function buildPermalink(input: PermalinkInput): string | null {
  const remote = parseGitRemoteUrl(input.remoteUrl);
  if (!remote) return null;
  const { host, owner, repo } = remote;
  const path = enc(input.path.replace(/^\/+/, ""));
  const { ref, startLine: a } = input;
  const b = input.endLine && input.endLine !== a ? input.endLine : null;
  switch (detectForge(host)) {
    case "github":
      return `https://${host}/${owner}/${repo}/blob/${ref}/${path}#L${a}${b ? `-L${b}` : ""}`;
    case "gitlab":
      return `https://${host}/${owner}/${repo}/-/blob/${ref}/${path}#L${a}${b ? `-${b}` : ""}`;
    case "bitbucket":
      return `https://${host}/${owner}/${repo}/src/${ref}/${path}#lines-${a}${b ? `:${b}` : ""}`;
    case "gitea":
      return `https://${host}/${owner}/${repo}/src/commit/${ref}/${path}#L${a}${b ? `-L${b}` : ""}`;
    case "sourcehut":
      return `https://${host.replace(/^git\./, "git.")}/${owner}/${repo}/tree/${ref}/item/${path}#L${a}${b ? `-${b}` : ""}`;
    case "azure": {
      // ssh: git@ssh.dev.azure.com:v3/org/project/repo ; https: dev.azure.com/org/project/_git/repo
      const parts = owner.split("/").filter((p) => p !== "v3" && p !== "_git");
      const [org, project] = parts;
      const end = b ?? a;
      return `https://dev.azure.com/${org}/${project}/_git/${repo}?path=/${path}&version=GC${ref}&line=${a}&lineEnd=${end + 1}&lineStartColumn=1&lineEndColumn=1`;
    }
  }
}

/** URL that starts a pull/merge request from `branch` into `base`. */
export function buildPullRequestUrl(remoteUrl: string, branch: string, base: string): string | null {
  const remote = parseGitRemoteUrl(remoteUrl);
  if (!remote) return null;
  const { host, owner, repo } = remote;
  const b = encodeURIComponent(branch);
  const t = encodeURIComponent(base);
  switch (detectForge(host)) {
    case "github":
      return `https://${host}/${owner}/${repo}/compare/${base.split("/").map(encodeURIComponent).join("/")}...${branch.split("/").map(encodeURIComponent).join("/")}?expand=1`;
    case "gitlab":
      return `https://${host}/${owner}/${repo}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${b}&merge_request%5Btarget_branch%5D=${t}`;
    case "bitbucket":
      return `https://${host}/${owner}/${repo}/pull-requests/new?source=${b}&dest=${t}`;
    case "gitea":
      return `https://${host}/${owner}/${repo}/compare/${t}...${b}`;
    case "azure": {
      const [org, project] = owner.split("/").filter((p) => p !== "v3" && p !== "_git");
      return `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequestcreate?sourceRef=${b}&targetRef=${t}`;
    }
    case "sourcehut":
      return null; // patches go by email
  }
}
