import { describe, expect, it } from "vitest";
import { BUILTIN_WORKFLOWS } from "./library";
import { availableOn, parseProjectWorkflows } from "./sources";
import { parseTemplate } from "./template";

describe("parseProjectWorkflows", () => {
  it("accepts both shapes", () => {
    const a = parseProjectWorkflows('[{"name":"Deploy","command":"make deploy ENV={{env|staging|prod}}"}]');
    const b = parseProjectWorkflows('{"workflows":[{"name":"Seed","command":"npm run seed","tags":["db",1]}]}');
    expect(a.workflows[0]).toMatchObject({ name: "Deploy", source: "project" });
    expect(b.workflows[0].tags).toEqual(["db"]);
    expect(a.errors).toEqual([]);
  });

  it("reports malformed entries and keeps the rest", () => {
    const r = parseProjectWorkflows('[{"name":"ok","command":"ls"},{"name":"bad"},3]');
    expect(r.workflows.map((w) => w.name)).toEqual(["ok"]);
    expect(r.errors).toHaveLength(2);
  });

  it("reports invalid JSON", () => {
    expect(parseProjectWorkflows("{").errors[0]).toMatch(/Invalid JSON/);
  });
});

describe("built-in library", () => {
  it("has unique ids and parseable templates", () => {
    const ids = new Set(BUILTIN_WORKFLOWS.map((w) => w.id));
    expect(ids.size).toBe(BUILTIN_WORKFLOWS.length);
    for (const w of BUILTIN_WORKFLOWS) expect(() => parseTemplate(w.command)).not.toThrow();
  });

  it("filters by platform", () => {
    const winOnly = BUILTIN_WORKFLOWS.find((w) => w.id === "port-who-win")!;
    expect(availableOn(winOnly, "windows")).toBe(true);
    expect(availableOn(winOnly, "linux")).toBe(false);
  });
});
