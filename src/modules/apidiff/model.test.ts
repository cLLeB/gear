import { describe, expect, it } from "vitest";
import { parseYaml } from "@/modules/editor/lib/textTools/yaml";
import { diffSpecs, resolver, toMarkdown, type ApiChange } from "./model";

const v1 = `
openapi: 3.0.3
info: { title: Pets, version: "1" }
servers:
  - url: https://api.example.com/v1
paths:
  /pets:
    get:
      operationId: listPets
      parameters:
        - { name: limit, in: query, schema: { type: integer, maximum: 100 } }
        - { name: tag, in: query, schema: { type: string } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Pet" } }
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NewPet" }
      responses:
        "201": { description: created }
  /pets/{petId}:
    get:
      parameters:
        - { name: petId, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Pet" }
        "404": { description: missing }
    delete:
      deprecated: true
      responses:
        "204": { description: gone }
components:
  schemas:
    Pet:
      type: object
      required: [id, name]
      properties:
        id: { type: integer }
        name: { type: string }
        status: { type: string, enum: [available, sold] }
        owner: { $ref: "#/components/schemas/Pet" }
    NewPet:
      type: object
      required: [name]
      properties:
        name: { type: string, maxLength: 100 }
        nickname: { type: string }
`;

const v2 = `
openapi: 3.0.3
info: { title: Pets, version: "2" }
servers:
  - url: https://api.example.com/v2
paths:
  /pets:
    get:
      operationId: findPets
      parameters:
        - { name: limit, in: query, required: true, schema: { type: integer, maximum: 50 } }
        - { name: sort, in: query, schema: { type: string } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Pet" } }
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NewPet" }
      responses:
        "201": { description: created }
  /pets/{id}:
    get:
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Pet" }
  /stores:
    get:
      responses:
        "200": { description: ok }
components:
  schemas:
    Pet:
      type: object
      required: [id]
      properties:
        id: { type: string }
        status: { type: string, enum: [available, sold, pending] }
        owner: { $ref: "#/components/schemas/Pet" }
        age: { type: integer }
    NewPet:
      type: object
      required: [name, species]
      properties:
        name: { type: string, maxLength: 50 }
        species: { type: string }
`;

const line = (c: ApiChange) => `${c.severity} | ${c.operation} | ${c.where} | ${c.message}`;

describe("OpenAPI diff", () => {
  it("resolves local refs, including escaped segments and cycles", () => {
    const doc = { a: { "x/y": { v: 1 } }, loop: { $ref: "#/loop" }, r: { $ref: "#/a/x~1y" } };
    const r = resolver(doc);
    expect(r({ $ref: "#/r" })).toEqual({ v: 1 });
    expect(r({ $ref: "#/loop" })).toEqual({ $ref: "#/loop" });
  });

  it("classifies the changes between two versions", () => {
    const changes = diffSpecs(parseYaml(v1), parseYaml(v2)).map(line);
    expect(changes).toEqual(
      expect.arrayContaining([
        "risky | DELETE /pets/{petId} |  | Deprecated operation removed.",
        "breaking | GET /pets | query parameter limit | Became required.",
        "breaking | GET /pets | query parameter limit | maximum changed from 100 to 50.",
        "risky | GET /pets | query parameter tag | Parameter removed; callers that send it are ignored or rejected.",
        "safe | GET /pets | query parameter sort | New optional parameter.",
        "risky | GET /pets | operationId | operationId changed from listPets to findPets; generated clients rename the method.",
        "breaking | GET /pets | 200 response: [].id | Type changed from integer to string.",
        "breaking | GET /pets | 200 response: [].name | Property removed from the response.",
        "risky | GET /pets | 200 response: [].status | New value \"pending\" may be returned; clients with exhaustive handling may break.",
        "safe | GET /pets | 200 response: [].age | New property in the response.",
        "breaking | POST /pets | request body | Request body became required.",
        "breaking | POST /pets | request body: species | New required property; existing callers do not send it.",
        "breaking | POST /pets | request body: name | maxLength changed from 100 to 50.",
        "risky | POST /pets | request body: nickname | Property removed; callers that send it are ignored or rejected.",
        "risky | GET /pets/{petId} | 404 response | 404 response removed.",
        "safe | GET /stores |  | New operation.",
        "risky | (spec) | servers | Servers changed from https://api.example.com/v1 to https://api.example.com/v2.",
      ]),
    );
    // The renamed path parameter is the same route, and the self-reference does not loop.
    expect(changes.some((c) => c.includes("GET /pets/{petId} |  | Operation removed"))).toBe(false);
    expect(changes.filter((c) => c.includes("owner")).every((c) => !c.includes("owner.owner.owner"))).toBe(true);
    // Breaking first.
    expect(changes[0].startsWith("breaking")).toBe(true);
    expect(changes[changes.length - 1].startsWith("safe")).toBe(true);
  });

  it("judges directions differently", () => {
    const spec = (reqType: string, resRequired: string[]) => ({
      openapi: "3.1.0",
      paths: {
        "/x": {
          put: {
            requestBody: { content: { "application/json": { schema: { type: "object", properties: { n: { type: reqType } } } } } },
            responses: { "200": { content: { "application/json": { schema: { type: "object", required: resRequired, properties: { a: { type: "string" } } } } } } },
          },
        },
      },
    });
    const d = diffSpecs(spec("integer", ["a"]), spec("number", [])).map(line);
    expect(d).toContain("safe | PUT /x | request body: n | Type changed from integer to number.");
    expect(d).toContain("breaking | PUT /x | 200 response: a | No longer always returned; clients that rely on it may break.");
  });

  it("handles Swagger 2.0 body parameters and security", () => {
    const s = (sec: unknown[], required: boolean) => ({
      swagger: "2.0",
      basePath: "/api",
      security: sec,
      paths: { "/u": { post: { parameters: [{ in: "body", name: "b", required, schema: { $ref: "#/definitions/U" } }, { in: "header", name: "X-Id", type: "string" }], responses: { "200": { schema: { $ref: "#/definitions/U" } } } } } },
      definitions: { U: { type: "object", properties: { id: { type: "integer" } } } },
    });
    const d = diffSpecs(s([], false), s([{ key: [] }], true)).map(line);
    expect(d).toContain('breaking | POST /u | security | Authentication requirements changed to [{"key":[]}].');
    expect(d).toContain("breaking | POST /u | request body | Request body became required.");
    expect(() => diffSpecs({}, s([], false))).toThrow(/earlier version/);
  });

  it("writes release notes", () => {
    const md = toMarkdown(diffSpecs(parseYaml(v1), parseYaml(v2)), "since v1");
    expect(md).toMatch(/^## API changes since v1\n\n\d+ breaking, \d+ to check, \d+ compatible\./);
    expect(md).toContain("### Breaking");
    expect(md).toContain("- `GET /pets` query parameter limit: Became required.");
  });
});
