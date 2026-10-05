import { describe, expect, it } from "vitest";
import {
  addLineNumbers,
  applySurround,
  concatToTemplate,
  debugLogFor,
  DEBUG_MARK,
  extractVariable,
  langFamily,
  removeDebugLines,
  removeLineNumbers,
  suggestName,
  surroundTemplates,
} from "./codeTools";
import { extractLinks, headingAnchors, htmlToMarkdown, lintProse, renumberLists } from "./prose";

describe("debug logs", () => {
  it("detects language families", () => {
    expect(langFamily("typescript")).toBe("js");
    expect(langFamily("", "/a/main.go")).toBe("go");
    expect(langFamily("python")).toBe("py");
    expect(langFamily("kotlin")).toBe("kt");
  });

  it("writes and removes prints", () => {
    expect(debugLogFor("js", "user.id", "app.ts:12")).toBe(`console.log("${DEBUG_MARK} app.ts:12 user.id", user.id);`);
    expect(debugLogFor("py", "x", "a.py:3")).toBe(`print(f"${DEBUG_MARK} a.py:3 x = {x!r}")`);
    expect(debugLogFor("rs", "v", "m.rs:9")).toBe(`dbg!(&v); // ${DEBUG_MARK} m.rs:9`);
    const src = `a();\n  ${debugLogFor("js", "a", "f:1")}\nconsole.log("keep?");\nb();`;
    expect(removeDebugLines(src)).toEqual({ text: 'a();\nconsole.log("keep?");\nb();', removed: 1 });
    expect(removeDebugLines(src, true, "js").removed).toBe(2);
  });
});

describe("surround and extract", () => {
  it("wraps with indentation", () => {
    const t = surroundTemplates("js").find((x) => x.label === "try / catch")!;
    expect(applySurround(t.template, "    doThing();\n    more();\n", "    ", "  ")).toBe(
      "    try {\n      doThing();\n      more();\n    } catch (error) {\n      console.error(error);\n    }",
    );
    const py = surroundTemplates("py").find((x) => x.label === "if")!;
    expect(applySurround(py.template, "x = 1", "", "    ")).toBe("if condition:\n    x = 1");
  });

  it("extracts variables per language", () => {
    expect(extractVariable("js", "total", "a + b")).toEqual({ declaration: "const total = a + b;", reference: "total" });
    expect(extractVariable("go", "n", "len(x)").declaration).toBe("n := len(x)");
    expect(extractVariable("php", "n", "count($x)")).toEqual({ declaration: "$n = count($x);", reference: "$n" });
    expect(suggestName("user.profile.displayName")).toBe("displayName");
    expect(suggestName("getUser(id)")).toBe("user");
    expect(suggestName("'hi'")).toBe("text");
  });

  it("turns concatenation into a template literal", () => {
    expect(concatToTemplate(`'Hello, ' + user.name + "! You have " + count(items) + ' items'`)).toBe("`Hello, ${user.name}! You have ${count(items)} items`");
    expect(concatToTemplate("'a`b' + x")).toBe("`a\\`b${x}`");
    expect(concatToTemplate("a + b")).toBeNull();
  });

  it("adds and removes line numbers", () => {
    const n = addLineNumbers(Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n"));
    expect(n.split("\n")[0]).toBe(" 1. l0");
    expect(removeLineNumbers(n)).toBe(Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n"));
  });
});

describe("prose", () => {
  it("lints common issues", () => {
    const issues = lintProse("This is is very simple. The file was deleted by  the user. In order to win, try.");
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("repeat");
    expect(kinds).toContain("weasel");
    expect(kinds).toContain("passive");
    expect(kinds).toContain("spacing");
    expect(kinds).toContain("cliche");
  });

  it("renumbers nested ordered lists", () => {
    expect(renumberLists("1. a\n1. b\n   1. x\n   7. y\n1. c\n\nText\n\n3. new\n3. list")).toBe("1. a\n2. b\n   1. x\n   2. y\n3. c\n\nText\n\n3. new\n4. list");
  });

  it("extracts links and anchors", () => {
    const md = "# Intro\n## Set up & run\n## Intro\nSee [x](./a.md#intro), ![img](img.png) and `[no](code)`.\n```\n[no](fenced)\n```\n[ref]: https://x.dev";
    expect(extractLinks(md).map((l) => l.target)).toEqual(["./a.md#intro", "img.png", "https://x.dev"]);
    expect([...headingAnchors(md)]).toEqual(["intro", "set-up--run", "intro-1"]);
  });

  it("converts HTML to Markdown", () => {
    const html = `<h2>Title</h2><p>Some <strong>bold</strong> and <em>it</em> with <a href="https://x.dev">a link</a> &amp; <code>code</code>.</p>
<ul><li>one</li><li>two<ol><li>a</li><li>b</li></ol></li></ul>
<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<blockquote><p>quoted</p></blockquote>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("## Title");
    expect(md).toContain("Some **bold** and _it_ with [a link](https://x.dev) & `code`.");
    expect(md).toContain("- one\n- two\n   1. a\n   2. b");
    expect(md).toContain("```js\nconst a = 1 < 2;\n```");
    expect(md).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(md).toContain("> quoted");
  });
});
