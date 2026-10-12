import { describe as suite, expect, it } from "vitest";
import { compact, describe, describeStep, keyStep, parseCount, parseSaved, upsert, type KeyLike, type Step } from "./model";

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

suite("macro model", () => {
  it("records command keys but not plain typing or bare modifiers", () => {
    expect(keyStep(k("a"))).toBeNull();
    expect(keyStep(k("A", { shiftKey: true }))).toBeNull();
    expect(keyStep(k("Shift", { shiftKey: true }))).toBeNull();
    expect(keyStep(k("Enter"))).toMatchObject({ t: "key", key: "Enter" });
    expect(keyStep(k("ArrowDown", { shiftKey: true }))).toMatchObject({ key: "ArrowDown", shift: true });
    expect(keyStep(k("d", { ctrlKey: true }))).toMatchObject({ key: "d", ctrl: true });
    expect(keyStep(k("z", { metaKey: true }))).toMatchObject({ key: "z", meta: true });
    expect(keyStep(k("ArrowUp", { altKey: true }))).toMatchObject({ alt: true });
    // AltGr+Q types "@" on a German layout: text, not a command.
    expect(keyStep(k("@", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(keyStep(k("x", { altKey: true }))).toMatchObject({ key: "x", alt: true });
    expect(keyStep({ ...k("Enter"), isComposing: true })).toBeNull();
  });

  it("joins typed text and describes steps", () => {
    const steps: Step[] = [{ t: "text", text: "a" }, { t: "text", text: "b" }, keyStep(k("Enter")) as Step, { t: "text", text: "c" }];
    expect(compact(steps)).toHaveLength(3);
    expect(describe(steps)).toBe('"ab" ⏎ "c"');
    expect(describeStep(keyStep(k("d", { ctrlKey: true, shiftKey: true })) as Step)).toBe("Ctrl+Shift+D");
    expect(describeStep(keyStep(k("End")) as Step)).toBe("End");
    const long = describe([{ t: "text", text: "x".repeat(300) }], 40);
    expect(long.length).toBeLessThanOrEqual(42);
    expect(long).toContain(" … ");
  });

  it("stores macros defensively", () => {
    const good = { name: "A", steps: [{ t: "text", text: "x" }] };
    expect(parseSaved(JSON.stringify([good, { name: 1, steps: [] }, { name: "bad", steps: [{ t: "key" }] }]))).toEqual([good]);
    expect(parseSaved("{")).toEqual([]);
    expect(parseSaved(null)).toEqual([]);
    expect(upsert([{ name: "a", steps: [] }, { name: "b", steps: [] }], { name: "A", steps: [{ t: "text", text: "1" }] }).map((m) => m.name)).toEqual(["A", "b"]);
  });

  it("parses repeat counts", () => {
    expect(parseCount("5")).toBe(5);
    expect(parseCount(" x12 ")).toBe(12);
    expect(parseCount("3 times")).toBe(3);
    expect(parseCount("0")).toBeNull();
    expect(parseCount("20000")).toBeNull();
    expect(parseCount("many")).toBeNull();
  });
});
