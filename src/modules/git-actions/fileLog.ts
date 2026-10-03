// Parse `git log --follow --name-status` output for one file into commits
// with the file's path (and previous path, for renames) at each commit.

export const FILE_LOG_FORMAT = "%x1e%H%x1f%h%x1f%an%x1f%at%x1f%s";

export interface FileCommit {
  sha: string;
  shortSha: string;
  author: string;
  time: number;
  subject: string;
  path: string;
  originalPath: string | null;
  status: string;
}

export function parseFileLog(output: string): FileCommit[] {
  return output
    .split("\x1e")
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [header, ...rest] = rec.split("\n");
      const [sha, shortSha, author, time, subject] = header.split("\x1f");
      const statusLine = rest.map((l) => l.trim()).find((l) => /^[ACDMRT]\d*\t/.test(l)) ?? "";
      const [status, a, b] = statusLine.split("\t");
      const renamed = /^R/.test(status ?? "");
      return {
        sha,
        shortSha,
        author,
        time: Number(time) || 0,
        subject: subject ?? "",
        path: (renamed ? b : a) ?? "",
        originalPath: renamed ? a : null,
        status: status?.[0] ?? "M",
      };
    })
    .filter((c) => c.sha && c.path);
}
