import { describe, expect, it } from "vitest";
import { extractTokens } from "./quickSelect";

const pairs = (text: string) => extractTokens(text).map((t) => [t.kind, t.text]);

describe("extractTokens", () => {
  it("finds the usual suspects, most recent first", () => {
    const text = [
      "commit 3f2a9c1b8e7d (HEAD -> main)",
      "see https://github.com/org/repo/pull/12.",
      "contact dev@example.com from 192.168.1.20:8080",
      "id 123e4567-e89b-12d3-a456-426614174000 at ./src/app.ts",
      "color #ff8800 pid 48213",
    ].join("\n");
    expect(pairs(text)).toEqual([
      ["number", "48213"],
      ["hexcolor", "#ff8800"],
      ["path", "./src/app.ts"],
      ["uuid", "123e4567-e89b-12d3-a456-426614174000"],
      ["ip", "192.168.1.20:8080"],
      ["email", "dev@example.com"],
      ["url", "https://github.com/org/repo/pull/12"],
      ["sha", "3f2a9c1b8e7d"],
    ]);
  });

  it("does not split a URL into path pieces", () => {
    expect(pairs("open http://localhost:3000/api/users")).toEqual([
      ["url", "http://localhost:3000/api/users"],
    ]);
  });

  it("rejects words and pure numbers as hashes", () => {
    const kinds = extractTokens("deadbeefcafe facade 1234567").map((t) => t.kind);
    expect(kinds).toEqual(["number"]);
  });

  it("counts repeats once", () => {
    const [tok] = extractTokens("/tmp/x\n/tmp/x");
    expect(tok).toEqual({ kind: "path", text: "/tmp/x", count: 2 });
  });
});
