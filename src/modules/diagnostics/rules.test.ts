import { describe, expect, it } from "vitest";
import { DiagnosticsEngine } from "./engine";
import { createRuleAnalyzer, DEFAULT_RULES, type LintRule } from "./rules";

describe("createRuleAnalyzer", () => {
  it("matches code-scoped rules outside strings", () => {
    const engine = new DiagnosticsEngine().register(createRuleAnalyzer(DEFAULT_RULES));
    const d = engine.run("debugger;\n", "javascript");
    expect(d.some((x) => x.code === "no-debugger")).toBe(true);
  });

  it("ignores matches inside strings for code-scoped rules", () => {
    const engine = new DiagnosticsEngine().register(createRuleAnalyzer(DEFAULT_RULES));
    const d = engine.run('const s = "debugger";\n', "javascript");
    expect(d.some((x) => x.code === "no-debugger")).toBe(false);
  });

  it("matches comment-scoped rules only in comments", () => {
    const engine = new DiagnosticsEngine().register(createRuleAnalyzer(DEFAULT_RULES));
    expect(engine.run("// TODO: fix\n", "javascript").some((x) => x.code === "todo-comment")).toBe(true);
    expect(engine.run('const t = "TODO";\n', "javascript").some((x) => x.code === "todo-comment")).toBe(false);
  });

  it("produces a quick fix from a replacement", () => {
    const rules: LintRule[] = [
      { id: "tabs", pattern: /\t/, message: "tab", severity: "hint", scope: "any", replacement: "  " },
    ];
    const engine = new DiagnosticsEngine().register(createRuleAnalyzer(rules));
    const d = engine.run("\tx\n", "javascript");
    expect(d[0].fixes?.[0].edits[0].insert).toBe("  ");
  });

  it("supports custom regex with capture-group replacement", () => {
    const rules: LintRule[] = [
      { id: "var", pattern: /\bvar\b/, message: "use let/const", severity: "warning", replacement: "let" },
    ];
    const engine = new DiagnosticsEngine().register(createRuleAnalyzer(rules));
    const d = engine.run("var x = 1\n", "javascript");
    expect(d[0].fixes?.[0].edits[0].insert).toBe("let");
  });
});
