import { describe, expect, it } from "vitest";
import { anchors, checkFile, curlArgs, distance, extractLinks, judgeUrl, parseCurl, resolveTarget, slug, type Workspace } from "./model";

const doc = [
  "# Getting Started",
  "",
  "See [install](docs/install.md#requirements), [setup](./docs/Setup.md) and [api][API docs].",
  "![logo](img/logo.png \"Logo\") and <https://example.com/x>.",
  "Jump to [usage](#usage) or [nowhere](#usgae).",
  "",
  "```md",
  "[not a link](missing.md)",
  "```",
  "Inline `[code](nope.md)` is ignored. <a href=\"../outside.md\">out</a>",
  "",
  "## Usage",
  "Repeat",
  "------",
  "## Usage",
  "- [x] done task, [undefined][nope]",
  "",
  "[api docs]: https://example.com/api",
].join("\n");

describe("link checker", () => {
  it("finds links outside code", () => {
    const links = extractLinks(doc);
    expect(links.map((l) => [l.kind, l.target, l.line])).toEqual([
      ["inline", "docs/install.md#requirements", 3],
      ["inline", "./docs/Setup.md", 3],
      ["reference", "https://example.com/api", 3],
      ["image", "img/logo.png", 4],
      ["autolink", "https://example.com/x", 4],
      ["inline", "#usage", 5],
      ["inline", "#usgae", 5],
      ["html", "../outside.md", 10],
      ["reference", "[nope]", 16],
    ]);
    expect(links[0].column).toBe(5);
    expect(extractLinks("[a](<with space.md>) [b](x.md 'title') [c](f(1).md)").map((l) => l.target)).toEqual(["with space.md", "x.md", "f(1).md"]);
  });

  it("makes GitHub heading anchors", () => {
    expect(slug("Getting Started")).toBe("getting-started");
    expect(slug("What's new in v2.0?")).toBe("whats-new-in-v20");
    expect(slug("`code` & *emphasis*")).toBe("code--emphasis");
    expect(slug("snake_case name")).toBe("snake_case-name");
    expect(slug("Ünïcödé Héading")).toBe("ünïcödé-héading");
    expect(slug("[Link](x.md) title")).toBe("link-title");
    expect([...anchors(doc)]).toEqual(["getting-started", "usage", "repeat", "usage-1"]);
    expect(anchors('## Custom {#my-id}\n<a name="legacy"></a>').has("my-id")).toBe(true);
    expect(anchors('<a name="legacy"></a>').has("legacy")).toBe(true);
  });

  it("resolves targets relative to the file", () => {
    expect(resolveTarget("docs/guide/a.md", "../img/x.png")).toEqual({ kind: "local", path: "docs/img/x.png", anchor: null });
    expect(resolveTarget("docs/a.md", "/README.md#intro")).toEqual({ kind: "local", path: "README.md", anchor: "intro" });
    expect(resolveTarget("a.md", "my%20file.md")).toEqual({ kind: "local", path: "my file.md", anchor: null });
    expect(resolveTarget("a.md", "../../x.md")).toEqual({ kind: "local", path: "../../x.md", anchor: null });
    expect(resolveTarget("a.md", "https://x.io")).toEqual({ kind: "external", url: "https://x.io" });
    expect(resolveTarget("a.md", "mailto:a@b.c").kind).toBe("skip");
    expect(resolveTarget("a.md", "#top")).toEqual({ kind: "anchor", anchor: "top" });
  });

  it("reports broken local links, anchors and references", () => {
    const ws: Workspace = {
      files: new Set(["README.md", "docs/install.md", "docs/setup.md", "img/logo.png"]),
      anchorsOf: (p) => (p === "docs/install.md" ? new Set(["install", "requirments"]) : null),
    };
    const { problems, external } = checkFile("README.md", doc, ws);
    expect(problems.map((p) => [p.kind, p.link.line, p.message])).toEqual([
      ["missing-anchor", 3, "docs/install.md has no heading with the anchor #requirements. Did you mean #requirments?"],
      ["case-mismatch", 3, "The file is docs/setup.md; the link's capitalisation differs, which breaks on Linux and on GitHub."],
      ["missing-anchor", 5, "No heading in this file has the anchor #usgae. Did you mean #usage?"],
      ["outside", 10, "Points outside the workspace (../outside.md)."],
      ["undefined-reference", 16, "No definition for the reference [nope]."],
    ]);
    expect(external.map((e) => e.url)).toEqual(["https://example.com/api", "https://example.com/x"]);
    // A link to a folder is fine.
    expect(checkFile("README.md", "[docs](docs/)", ws).problems).toEqual([]);
    expect(checkFile("README.md", "[gone](gone.md)", ws).problems[0]).toMatchObject({ kind: "missing-file", message: "gone.md does not exist." });
  });

  it("checks URLs with curl", () => {
    const args = curlArgs(["https://a.io", "https://b.io"], "NUL");
    expect(args.filter((a) => a === "-o")).toHaveLength(2);
    expect(args).toContain("-I");
    expect(args.slice(-3)).toEqual(["-o", "NUL", "https://b.io"]);
    expect(curlArgs(["x"], "NUL", false)).toContain("0-0");
    const out = "HTTP/2 200\r\n@@gear@@200\t0\thttps://a.io/\thttps://a.io/\n@@gear@@404\t0\thttps://b.io/x\thttps://b.io/x\n@@gear@@200\t2\thttps://new.io/\thttps://old.io/\n@@gear@@000\t0\thttps://dead.invalid/\thttps://dead.invalid/\n@@gear@@200\t1\thttps://c.io/\thttp://c.io\n";
    const r = parseCurl(out);
    expect(r.map((x) => [x.url, x.status, x.redirects])).toEqual([
      ["https://a.io/", 200, 0],
      ["https://b.io/x", 404, 0],
      ["https://old.io/", 200, 2],
      ["https://dead.invalid/", 0, 0],
      ["http://c.io", 200, 1],
    ]);
    expect(r.map((x) => judgeUrl(x)?.kind ?? null)).toEqual([null, "broken-url", "redirect", "broken-url", null]);
    expect(judgeUrl({ url: "u", status: 403, redirects: 0, final: "u" })).toBeNull();
    expect(judgeUrl({ url: "u", status: 503, redirects: 0, final: "u" })?.message).toMatch(/server failed/);
  });

  it("measures edit distance", () => {
    expect(distance("usage", "usgae")).toBe(2);
    expect(distance("", "abc")).toBe(3);
  });
});
