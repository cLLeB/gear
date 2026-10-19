import { describe, expect, it } from "vitest";
import { compare, filterFindings, findingKey, formatMessage, groupFindings, parseSarif, resolveUri, severityOf, toMarkdown } from "./model";

const log = {
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "CodeQL",
          semanticVersion: "2.19.0",
          rules: [
            {
              id: "js/sql-injection",
              name: "SqlInjection",
              shortDescription: { text: "Database query built from user-controlled sources" },
              defaultConfiguration: { level: "error" },
              properties: { tags: ["security", "external/cwe/cwe-089"], "security-severity": "8.8", precision: "high" },
              messageStrings: { default: { text: "Query built from {0}." } },
            },
            { id: "js/unused-local-variable", defaultConfiguration: { level: "note" } },
          ],
        },
      },
      originalUriBaseIds: { "%SRCROOT%": { uri: "file:///C:/work/app/" } },
      invocations: [{ toolExecutionNotifications: [{ level: "error", message: { text: "Could not parse vendor/x.js" } }] }],
      results: [
        {
          ruleId: "js/sql-injection",
          ruleIndex: 0,
          message: { text: "This query depends on a [user-provided value](1)." },
          locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js", uriBaseId: "%SRCROOT%" }, region: { startLine: 12, startColumn: 5, snippet: { text: "db.query(sql)" } } } }],
          partialFingerprints: { primaryLocationLineHash: "abc123:1" },
          codeFlows: [
            {
              threadFlows: [
                {
                  locations: [
                    { location: { physicalLocation: { artifactLocation: { uri: "src/routes.js", uriBaseId: "%SRCROOT%" }, region: { startLine: 3 } }, message: { text: "req.query.id" } } },
                    { location: { physicalLocation: { artifactLocation: { uri: "src/db.js", uriBaseId: "%SRCROOT%" }, region: { startLine: 12 } } } },
                  ],
                },
              ],
            },
          ],
        },
        { ruleIndex: 1, message: { text: "Unused variable x." }, locations: [{ physicalLocation: { artifactLocation: { uri: "file:///C:/work/app/src/a%20b.js" }, region: { startLine: 4 } } }] },
        { ruleId: "js/unused-local-variable", kind: "pass", message: { text: "ok" } },
        { ruleId: "js/sql-injection", message: { id: "default", arguments: ["a cookie"] }, locations: [], suppressions: [{ kind: "inSource" }] },
      ],
    },
    {
      tool: { driver: { name: "Semgrep" } },
      results: [{ ruleId: "python.lang.eval", level: "warning", message: { text: "eval is dangerous" }, locations: [{ physicalLocation: { artifactLocation: { index: 0 }, region: { startLine: 9 } } }] }],
      artifacts: [{ location: { uri: "tools/run.py" } }],
    },
  ],
};

describe("SARIF", () => {
  it("reads findings with rules, severity, paths and code flows", () => {
    const r = parseSarif(JSON.stringify(log), "C:\\work\\app");
    expect(r.tools).toEqual([
      { name: "CodeQL", version: "2.19.0", rules: 2 },
      { name: "Semgrep", version: null, rules: 0 },
    ]);
    expect(r.notes).toEqual(["CodeQL: Could not parse vendor/x.js"]);
    expect(r.findings).toHaveLength(4);
    const [sql, unused, suppressed, semgrep] = r.findings;
    expect(sql).toMatchObject({ ruleId: "js/sql-injection", level: "error", severity: "high", message: "This query depends on a user-provided value.", fingerprint: "primaryLocationLineHash:abc123:1", suppressed: false });
    expect(sql.location).toEqual({ path: "src/db.js", line: 12, column: 5, endLine: null, snippet: "db.query(sql)", message: null });
    expect(sql.flows[0].map((s) => `${s.path}:${s.line}`)).toEqual(["src/routes.js:3", "src/db.js:12"]);
    expect(sql.flows[0][0].message).toBe("req.query.id");
    expect(unused).toMatchObject({ ruleId: "js/unused-local-variable", level: "note", severity: "low" });
    expect(unused.location.path).toBe("src/a b.js");
    expect(suppressed).toMatchObject({ message: "Query built from a cookie.", suppressed: true, location: { path: null } });
    expect(semgrep).toMatchObject({ tool: "Semgrep", severity: "medium", location: { path: "tools/run.py", line: 9 } });
  });

  it("rejects what is not SARIF", () => {
    expect(() => parseSarif("{")).toThrow(/not valid JSON/);
    expect(() => parseSarif("{}")).toThrow(/no runs/);
  });

  it("formats messages and severities", () => {
    expect(formatMessage({ text: "{0} flows to {1} ({2})", arguments: ["a", "b"] }, null)).toBe("a flows to b ({2})");
    expect(formatMessage({ markdown: "see [docs](https://x.y)" }, null)).toBe("see docs");
    expect(severityOf("note", 9.1)).toBe("critical");
    expect(severityOf("error", 4)).toBe("medium");
    expect(severityOf("error", null)).toBe("high");
    expect(severityOf("none", null)).toBe("info");
  });

  it("resolves URIs", () => {
    const bases = new Map([["ROOT", "file:///home/me/proj/"]]);
    expect(resolveUri("src/x.ts", "ROOT", bases, "/home/me/proj")).toBe("src/x.ts");
    expect(resolveUri("file:///home/me/other/y.ts", null, bases, "/home/me/proj")).toBe("/home/me/other/y.ts");
    expect(resolveUri("./lib\\z.go", null, bases, null)).toBe("lib/z.go");
    expect(resolveUri("file:///D:/Repo/A.cs", null, bases, "d:/repo")).toBe("A.cs");
  });

  it("compares with a baseline even when lines moved", () => {
    const cur = parseSarif(JSON.stringify(log)).findings;
    const old = structuredClone(log);
    old.runs[0].results[1].locations![0].physicalLocation.region.startLine = 40;
    old.runs[1].results = [];
    old.runs[0].results.push({ ruleId: "js/old", message: { text: "gone now" }, locations: [] } as never);
    const base = parseSarif(JSON.stringify(old)).findings;
    const c = compare(cur, base);
    expect(c.added.map((f) => f.ruleId)).toEqual(["python.lang.eval"]);
    expect(c.fixed.map((f) => f.ruleId)).toEqual(["js/old"]);
    expect(c.unchanged).toHaveLength(3);
    expect(findingKey(cur[0])).toContain("abc123");
  });

  it("filters, groups and summarizes", () => {
    const r = parseSarif(JSON.stringify(log), "C:/work/app");
    const visible = filterFindings(r.findings, { text: "", severities: new Set(), tool: null, showSuppressed: false });
    expect(visible).toHaveLength(3);
    expect(filterFindings(r.findings, { text: "cwe-089", severities: new Set(), tool: null, showSuppressed: true })).toHaveLength(2);
    expect(filterFindings(r.findings, { text: "", severities: new Set(["medium"]), tool: "Semgrep", showSuppressed: false })).toHaveLength(1);
    expect(groupFindings(visible, "severity").map((g) => g.key)).toEqual(["high", "medium", "low"]);
    expect(groupFindings(visible, "file")[0].key).toBe("src/db.js");
    const md = toMarkdown(r, visible, null);
    expect(md).toContain("CodeQL 2.19.0, Semgrep");
    expect(md).toContain("3 findings: 0 critical, 1 high, 1 medium, 1 low, 0 info.");
    expect(md).toContain("| high | js/sql-injection | `src/db.js:12` |");
  });
});
