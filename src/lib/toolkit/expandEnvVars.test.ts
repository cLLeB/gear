import { describe, expect, it } from "vitest";
import { expandEnvVars } from "./expandEnvVars";

describe("expandEnvVars", () => {
  const env = { HOME: "/home/dev", USER: "dev" };

  it("expands bare and braced vars", () => {
    expect(expandEnvVars("$USER at ${HOME}", env)).toBe("dev at /home/dev");
  });

  it("uses fallback for unset", () => {
    expect(expandEnvVars("$MISSING", env)).toBe("");
  });

  it("keeps original when keepUnset", () => {
    expect(expandEnvVars("$MISSING", env, { keepUnset: true })).toBe("$MISSING");
  });

  it("leaves escaped dollar literal", () => {
    expect(expandEnvVars("\\$USER", env)).toBe("$USER");
  });
});
