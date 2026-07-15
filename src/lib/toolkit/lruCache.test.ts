import { describe, expect, it } from "vitest";
import { LRUCache } from "./lruCache";

describe("LRUCache", () => {
  it("stores and retrieves", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
  });

  it("evicts the least recently used", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1).set("b", 2);
    c.get("a"); // refresh a
    c.set("c", 3); // evicts b
    expect(c.has("b")).toBe(false);
    expect(c.has("a")).toBe(true);
    expect(c.has("c")).toBe(true);
  });

  it("overwrites and refreshes recency", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1).set("b", 2).set("a", 9).set("c", 3);
    expect(c.get("a")).toBe(9);
    expect(c.has("b")).toBe(false);
  });

  it("rejects invalid capacity", () => {
    expect(() => new LRUCache(0)).toThrow();
  });
});
