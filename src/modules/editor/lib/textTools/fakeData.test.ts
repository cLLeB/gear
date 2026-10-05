import { describe, expect, it } from "vitest";
import { email, FAKE_KINDS, luhnComplete, loremSentence } from "./fakeData";

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe("fake data", () => {
  it("is deterministic with a seeded rng", () => {
    expect(FAKE_KINDS.name.gen(seeded(1))).toBe(FAKE_KINDS.name.gen(seeded(1)));
  });

  it("builds plausible values", () => {
    const r = seeded(42);
    expect(email(r, "José García")).toMatch(/^jose\.garcia@example\.(com|org|net)$|^jose\.garcia@test\.dev$/);
    expect(FAKE_KINDS.ipv4.gen(r)).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/);
    expect(FAKE_KINDS.color.gen(r)).toMatch(/^#[0-9a-f]{6}$/);
    expect(FAKE_KINDS.date.gen(r)).toMatch(/^20\d\d-\d\d-\d\d$/);
    expect(loremSentence(r, 3)).toMatch(/^[A-Z][a-z]+ [a-z]+ [a-z]+\.$/);
  });

  it("produces Luhn-valid card numbers", () => {
    expect(luhnComplete("424242424242424")).toBe("4242424242424242");
    const card = FAKE_KINDS.card.gen(seeded(7));
    expect(card).toHaveLength(16);
    const sum = [...card].reverse().reduce((s, c, i) => {
      let d = Number(c);
      if (i % 2) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      return s + d;
    }, 0);
    expect(sum % 10).toBe(0);
  });
});
