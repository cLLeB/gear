import { describe, expect, it } from "vitest";
import {
  formatEnvInput,
  formatExtensionsInput,
  parseEnvInput,
  validateRunConfigForm,
} from "./configForm";

describe("parseEnvInput", () => {
  it("parses KEY=value lines", () => {
    expect(parseEnvInput("PORT=3000\nMODE=dev").env).toEqual({
      PORT: "3000",
      MODE: "dev",
    });
  });

  it("trims surrounding whitespace around key and value", () => {
    expect(parseEnvInput("  PORT = 3000  ").env).toEqual({ PORT: "3000" });
  });

  it("keeps '=' inside a value", () => {
    expect(parseEnvInput("URL=a=b").env).toEqual({ URL: "a=b" });
  });

  it("ignores blank lines and comments", () => {
    const { env, errors } = parseEnvInput("# a note\n\nPORT=1\n");
    expect(env).toEqual({ PORT: "1" });
    expect(errors).toEqual([]);
  });

  it("accepts an empty value", () => {
    expect(parseEnvInput("EMPTY=").env).toEqual({ EMPTY: "" });
  });

  it("reports a line with no '='", () => {
    expect(parseEnvInput("JUST_A_NAME").errors).toHaveLength(1);
  });

  it("reports a line with an empty key", () => {
    expect(parseEnvInput("=value").errors).toHaveLength(1);
  });

  it("round-trips through formatEnvInput", () => {
    const env = { A: "1", B: "2" };
    expect(parseEnvInput(formatEnvInput(env)).env).toEqual(env);
  });
});

describe("formatExtensionsInput", () => {
  it("joins with commas", () => {
    expect(formatExtensionsInput(["py", "rb"])).toBe("py, rb");
  });

  it("renders an absent list as empty", () => {
    expect(formatExtensionsInput(undefined)).toBe("");
  });
});

describe("validateRunConfigForm", () => {
  const base = {
    id: "custom",
    name: "Poetry",
    command: "poetry run python {file}",
    extensions: "py",
    cwd: "",
    env: "",
  };

  it("builds a config from a complete form", () => {
    const { config, errors } = validateRunConfigForm(base);
    expect(errors).toEqual([]);
    expect(config).toEqual({
      id: "custom",
      name: "Poetry",
      command: "poetry run python {file}",
      extensions: ["py"],
    });
  });

  it("normalises extensions, dropping dots, case and blanks", () => {
    const { config } = validateRunConfigForm({
      ...base,
      extensions: ".PY, ,Rb,",
    });
    expect(config?.extensions).toEqual(["py", "rb"]);
  });

  it("omits extensions entirely when the field is blank", () => {
    const { config } = validateRunConfigForm({ ...base, extensions: "  " });
    expect(config).not.toHaveProperty("extensions");
  });

  it("includes cwd and env only when given", () => {
    const { config } = validateRunConfigForm({
      ...base,
      cwd: "{workspaceRoot}",
      env: "PORT=3000",
    });
    expect(config?.cwd).toBe("{workspaceRoot}");
    expect(config?.env).toEqual({ PORT: "3000" });
  });

  it("requires a name", () => {
    const { config, errors } = validateRunConfigForm({ ...base, name: " " });
    expect(config).toBeNull();
    expect(errors[0]).toMatch(/name/i);
  });

  it("requires a command", () => {
    const { config, errors } = validateRunConfigForm({ ...base, command: "" });
    expect(config).toBeNull();
    expect(errors[0]).toMatch(/command/i);
  });

  it("surfaces env parse errors", () => {
    const { config, errors } = validateRunConfigForm({ ...base, env: "oops" });
    expect(config).toBeNull();
    expect(errors).toHaveLength(1);
  });

  it("generates an id when the form has none", () => {
    const { config } = validateRunConfigForm({ ...base, id: "" });
    expect(config?.id).toBeTruthy();
  });
});
