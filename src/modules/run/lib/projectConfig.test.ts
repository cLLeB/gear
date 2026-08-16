import { describe, expect, it } from "vitest";
import { parseProjectRunConfigs } from "./projectConfig";

describe("parseProjectRunConfigs", () => {
  const valid = {
    configs: [
      {
        id: "dev",
        name: "Dev server",
        command: "npm run dev",
        cwd: "{workspaceRoot}",
        env: { PORT: "3000" },
      },
    ],
  };

  it("accepts a well-formed run block", () => {
    const { configs, errors } = parseProjectRunConfigs(valid);
    expect(errors).toEqual([]);
    expect(configs).toEqual([
      {
        id: "dev",
        name: "Dev server",
        command: "npm run dev",
        cwd: "{workspaceRoot}",
        env: { PORT: "3000" },
      },
    ]);
  });

  it("treats a missing or empty run block as no configs", () => {
    expect(parseProjectRunConfigs(undefined).configs).toEqual([]);
    expect(parseProjectRunConfigs(null).configs).toEqual([]);
    expect(parseProjectRunConfigs({}).configs).toEqual([]);
    expect(parseProjectRunConfigs({ configs: [] }).configs).toEqual([]);
  });

  it("derives an id from the name when one is not given", () => {
    const { configs } = parseProjectRunConfigs({
      configs: [{ name: "Dev Server 2", command: "x" }],
    });
    expect(configs[0].id).toBe("dev-server-2");
  });

  it("normalises extensions to lowercase without dots", () => {
    const { configs } = parseProjectRunConfigs({
      configs: [{ name: "n", command: "c", extensions: [".PY", "Rb"] }],
    });
    expect(configs[0].extensions).toEqual(["py", "rb"]);
  });

  it("drops an invalid entry but keeps the valid ones", () => {
    const { configs, errors } = parseProjectRunConfigs({
      configs: [
        { name: "ok", command: "c" },
        { name: "missing command" },
        { command: "missing name" },
      ],
    });
    expect(configs.map((c) => c.name)).toEqual(["ok"]);
    expect(errors).toHaveLength(2);
  });

  it("rejects a non-string env value rather than coercing it", () => {
    const { configs, errors } = parseProjectRunConfigs({
      configs: [{ name: "n", command: "c", env: { PORT: 3000 } }],
    });
    expect(configs).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("reports a run block that is not an object", () => {
    const { configs, errors } = parseProjectRunConfigs("nope");
    expect(configs).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("reports configs that is not an array", () => {
    const { errors } = parseProjectRunConfigs({ configs: { a: 1 } });
    expect(errors).toHaveLength(1);
  });

  it("de-duplicates ids so the picker cannot show two identical entries", () => {
    const { configs } = parseProjectRunConfigs({
      configs: [
        { name: "Dev", command: "a" },
        { name: "Dev", command: "b" },
      ],
    });
    expect(configs.map((c) => c.id)).toEqual(["dev", "dev-2"]);
  });

  it("ignores unknown keys instead of failing the whole file", () => {
    const { configs, errors } = parseProjectRunConfigs({
      configs: [{ name: "n", command: "c", futureOption: true }],
    });
    expect(errors).toEqual([]);
    expect(configs).toHaveLength(1);
  });
});
