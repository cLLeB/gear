import { describe, expect, it } from "vitest";
import { DiagnosticsEngine } from "../engine";
import { jsonAnalyzer } from "./json";

const engine = new DiagnosticsEngine().register(jsonAnalyzer);

describe("jsonAnalyzer", () => {
  it("is clean for valid JSON", () => {
    expect(engine.run('{"a": 1}', "json")).toHaveLength(0);
  });

  it("reports syntax errors as errors", () => {
    const d = engine.run('{"a": }', "json");
    expect(d[0].severity).toBe("error");
  });

  it("treats trailing commas as a fixable warning", () => {
    const d = engine.run('{"a": 1,}', "json");
    const tc = d.find((x) => x.code === "json-trailing-comma");
    expect(tc?.severity).toBe("warning");
    expect(tc?.fixes?.[0].edits[0].insert).toBe("");
  });

  it("allows comments in jsonc", () => {
    expect(engine.run('{\n // ok\n "a": 1\n}', "jsonc")).toHaveLength(0);
  });

  it("does not run for non-json languages", () => {
    expect(engine.run('{"a": }', "javascript")).toHaveLength(0);
  });
});
