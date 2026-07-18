import { describe, expect, it } from "vitest";
import { TextOperation, transform } from "./ot";

const converges = (doc: string, a: TextOperation, b: TextOperation): boolean => {
  const [aPrime, bPrime] = transform(a, b);
  return a.apply(doc).length >= 0 && bPrime.apply(a.apply(doc)) === aPrime.apply(b.apply(doc));
};

describe("TextOperation.apply", () => {
  it("retains, inserts and deletes", () => {
    const op = new TextOperation().retain(5).insert(",").retain(6); // "hello world" -> "hello, world"
    expect(op.apply("hello world")).toBe("hello, world");
  });

  it("deletes characters", () => {
    const op = new TextOperation().delete(6).retain(5); // remove "hello "
    expect(op.apply("hello world")).toBe("world");
  });

  it("throws when the base length does not match", () => {
    expect(() => new TextOperation().retain(3).apply("hello")).toThrow();
  });
});

describe("transform convergence", () => {
  it("converges for two concurrent inserts", () => {
    const doc = "abc";
    const a = new TextOperation().insert("X").retain(3); // "Xabc"
    const b = new TextOperation().retain(1).insert("Y").retain(2); // "aYbc"
    expect(converges(doc, a, b)).toBe(true);
  });

  it("converges for concurrent insert and delete", () => {
    const doc = "hello world";
    const a = new TextOperation().retain(5).insert("!!").retain(6); // insert after hello
    const b = new TextOperation().delete(6).retain(5); // delete "hello "
    expect(converges(doc, a, b)).toBe(true);
  });

  it("converges for overlapping deletes", () => {
    const doc = "abcdefgh";
    const a = new TextOperation().retain(2).delete(3).retain(3); // remove cde
    const b = new TextOperation().retain(3).delete(3).retain(2); // remove def
    expect(converges(doc, a, b)).toBe(true);
  });

  it("produces the same convergent document for a mixed edit", () => {
    const doc = "the quick brown fox";
    const a = new TextOperation().retain(4).insert("very ").retain(15); // "the very quick brown fox"
    const b = new TextOperation().retain(10).delete(6).retain(3); // remove "brown "
    const [aPrime, bPrime] = transform(a, b);
    const viaA = bPrime.apply(a.apply(doc));
    const viaB = aPrime.apply(b.apply(doc));
    expect(viaA).toBe(viaB);
    expect(viaA).toBe("the very quick fox");
  });
});
