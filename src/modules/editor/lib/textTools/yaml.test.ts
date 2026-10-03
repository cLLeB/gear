import { describe, expect, it } from "vitest";
import { detectJsonIndent, parseYaml, sortKeysDeep, toYaml, YamlError } from "./yaml";

describe("parseYaml", () => {
  it("parses a GitHub workflow-like document", () => {
    const doc = [
      "name: CI # the name",
      "on:",
      "  push:",
      "    branches: [main, 'release/*']",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - name: Run",
      "        run: |",
      "          npm ci",
      "          npm test",
      "        env: { CI: true, RETRIES: 3 }",
      "      - plain item",
    ].join("\n");
    expect(parseYaml(doc)).toEqual({
      name: "CI",
      on: { push: { branches: ["main", "release/*"] } },
      jobs: {
        test: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/checkout@v4" },
            { name: "Run", run: "npm ci\nnpm test\n", env: { CI: true, RETRIES: 3 } },
            "plain item",
          ],
        },
      },
    });
  });

  it("types scalars per the core schema and honours quotes", () => {
    expect(parseYaml("a: 1\nb: 1.5\nc: true\nd: null\ne: ~\nf: '1'\ng: \"x\\ny\"\nh: 0x1f\ni: hello world")).toEqual({
      a: 1,
      b: 1.5,
      c: true,
      d: null,
      e: null,
      f: "1",
      g: "x\ny",
      h: 31,
      i: "hello world",
    });
  });

  it("handles sequences at the same indent as their key, nested lists and folded scalars", () => {
    expect(parseYaml("list:\n- a\n- - b\n  - c\ntext: >-\n  one\n  two\n\n  three\n")).toEqual({
      list: ["a", ["b", "c"]],
      text: "one two\nthree",
    });
  });

  it("splits multiple documents", () => {
    expect(parseYaml("a: 1\n---\nb: 2\n")).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reports errors with line numbers", () => {
    expect(() => parseYaml("a: 1\na: 2")).toThrow(YamlError);
    expect(() => parseYaml("a:\n\tb: 1")).toThrow(/line 2/);
  });
});

describe("toYaml", () => {
  it("round-trips through parseYaml", () => {
    const value = {
      name: "app",
      version: "1.0",
      enabled: true,
      count: 3,
      empty: [],
      nothing: null,
      tags: ["a", "b: c", "yes"],
      nested: { list: [{ k: 1, j: [1, 2] }, [3, 4]], script: "line1\nline2\n" },
    };
    const yaml = toYaml(value);
    expect(parseYaml(yaml)).toEqual(value);
    expect(yaml).toContain('version: "1.0"');
    expect(yaml).toContain('- "yes"');
  });
});

describe("helpers", () => {
  it("sorts keys deeply with numeric awareness", () => {
    expect(JSON.stringify(sortKeysDeep({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] }, k10: 0, k2: 0 }))).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":1},"b":1,"k2":0,"k10":0}',
    );
  });
  it("detects JSON indentation", () => {
    expect(detectJsonIndent('{\n    "a": 1\n}')).toBe(4);
    expect(detectJsonIndent('{\n\t"a": 1\n}')).toBe("\t");
    expect(detectJsonIndent('{"a":1}')).toBe(2);
  });
});
