import { describe, expect, it } from "vitest";
import { parseVariables, requestAt, toCurl, toCurlPowerShell } from "./httpFile";

const file = `@host = https://api.example.com
@base = {{host}}/v1

### List users
GET {{base}}/users
    ?page=2
Accept: application/json
# a comment header line

###
# @name create
POST {{base}}/users HTTP/1.1
Content-Type: application/json
Authorization: Bearer {{token}}

{
  "name": "O'Brien"
}

> {% client.global.set("id", response.body.id) %}
`;

describe("http files", () => {
  it("resolves nested variables", () => {
    expect(parseVariables(file).base).toBe("https://api.example.com/v1");
  });

  it("parses the request under the cursor", () => {
    const first = requestAt(file, file.indexOf("Accept"));
    expect(first).toEqual({
      name: "List users",
      method: "GET",
      url: "https://api.example.com/v1/users?page=2",
      headers: [["Accept", "application/json"]],
      body: null,
    });
    const second = requestAt(file, file.indexOf("O'Brien"))!;
    expect(second.name).toBe("create");
    expect(second.method).toBe("POST");
    expect(second.headers).toContainEqual(["Authorization", "Bearer {{token}}"]);
    expect(second.body).toBe('{\n  "name": "O\'Brien"\n}');
  });

  it("builds curl commands", () => {
    const req = requestAt(file, file.indexOf("O'Brien"))!;
    const sh = toCurl(req);
    expect(sh).toContain("curl -sS -i -X POST https://api.example.com/v1/users");
    expect(sh).toContain(`-H 'Content-Type: application/json'`);
    expect(sh).toContain(`'{\n  "name": "O'\\''Brien"\n}'`);
    expect(toCurl(requestAt(file, file.indexOf("GET"))!)).toBe("curl -sS -i 'https://api.example.com/v1/users?page=2' -H 'Accept: application/json'");
    expect(toCurlPowerShell(req)).toContain("curl.exe -sS -i -X POST 'https://api.example.com/v1/users'");
  });

  it("returns null for an empty block", () => {
    expect(requestAt("###\n\n###\nGET /x", 4)).toBeNull();
  });
});
