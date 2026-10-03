import { describe, expect, it } from "vitest";
import { entropy, maskSecret, scanForSecrets } from "./secretScan";

const kinds = (line: string) => scanForSecrets(line).map((h) => h.kind);

describe("scanForSecrets", () => {
  it.each([
    ["-----BEGIN OPENSSH PRIVATE KEY-----", "private-key"],
    ["-----BEGIN RSA PRIVATE KEY-----", "private-key"],
    ["export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
    ["token: ghp_abcdefghijklmnopqrstuvwxyz0123456789AB", "github-token"],
    ["GITLAB=glpat-abcdefghij0123456789", "gitlab-token"],
    ["DATABASE_URL=postgres://app:s3cr3tpass@db:5432/app", "db-url"],
    ["ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "anthropic-key"],
  ])("%s", (line, kind) => {
    expect(kinds(line)).toContain(kind);
  });

  it("flags high-entropy secret assignments", () => {
    expect(kinds("JWT_SECRET=Zq8#kP2!vR9mW4xT7bN1")).toEqual(["assignment"]);
  });

  it("ignores placeholders and low-entropy values", () => {
    expect(kinds("API_KEY=$API_KEY")).toEqual([]);
    expect(kinds("PASSWORD=changeme")).toEqual([]);
    expect(kinds("SECRET_KEY=aaaaaaaaaaaaaaaa")).toEqual([]);
    expect(kinds("TOKEN=<your-token-here>")).toEqual([]);
    expect(kinds("ACCESS_TOKEN=<REDACTED:github-token>")).toEqual([]);
  });

  it("ignores ordinary output", () => {
    expect(kinds("Compiled successfully in 1.2s")).toEqual([]);
    expect(kinds("postgres://localhost:5432/app")).toEqual([]);
  });
});

describe("helpers", () => {
  it("masks the middle of a secret", () => {
    expect(maskSecret("ghp_1234567890abcdef")).toBe("ghp_••••••••••••cdef");
    expect(maskSecret("short")).toBe("•••••");
  });
  it("computes entropy", () => {
    expect(entropy("aaaa")).toBe(0);
    expect(entropy("abcd")).toBe(2);
  });
});
