import { describe, expect, it } from "vitest";
import { applyPatch, deepEqual, diff, encodePointerSegment, type Json } from "./jsonDiff";

const roundTrips = (a: Json, b: Json) => deepEqual(applyPatch(a, diff(a, b)), b);

describe("diff / object changes", () => {
  it("adds, removes, and replaces object keys", () => {
    const a = { keep: 1, drop: 2, change: 3 };
    const b = { keep: 1, change: 4, added: 5 };
    const ops = diff(a, b);
    expect(ops).toContainEqual({ op: "remove", path: "/drop" });
    expect(ops).toContainEqual({ op: "replace", path: "/change", value: 4 });
    expect(ops).toContainEqual({ op: "add", path: "/added", value: 5 });
    expect(roundTrips(a, b)).toBe(true);
  });

  it("diffs nested objects with pointer paths", () => {
    const a = { user: { name: "ann", age: 30 } };
    const b = { user: { name: "ann", age: 31 } };
    expect(diff(a, b)).toEqual([{ op: "replace", path: "/user/age", value: 31 }]);
    expect(roundTrips(a, b)).toBe(true);
  });
});

describe("diff / array changes", () => {
  it("handles a middle insertion without cascading", () => {
    const a = [1, 2, 4];
    const b = [1, 2, 3, 4];
    const ops = diff(a, b);
    expect(ops).toEqual([{ op: "add", path: "/2", value: 3 }]);
    expect(roundTrips(a, b)).toBe(true);
  });

  it("handles a middle removal", () => {
    const a = [1, 2, 3, 4];
    const b = [1, 2, 4];
    expect(roundTrips(a, b)).toBe(true);
  });

  it("round-trips arrays of objects with edits", () => {
    const a = [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 3, v: "c" }];
    const b = [{ id: 1, v: "a" }, { id: 3, v: "c" }, { id: 4, v: "d" }];
    expect(roundTrips(a, b)).toBe(true);
  });
});

describe("applyPatch immutability", () => {
  it("does not mutate the input document", () => {
    const a = { nested: { list: [1, 2] } };
    const frozen = JSON.stringify(a);
    applyPatch(a, diff(a, { nested: { list: [1, 2, 3] } }));
    expect(JSON.stringify(a)).toBe(frozen);
  });

  it("applies an explicit move operation", () => {
    const doc = { a: { x: 1 }, b: {} };
    const result = applyPatch(doc, [{ op: "move", from: "/a/x", path: "/b/y" }]);
    expect(result).toEqual({ a: {}, b: { y: 1 } });
  });
});

describe("JSON Pointer escaping", () => {
  it("escapes ~ and / in keys", () => {
    expect(encodePointerSegment("a/b")).toBe("a~1b");
    expect(encodePointerSegment("m~n")).toBe("m~0n");
    const a: Json = {};
    const b: Json = { "a/b": 1 };
    expect(roundTrips(a, b)).toBe(true);
  });
});

describe("prototype pollution defense", () => {
  it("does not pollute Object.prototype via a __proto__ pointer", () => {
    const polluted = {} as Record<string, unknown>;
    expect(polluted.isAdmin).toBeUndefined();
    // Attempt the canonical JSON-Patch pollution payload.
    try {
      applyPatch({}, [{ op: "add", path: "/__proto__/isAdmin", value: true }]);
    } catch {
      /* rejecting is an acceptable outcome; the invariant is no pollution */
    }
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("isAdmin");
  });

  it("does not pollute via a nested constructor/prototype pointer", () => {
    try {
      applyPatch({ a: {} }, [{ op: "add", path: "/a/constructor/prototype/x", value: 1 }]);
    } catch {
      /* ignore */
    }
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("treats __proto__ as an ordinary own data key, not the prototype", () => {
    const result = applyPatch({ a: {} }, [{ op: "add", path: "/a/__proto__", value: { safe: 1 } }]) as {
      a: Record<string, unknown>;
    };
    // It becomes an OWN property; the object's real prototype is unchanged.
    expect(Object.prototype.hasOwnProperty.call(result.a, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.a)).toBe(Object.prototype);
  });
});

describe("type changes", () => {
  it("replaces when the value type changes", () => {
    const a = { v: [1, 2] };
    const b = { v: "hello" };
    expect(diff(a, b)).toEqual([{ op: "replace", path: "/v", value: "hello" }]);
    expect(roundTrips(a, b)).toBe(true);
  });
});
