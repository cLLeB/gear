import { describe, expect, it } from "vitest";
import { isValid, validate, type Schema } from "./jsonSchema";

describe("validate / types and constraints", () => {
  it("checks primitive types", () => {
    expect(isValid({ type: "string" }, "hi")).toBe(true);
    expect(isValid({ type: "integer" }, 3)).toBe(true);
    expect(isValid({ type: "integer" }, 3.5)).toBe(false);
    expect(validate({ type: "number" }, "x")[0].keyword).toBe("type");
  });

  it("enforces numeric bounds and multipleOf", () => {
    const schema: Schema = { type: "integer", minimum: 1, maximum: 65535, multipleOf: 1 };
    expect(isValid(schema, 8080)).toBe(true);
    expect(validate(schema, 0)[0].keyword).toBe("minimum");
    expect(validate(schema, 70000)[0].keyword).toBe("maximum");
  });

  it("enforces string length, pattern and format", () => {
    expect(isValid({ type: "string", minLength: 2, maxLength: 4 }, "abc")).toBe(true);
    expect(validate({ type: "string", minLength: 2 }, "a")[0].keyword).toBe("minLength");
    expect(validate({ type: "string", pattern: "^[a-z]+$" }, "ABC")[0].keyword).toBe("pattern");
    expect(isValid({ type: "string", format: "email" }, "a@b.com")).toBe(true);
    expect(isValid({ type: "string", format: "email" }, "nope")).toBe(false);
  });
});

describe("validate / objects", () => {
  const schema: Schema = {
    type: "object",
    required: ["name", "port"],
    properties: {
      name: { type: "string" },
      port: { type: "integer", minimum: 1 },
    },
    additionalProperties: false,
  };

  it("accepts a valid object", () => {
    expect(isValid(schema, { name: "web", port: 80 })).toBe(true);
  });

  it("reports missing required properties with a path", () => {
    const errors = validate(schema, { name: "web" });
    expect(errors[0].keyword).toBe("required");
  });

  it("reports nested errors with a JSON pointer path", () => {
    const errors = validate(schema, { name: "web", port: 0 });
    expect(errors[0].path).toBe("/port");
    expect(errors[0].keyword).toBe("minimum");
  });

  it("rejects additional properties when disallowed", () => {
    const errors = validate(schema, { name: "web", port: 80, extra: 1 });
    expect(errors[0].keyword).toBe("additionalProperties");
    expect(errors[0].path).toBe("/extra");
  });
});

describe("validate / arrays", () => {
  it("validates items, length and uniqueness", () => {
    const schema: Schema = { type: "array", items: { type: "number" }, minItems: 1, uniqueItems: true };
    expect(isValid(schema, [1, 2, 3])).toBe(true);
    expect(validate(schema, [])[0].keyword).toBe("minItems");
    expect(validate(schema, [1, 1])[0].keyword).toBe("uniqueItems");
    expect(validate(schema, [1, "x"])[0].path).toBe("/1");
  });
});

describe("validate / combinators and $ref", () => {
  it("handles anyOf", () => {
    const schema: Schema = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(isValid(schema, "x")).toBe(true);
    expect(isValid(schema, 5)).toBe(true);
    expect(isValid(schema, true)).toBe(false);
  });

  it("handles oneOf (exactly one)", () => {
    const schema: Schema = { oneOf: [{ type: "integer" }, { type: "number", minimum: 0 }] };
    // 3 is both integer AND a number >= 0 -> matches two -> invalid.
    expect(isValid(schema, 3)).toBe(false);
    // -2 is an integer but not >= 0 -> matches exactly one.
    expect(isValid(schema, -2)).toBe(true);
  });

  it("resolves local $ref", () => {
    const schema: Schema = {
      definitions: { positiveInt: { type: "integer", minimum: 1 } },
      type: "object",
      properties: { count: { $ref: "#/definitions/positiveInt" } },
    };
    expect(isValid(schema, { count: 5 })).toBe(true);
    expect(validate(schema, { count: 0 })[0].keyword).toBe("minimum");
  });
});
