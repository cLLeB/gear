import { describe, expect, it } from "vitest";
import { allows, effective, evaluate, grade, parsePolicies, parsePolicy, sourceMatches, strictTemplate } from "./model";

const rules = (p: string) => evaluate(parsePolicy(p)).map((f) => `${f.severity}:${f.directive}`);

describe("Content-Security-Policy", () => {
  it("parses directives, ignoring repeats and reporting unknown names", () => {
    const p = parsePolicy("default-src 'self';  script-src 'self' https://cdn.example.com ; script-src *; img-srcc x; ");
    expect([...p.directives]).toEqual([
      ["default-src", ["'self'"]],
      ["script-src", ["'self'", "https://cdn.example.com"]],
      ["img-srcc", ["x"]],
    ]);
    expect(p.problems).toEqual(["script-src appears twice; browsers use the first and ignore “script-src *”.", "img-srcc is not a CSP directive; browsers ignore it."]);
    expect(parsePolicies("default-src 'self', script-src 'none'")).toHaveLength(2);
  });

  it("follows fallbacks", () => {
    const p = parsePolicy("default-src 'self'; script-src 'nonce-a'; child-src blob:");
    expect(effective(p, "script-src-elem")).toEqual({ from: "script-src", sources: ["'nonce-a'"] });
    expect(effective(p, "worker-src")).toEqual({ from: "child-src", sources: ["blob:"] });
    expect(effective(p, "img-src")).toEqual({ from: "default-src", sources: ["'self'"] });
    expect(effective(parsePolicy("img-src *"), "script-src")).toEqual({ from: null, sources: null });
  });

  it("finds the classic weaknesses", () => {
    expect(rules("img-src *")).toEqual(["high:script-src", "high:object-src", "medium:base-uri", "low:frame-ancestors", "info:form-action", "info:report-to"]);
    expect(rules("default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://ajax.googleapis.com *.example.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; report-to csp")).toEqual([
      "high:script-src",
      "medium:script-src",
      "medium:script-src",
      "medium:script-src",
      "info:script-src",
    ]);
    expect(grade(evaluate(parsePolicy("img-src *")))).toBe("F");
  });

  it("recognises a strong nonce-based policy", () => {
    const strong = strictTemplate(null).replace("{RANDOM}", "rAnd0mN0nce1234567890ab") + "; report-to csp";
    const f = evaluate(parsePolicy(strong));
    expect(f.map((x) => x.severity)).toEqual(["info", "info"]);
    expect(f[0].message).toMatch(/^'unsafe-inline' is ignored/);
    expect(f[1].message).toMatch(/^With 'strict-dynamic', host sources/);
    expect(grade(f)).toBe("A");
  });

  it("catches unquoted keywords, weak nonces, http sources and deprecated directives", () => {
    const f = evaluate(parsePolicy("script-src self 'nonce-abc' 'strict-dynamic'; img-src http://cdn.example.com; object-src 'none'; base-uri 'none'; block-all-mixed-content"));
    const msgs = f.map((x) => x.message);
    expect(msgs).toContain("self without quotes is a host named “self”, not the keyword; write 'self'.");
    expect(msgs.some((m) => m.startsWith("The nonce 'nonce-abc' looks short"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("http://cdn.example.com allows loading over plain HTTP"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("block-all-mixed-content is obsolete"))).toBe(true);
  });

  it("matches source expressions by the CSP3 rules", () => {
    const page = "https://app.example.com/home";
    expect(sourceMatches("'self'", "https://app.example.com/a.js", page)).toBe(true);
    expect(sourceMatches("'self'", "https://cdn.example.com/a.js", page)).toBe(false);
    expect(sourceMatches("'self'", "wss://app.example.com/socket", page)).toBe(true);
    expect(sourceMatches("*.example.com", "https://cdn.example.com/x", page)).toBe(true);
    expect(sourceMatches("*.example.com", "https://example.com/x", page)).toBe(false);
    expect(sourceMatches("http://cdn.example.com", "https://cdn.example.com/x", page)).toBe(true);
    expect(sourceMatches("https://cdn.example.com", "http://cdn.example.com/x", page)).toBe(false);
    expect(sourceMatches("cdn.example.com:8443", "https://cdn.example.com:8443/x", page)).toBe(true);
    expect(sourceMatches("cdn.example.com", "https://cdn.example.com:8443/x", page)).toBe(false);
    expect(sourceMatches("https://cdn.example.com/js/", "https://cdn.example.com/js/app.js", page)).toBe(true);
    expect(sourceMatches("https://cdn.example.com/js/app.js", "https://cdn.example.com/js/other.js", page)).toBe(false);
    expect(sourceMatches("https:", "https://anything.net/x", page)).toBe(true);
    expect(sourceMatches("*", "data:image/png;base64,AA", page)).toBe(false);
    expect(sourceMatches("data:", "data:image/png;base64,AA", page)).toBe(true);
  });

  it("decides whether resources load", () => {
    const page = "https://app.example.com/";
    const p = parsePolicy("default-src 'self'; script-src 'self' 'nonce-r4nd0m' 'unsafe-inline' https://cdn.example.com; img-src * data:; style-src 'self' 'unsafe-inline'");
    expect(allows(p, { kind: "script", url: "https://cdn.example.com/lib.js" }, page)).toEqual({ allowed: true, directive: "script-src", reason: "https://cdn.example.com" });
    expect(allows(p, { kind: "script", url: "https://evil.net/x.js" }, page)).toEqual({ allowed: false, directive: "script-src", reason: "no source in script-src matches" });
    expect(allows(p, { kind: "inline-script", url: null }, page).reason).toBe("'unsafe-inline' is ignored because the policy has a nonce, hash or 'strict-dynamic'");
    expect(allows(p, { kind: "inline-script", url: null, nonce: "r4nd0m" }, page).allowed).toBe(true);
    expect(allows(p, { kind: "inline-style", url: null }, page).reason).toBe("'unsafe-inline'");
    expect(allows(p, { kind: "eval", url: null }, page)).toEqual({ allowed: false, directive: "script-src", reason: "no 'unsafe-eval'" });
    expect(allows(p, { kind: "img", url: "data:image/png;base64,AA" }, page).allowed).toBe(true);
    expect(allows(p, { kind: "connect", url: "https://api.other.com/x" }, page).reason).toBe("no source in default-src matches");
    expect(allows(p, { kind: "frame-ancestor", url: "https://evil.net/" }, page)).toEqual({ allowed: true, directive: null, reason: "no frame-ancestors directive" });
    const strict = parsePolicy("script-src 'nonce-r4nd0m' 'strict-dynamic' https:");
    expect(allows(strict, { kind: "script", url: "https://cdn.example.com/a.js" }, page).allowed).toBe(false);
    expect(allows(strict, { kind: "script", url: "https://cdn.example.com/a.js", loadedByTrustedScript: true }, page).allowed).toBe(true);
    expect(allows(parsePolicy("script-src 'sha256-AbC='"), { kind: "event-handler", url: null, hash: "sha256-AbC=" }, page).allowed).toBe(false);
    expect(allows(parsePolicy("script-src 'sha256-AbC=' 'unsafe-hashes'"), { kind: "event-handler", url: null, hash: "sha256-AbC=" }, page).allowed).toBe(true);
  });
});
