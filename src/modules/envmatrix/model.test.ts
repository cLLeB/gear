import { describe, expect, it } from "vitest";
import { compareEnv, duplicates, filterEnv, isEnvFileName, isTemplate, keyNameProblem, looksSecret, mask, orderFiles, parseEnv, quote, removeKey, serializeEnv, setValue, values } from "./model";

const SAMPLE = `# Database
DB_HOST=localhost
DB_PORT=5432   # default port
export API_KEY="abc 123"
EMPTY=
QUOTED='single $notexpanded'
MULTI="line1\\nline2"
WITH_HASH=a#b
not an assignment

URL=https://example.org/?a=1&b=2
`;

describe("env matrix model", () => {
  it("parses values the way dotenv does", () => {
    expect(values(parseEnv(SAMPLE))).toEqual({ DB_HOST: "localhost", DB_PORT: "5432", API_KEY: "abc 123", EMPTY: "", QUOTED: "single $notexpanded", MULTI: "line1\nline2", WITH_HASH: "a#b", URL: "https://example.org/?a=1&b=2" });
  });

  it("round-trips a file byte for byte", () => {
    expect(serializeEnv(parseEnv(SAMPLE))).toBe(SAMPLE);
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    expect(serializeEnv(parseEnv(crlf))).toBe(crlf);
    expect(serializeEnv(parseEnv("A=1"))).toBe("A=1");
    expect(serializeEnv(parseEnv(""))).toBe("");
  });

  it("changes one line and leaves the rest alone", () => {
    const f = parseEnv(SAMPLE);
    const a = serializeEnv(setValue(f, "DB_PORT", "6543"));
    expect(a).toBe(SAMPLE.replace("DB_PORT=5432   # default port", "DB_PORT=6543   # default port"));
    const b = serializeEnv(setValue(f, "API_KEY", 'new "quoted" $value'));
    expect(b).toContain('export API_KEY="new \\"quoted\\" \\$value"');
    expect(values(parseEnv(b)).API_KEY).toBe('new "quoted" $value');
    expect(serializeEnv(setValue(f, "EMPTY", "now set"))).toContain('EMPTY="now set"\n');
    expect(serializeEnv(f)).toBe(SAMPLE);
  });

  it("appends new keys before trailing blank lines and removes keys", () => {
    expect(serializeEnv(setValue(parseEnv("A=1\n\n\n"), "B", "2"))).toBe("A=1\nB=2\n\n\n");
    expect(serializeEnv(setValue(parseEnv("A=1"), "B", "x y"))).toBe('A=1\nB="x y"\n');
    expect(serializeEnv(setValue(parseEnv(""), "A", ""))).toBe("A=\n");
    expect(serializeEnv(removeKey(parseEnv("A=1\n# note\nB=2\nA=3\n"), "A"))).toBe("# note\nB=2\n");
  });

  it("quotes only when needed, and every value survives a round trip", () => {
    expect(quote("simple-value_1.0")).toBe("simple-value_1.0");
    expect(quote("https://x.org/a?b=c")).toBe('"https://x.org/a?b=c"');
    expect(quote("")).toBe("");
    for (const v of ["a b", "a#b", " lead", 'q"uote', "back\\slash", "$HOME", "two\nlines", "tab\there", "'single'", "https://x.org/a?b=c&d=e"]) expect(values(setValue(parseEnv(""), "K", v)).K, v).toBe(v);
  });

  it("spots duplicates, templates and secrets", () => {
    expect(duplicates(parseEnv("A=1\nB=2\nA=3\nA=4"))).toEqual(["A"]);
    expect(values(parseEnv("A=1\nA=3")).A).toBe("3");
    expect([".env.example", ".env.sample", ".env.template", "example.env"].every(isTemplate)).toBe(true);
    expect([".env", ".env.local", ".env.production"].some(isTemplate)).toBe(false);
    expect([".env", ".env.local", ".env.production.local", "docker.env"].every(isEnvFileName)).toBe(true);
    expect(["env.ts", ".envrc", "README.md", ".environment"].some(isEnvFileName)).toBe(false);
    expect(orderFiles([".env.production", ".env", ".env.local", ".env.example"])).toEqual([".env.example", ".env", ".env.local", ".env.production"]);
    expect(["API_KEY", "DB_PASSWORD", "JWT_SECRET", "AUTH_TOKEN", "SENTRY_DSN"].every(looksSecret)).toBe(true);
    expect(["PORT", "NODE_ENV", "LOG_LEVEL"].some(looksSecret)).toBe(false);
  });

  it("compares files", () => {
    const files = {
      ".env.example": parseEnv("PORT=\nAPI_KEY=\nDEBUG=\nNEW_FLAG=\n"),
      ".env": parseEnv("PORT=3000\nAPI_KEY=abc\nDEBUG=\nLOCAL_ONLY=1\n"),
      ".env.production": parseEnv("PORT=8080\nAPI_KEY=abc\nDEBUG=false\n"),
    };
    const order = orderFiles(Object.keys(files));
    const rows = compareEnv(files, order);
    expect(rows.map((r) => r.key)).toEqual(["PORT", "API_KEY", "DEBUG", "NEW_FLAG", "LOCAL_ONLY"]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.cells]));
    expect(by.PORT).toEqual({ ".env.example": "ok", ".env": "differs", ".env.production": "differs" });
    expect(by.API_KEY).toEqual({ ".env.example": "ok", ".env": "ok", ".env.production": "ok" });
    expect(by.DEBUG).toEqual({ ".env.example": "ok", ".env": "empty", ".env.production": "ok" });
    expect(by.NEW_FLAG).toEqual({ ".env.example": "ok", ".env": "missing", ".env.production": "missing" });
    expect(by.LOCAL_ONLY).toEqual({ ".env.example": "missing", ".env": "ok", ".env.production": "missing" });
    expect(rows.find((r) => r.key === "API_KEY")?.secret).toBe(true);
    expect(filterEnv(rows, "problems", "").map((r) => r.key)).toEqual(["DEBUG", "NEW_FLAG", "LOCAL_ONLY"]);
    expect(filterEnv(rows, "differs", "").map((r) => r.key)).toEqual(["PORT"]);
    expect(filterEnv(rows, "all", "api").map((r) => r.key)).toEqual(["API_KEY"]);
  });

  it("masks values and validates names", () => {
    expect(mask("abcdefghij")).toBe("ab••••••ij");
    expect(mask("abc")).toBe("•••");
    expect(mask("false")).toBe("•••••");
    expect(mask("12345678")).toBe("••••••••");
    expect(mask("x".repeat(40))).toBe(`xx${"•".repeat(12)}xx`);
    expect(mask("")).toBe("");
    expect(keyNameProblem("NEW_VAR", ["A"])).toBeNull();
    expect(keyNameProblem("1BAD", [])).toMatch(/letters/);
    expect(keyNameProblem("A", ["A"])).toMatch(/exists/);
    expect(keyNameProblem(" ", [])).toMatch(/Enter/);
  });
});
