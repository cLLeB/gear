import { describe, expect, it } from "vitest";
import { curlToFetch, curlToPowerShell, curlToPython, parseCurl, splitCurlArgs } from "./curl";

const chrome = `curl 'https://api.example.com/v1/items?x=1' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  --data-raw $'{"name":"it\\'s","n":2}' \\
  --compressed`;

describe("splitCurlArgs", () => {
  it("handles continuations and ANSI-C quotes", () => {
    const args = splitCurlArgs(chrome);
    expect(args[0]).toBe("curl");
    expect(args).toContain(`{"name":"it's","n":2}`);
  });
});

describe("parseCurl", () => {
  it("parses a browser 'Copy as cURL' command", () => {
    const req = parseCurl(chrome);
    expect(req.url).toBe("https://api.example.com/v1/items?x=1");
    expect(req.method).toBe("POST");
    expect(req.headers).toContainEqual(["content-type", "application/json"]);
    expect(req.body).toBe(`{"name":"it's","n":2}`);
  });

  it("supports joined flags, -G, --json, -u and -F", () => {
    expect(parseCurl("curl -XPUT example.com -d a=1").method).toBe("PUT");
    expect(parseCurl("curl -XPUT example.com").url).toBe("http://example.com");
    const g = parseCurl("curl -G https://x.dev/s -d q=a --data-urlencode 'w=b c'");
    expect(g.url).toBe("https://x.dev/s?q=a&w=b%20c");
    expect(g.method).toBe("GET");
    const j = parseCurl(`curl --json '{"a":1}' https://x.dev`);
    expect(j.headers).toContainEqual(["Content-Type", "application/json"]);
    const f = parseCurl("curl -u me:pw -F file=@photo.png -F name=x https://x.dev/up");
    expect(f.user).toBe("me:pw");
    expect(f.form).toEqual([["file", "@photo.png"], ["name", "x"]]);
    expect(f.method).toBe("POST");
  });

  it("rejects non-curl input", () => {
    expect(() => parseCurl("wget x")).toThrow();
    expect(() => parseCurl("curl -s")).toThrow(/URL/);
  });
});

describe("generators", () => {
  const req = parseCurl(chrome);
  it("emits fetch with a JSON body", () => {
    const out = curlToFetch(req);
    expect(out).toContain('await fetch("https://api.example.com/v1/items?x=1", {');
    expect(out).toContain('method: "POST"');
    expect(out).toContain("body: JSON.stringify({");
    expect(out).toContain(`"name": "it's"`);
  });

  it("emits Python requests", () => {
    const out = curlToPython(req);
    expect(out).toContain("import requests");
    expect(out).toContain("json_data = {");
    expect(out).toContain("response = requests.post(");
    expect(out).not.toContain('"content-type"');
    const auth = curlToPython(parseCurl("curl -k -L -u me:p:w https://x.dev"));
    expect(auth).toContain('auth=("me", "p:w")');
    expect(auth).toContain("verify=False");
    expect(auth).not.toContain("allow_redirects");
  });

  it("emits PowerShell", () => {
    const out = curlToPowerShell(req);
    expect(out).toContain("Invoke-RestMethod -Uri 'https://api.example.com/v1/items?x=1' -Method POST");
    expect(out).toContain("-ContentType 'application/json'");
  });
});
