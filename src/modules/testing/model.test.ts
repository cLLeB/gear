import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverGo,
  discoverJs,
  discoverPytest,
  discoverRust,
  frameworkFor,
  parseCargo,
  parseGoCover,
  parseGoJson,
  parseJestJson,
  parseJunit,
  parseLcov,
  runCommand,
  sameTest,
} from "./model";

const fx = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf8");

describe("discovery", () => {
  it("finds nested JS tests with lines, ignoring strings and comments", () => {
    const src = `import { it } from "vitest";
// it("commented out", () => {})
describe("math", () => {
  it('adds', () => { expect("}").toBe("}"); });
  describe.each([1])("nested %s", () => {
    test.only(\`template\`, async () => {});
  });
});
it.skip("top", () => {});
`;
    expect(discoverJs(src).map((t) => `${t.kind}:${t.id}@${t.line}`)).toEqual(["suite:math@3", "test:math › adds@4", "suite:math › nested %s@5", "test:math › nested %s › template@6", "test:top@9"]);
  });

  it("finds pytest, Go and Rust tests", () => {
    expect(discoverPytest("def add(a, b):\n    pass\n\ndef test_add():\n    pass\n\nclass TestMore:\n    def test_fail(self):\n        pass\n\ndef helper():\n    pass\n").map((t) => `${t.id}@${t.line}`)).toEqual([
      "test_add@4",
      "TestMore@7",
      "TestMore › test_fail@8",
    ]);
    expect(discoverGo("package g\n\nfunc TestAdd(t *testing.T) {}\nfunc helper() {}\nfunc BenchmarkX(b *testing.B) {}\n").map((t) => t.id)).toEqual(["TestAdd", "BenchmarkX"]);
    expect(discoverRust("fn x() {}\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() {\n        let s = \"}\";\n    }\n    #[tokio::test]\n    async fn later() {}\n    fn helper() {}\n}\n#[test]\nfn top() {}\n").map((t) => `${t.id}@${t.line}`)).toEqual(["tests::adds@5", "tests::later@9", "top@13"]);
  });

  it("maps files to frameworks", () => {
    expect(frameworkFor("src/a.test.ts")).toBe("vitest");
    expect(frameworkFor("src/__tests__/a.js", { jest: true })).toBe("jest");
    expect(frameworkFor("tests/test_api.py")).toBe("pytest");
    expect(frameworkFor("pkg/x_test.go")).toBe("go");
    expect(frameworkFor("src/main.ts")).toBeNull();
  });
});

describe("commands", () => {
  it("targets a single test", () => {
    const t = { id: "math › nested › fails (x)", name: "fails (x)", suites: ["math", "nested"], line: 1, kind: "test" as const };
    expect(runCommand({ framework: "vitest", relFile: "src/a.test.ts", test: t, reportPath: "/tmp/r.json" }).argv).toEqual([
      "npx", "vitest", "run", "src/a.test.ts", "--reporter=json", "--outputFile=/tmp/r.json", "-t", "^math nested fails \\(x\\)$",
    ]);
    expect(runCommand({ framework: "pytest", relFile: "tests/test_a.py", test: { id: "TestA › test_b", name: "test_b", suites: ["TestA"], line: 1, kind: "test" }, reportPath: "/r.xml" }).argv.slice(0, 4)).toEqual(["python", "-m", "pytest", "tests/test_a.py::TestA::test_b"]);
    expect(runCommand({ framework: "go", goPackage: "./pkg", test: { id: "TestX", name: "TestX", suites: [], line: 1, kind: "test" }, reportPath: "" }).argv).toEqual(["go", "test", "-json", "./pkg", "-run", "^TestX$"]);
  });
});

describe("parsers (real framework output)", () => {
  it("reads Vitest JSON", () => {
    const r = parseJestJson(fx("vitest.json"));
    expect(r.map((x) => `${x.id}:${x.status}`)).toEqual(["math › adds:passed", "math › nested › fails here:failed", "skipped one:skipped"]);
    const fail = r.find((x) => x.status === "failed")!;
    expect(fail.message).toContain("expected 4 to be 5");
    expect(fail.failureLine).toBe(10);
  });

  it("reads pytest JUnit XML", () => {
    const r = parseJunit(fx("junit.xml"));
    expect(r.map((x) => `${x.id}:${x.status}`)).toEqual(["test_add:passed", "TestMore › test_fail:failed", "TestMore › test_ok:passed"]);
    expect(r[1].message).toContain("assert 4 == 5");
    expect(r[1].failureLine).toBe(9);
  });

  it("reads go test -json", () => {
    const r = parseGoJson(fx("go.json"));
    const byId = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(byId.TestAdd.status).toBe("passed");
    expect(byId["TestBad › sub"].status).toBe("failed");
    expect(byId["TestBad › sub"].message).toContain("want 5 got 4");
    expect(byId["TestBad › sub"].failureLine).toBe(14);
    expect(byId.TestBad.status).toBe("failed");
  });

  it("reads cargo test output", () => {
    const r = parseCargo(fx("cargo.txt"));
    expect(r.map((x) => `${x.id}:${x.status}`)).toEqual(["tests::adds:passed", "tests::fails:failed"]);
    expect(r[1]).toMatchObject({ file: "src/lib.rs", failureLine: 14 });
    expect(r[1].message).toContain("left: 4");
  });

  it("reads coverage", () => {
    const lcov = parseLcov(fx("py.lcov"));
    const calc = [...lcov.entries()].find(([f]) => f.endsWith("test_calc.py"))![1];
    expect(calc.found).toBeGreaterThan(5);
    expect(calc.hit).toBe(calc.found);
    const go = parseGoCover(fx("go.cover"));
    const g = go.get("ex.com/g/g.go")!;
    expect(g.lines.get(3)).toBe(1);
    expect(g.lines.get(6)).toBe(0);
    expect(g.hit).toBe(1);
  });

  it("matches ids across separators", () => {
    expect(sameTest("tests::adds", "tests › adds")).toBe(true);
    expect(sameTest("a ›  b", "a › b")).toBe(true);
  });
});
