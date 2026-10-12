import { describe, expect, it } from "vitest";
import { compare, countProblems, coverage, deleteKey, detectFormat, filterRows, findLocaleSets, flatten, isFlat, keyProblem, placeholders, serialize, setKey } from "./model";

describe("translation keys model", () => {
  it("finds sets of locale files in both layouts", () => {
    const sets = findLocaleSets(["src/locales/en.json", "src/locales/fr.json", "src/locales/pt-BR.json", "src\\locales\\notes.json", "public/i18n/en/common.json", "public/i18n/de/common.json", "public/i18n/en/errors.json", "package.json", "data/en.json", "node_modules/x/locales/en.json", "node_modules/x/locales/fr.json", "lang/en.json"]);
    expect(sets.map((s) => s.label)).toEqual(["public/i18n/*/common.json", "src/locales"]);
    expect(sets[1].files).toEqual({ en: "src/locales/en.json", fr: "src/locales/fr.json", "pt-BR": "src/locales/pt-BR.json" });
    expect(sets[0].files).toEqual({ en: "public/i18n/en/common.json", de: "public/i18n/de/common.json" });
  });

  it("flattens nested messages", () => {
    expect(flatten({ a: "x", b: { c: "y", d: { e: "z" } }, n: 3, list: ["p", "q"], empty: {}, nil: null })).toEqual({ a: "x", "b.c": "y", "b.d.e": "z", n: "3", list: '["p","q"]', empty: "{}", nil: "null" });
    expect(flatten({})).toEqual({});
    expect(isFlat({ "a.b": "x", c: "y" })).toBe(true);
    expect(isFlat({ a: { b: "x" } })).toBe(false);
    expect(isFlat({ a: "x" })).toBe(false);
  });

  it("sets and deletes keys without changing the input or the key order", () => {
    const root = { title: "T", menu: { open: "Open", close: "Close" } };
    const set = setKey(root, "menu.save.label", "Save");
    expect(set).toEqual({ title: "T", menu: { open: "Open", close: "Close", save: { label: "Save" } } });
    expect(Object.keys(setKey(root, "menu.open", "Ouvrir") as object)).toEqual(["title", "menu"]);
    expect(root.menu).toEqual({ open: "Open", close: "Close" });
    expect(deleteKey(set, "menu.save.label")).toEqual(root);
    expect(deleteKey(root, "menu.nope")).toEqual(root);
    expect(deleteKey(root, "title.deeper")).toEqual(root);
    // A flat file keeps dotted keys at the top level.
    expect(setKey({ "a.b": "x" }, "a.c", "y")).toEqual({ "a.b": "x", "a.c": "y" });
    expect(deleteKey({ "a.b": "x", "a.c": "y" }, "a.b")).toEqual({ "a.c": "y" });
    expect(setKey(null, "a", "x")).toEqual({ a: "x" });
  });

  it("writes files back in their own formatting", () => {
    const tabbed = '{\r\n\t"a": "x",\r\n\t"b": {\r\n\t\t"c": "y"\r\n\t}\r\n}\r\n';
    expect(serialize(JSON.parse(tabbed), detectFormat(tabbed))).toBe(tabbed);
    const four = '{\n    "a": "x"\n}';
    expect(serialize(JSON.parse(four), detectFormat(four))).toBe(four);
    expect(detectFormat("")).toEqual({ indent: "  ", eol: "\n", finalNewline: true });
  });

  it("extracts placeholders in every common syntax", () => {
    expect(placeholders("Hi {name}, you have {{ count }} new %s and %1$d · $t(common.ok) <0>bold</0>")).toEqual(["$t(common.ok)", "%1$d", "%s", "</0>", "<0>", "{name}", "{{count}}"]);
    expect(placeholders("{count, plural, one {# item} other {# items}}")).toContain("{count}");
    expect(placeholders("plain text")).toEqual([]);
  });

  const locales = {
    en: { title: "Welcome", hello: "Hello {name}", ok: "OK", count: "{n} items", onlyEn: "English only" },
    fr: { title: "Bienvenue", hello: "Bonjour {nom}", ok: "OK", count: "", extra: "En plus" },
    de: { title: "Welcome", hello: "Hallo {name}", ok: "OK", count: "{n} Elemente", onlyEn: "Nur Englisch" },
  };

  it("compares locales against a base", () => {
    const rows = compare(locales, "en");
    expect(rows.map((r) => r.key)).toEqual(["title", "hello", "ok", "count", "onlyEn", "extra"]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.problems]));
    expect(by.title).toEqual({ de: "same" });
    expect(by.hello).toEqual({ fr: "placeholders" });
    // "OK" has too few letters to call it untranslated.
    expect(by.ok).toEqual({});
    expect(by.count).toEqual({ fr: "empty" });
    expect(by.onlyEn).toEqual({ fr: "missing" });
    expect(by.extra).toEqual({ en: "missing", de: "missing" });
    expect(countProblems(rows, "fr")).toEqual({ missing: 1, empty: 1, same: 0, placeholders: 1 });
    expect(coverage(rows, "fr", "en")).toBe(60);
    expect(coverage(rows, "de", "en")).toBe(100);
    expect(coverage([], "de", "en")).toBe(100);
  });

  it("filters rows", () => {
    const rows = compare(locales, "en");
    expect(filterRows(rows, "problems", "").map((r) => r.key)).toEqual(["title", "hello", "count", "onlyEn", "extra"]);
    expect(filterRows(rows, "missing", "").map((r) => r.key)).toEqual(["onlyEn", "extra"]);
    expect(filterRows(rows, "all", "bonjour").map((r) => r.key)).toEqual(["hello"]);
    expect(filterRows(rows, "all", "ONLY").map((r) => r.key)).toEqual(["onlyEn"]);
  });

  it("validates new key names", () => {
    const existing = ["menu.open", "title"];
    expect(keyProblem("menu.close", existing)).toBeNull();
    expect(keyProblem("", existing)).toMatch(/Enter/);
    expect(keyProblem("a b", existing)).toMatch(/spaces/);
    expect(keyProblem(".a", existing)).toMatch(/dot/);
    expect(keyProblem("title", existing)).toMatch(/exists/);
    expect(keyProblem("menu", existing)).toMatch(/group/);
    expect(keyProblem("title.sub", existing)).toMatch(/already a key/);
  });
});
