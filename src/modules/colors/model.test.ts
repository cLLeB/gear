import { describe, expect, it } from "vitest";
import { apca, apcaUse, collectColors, deltaE, exportScale, findColors, fixContrast, format, gamutMap, harmony, nameOf, parseColor, rgbToOklch, scale, simulate, toHex, wcagGrades, wcagRatio, type Rgb } from "./model";

const c = (s: string) => {
  const v = parseColor(s);
  if (!v) throw new Error(`unparsed ${s}`);
  return v;
};

describe("color workbench", () => {
  it("reads every CSS notation", () => {
    for (const s of ["#3b82f6", "#3B82F6FF", "3b82f6", "rgb(59 130 246)", "rgb(59, 130, 246)", "rgba(59,130,246,1)", "rgb(23.1% 51% 96.5%)", "hsl(217.2 91.2% 59.8%)", "hsl(217.2, 91.2%, 59.8%)", "hwb(217.2 23.1% 3.5%)", "oklch(62.31% 0.188 259.81)", "oklab(0.6231 -0.0335 -0.185)"]) {
      expect(toHex(c(s)), s).toMatch(/^#3[ab]8[12]f[56]$/);
    }
    expect(toHex(c("#abc"))).toBe("#aabbcc");
    expect(toHex(c("rebeccapurple"))).toBe("#663399");
    expect(c("transparent").alpha).toBe(0);
    expect(c("rgb(0 0 0 / 50%)").alpha).toBe(0.5);
    expect(c("hsl(0.5turn 100% 50%)")).toMatchObject({ r: 0, g: 1, b: 1 });
    expect(toHex(c("#ff000080"))).toBe("#ff000080");
    for (const bad of ["", "#12", "rgb(1 2)", "nope", "hsl(a b c)", "123", "rgb(1 2 3 / 4 / 5)"]) expect(parseColor(bad), bad).toBeNull();
  });

  it("writes every notation and finds names", () => {
    const blue = c("#3b82f6");
    expect(format(blue, "rgb")).toBe("rgb(59 130 246)");
    expect(format(blue, "hsl")).toBe("hsl(217.2 91.2% 59.8%)");
    expect(format(blue, "oklch")).toMatch(/^oklch\(62\.\d+% 0\.18\d+ 259\.\d+\)$/);
    expect(format({ ...blue, alpha: 0.5 }, "rgb")).toBe("rgb(59 130 246 / 0.5)");
    expect(format({ ...blue, alpha: 0.5 }, "hex")).toBe("#3b82f680");
    // Every format reads back to the same colour.
    for (const f of ["hex", "rgb", "hsl", "hwb", "oklch", "oklab"] as const) expect(toHex(c(format(blue, f))), f).toBe("#3b82f6");
    expect(nameOf(c("#ff6347"))).toBe("tomato");
    expect(nameOf(blue)).toBeNull();
  });

  it("keeps out-of-gamut OKLCH inside sRGB", () => {
    const vivid = gamutMap({ l: 0.7, c: 0.4, h: 150 });
    expect([vivid.r, vivid.g, vivid.b].every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.abs(rgbToOklch(vivid).l - 0.7)).toBeLessThan(0.01);
    expect(Math.abs(rgbToOklch(vivid).h - 150)).toBeLessThan(2);
  });

  it("checks contrast with WCAG 2 and APCA", () => {
    const black = c("#000");
    const white = c("#fff");
    expect(wcagRatio(black, white)).toBeCloseTo(21, 5);
    expect(wcagRatio(c("#777"), white)).toBeCloseTo(4.48, 2);
    expect(wcagGrades(4.48)).toMatchObject({ aaNormal: false, aaLarge: true, aaaNormal: false });
    // Half-transparent black over white is mid grey.
    expect(wcagRatio(c("rgb(0 0 0 / 0.5)"), white)).toBeCloseTo(wcagRatio(c("#808080"), white), 1);
    expect(apca(black, white)).toBeCloseTo(106.04, 1);
    expect(apca(white, black)).toBeCloseTo(-107.88, 1);
    expect(apca(c("#888"), c("#fff"))).toBeCloseTo(63.06, 0);
    expect(apca(white, white)).toBe(0);
    expect(apcaUse(-80)).toMatch(/Body text/);
    expect(apcaUse(10)).toBe("Not readable");
  });

  it("finds the nearest colour that passes", () => {
    const white = c("#fff");
    const fixed = fixContrast(c("#60a5fa"), white, 4.5);
    expect(fixed).not.toBeNull();
    expect(wcagRatio(fixed as Rgb, white)).toBeGreaterThanOrEqual(4.5);
    expect(wcagRatio(fixed as Rgb, white)).toBeLessThan(5.2);
    expect(Math.abs(rgbToOklch(fixed as Rgb).h - rgbToOklch(c("#60a5fa")).h)).toBeLessThan(3);
    const onDark = fixContrast(c("#1e3a8a"), c("#000"), 4.5);
    expect(wcagRatio(onDark as Rgb, c("#000"))).toBeGreaterThanOrEqual(4.5);
  });

  it("builds a 50–950 scale around the colour", () => {
    const s = scale(c("#3b82f6"));
    expect(s.map((x) => x.step)).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
    expect(s.filter((x) => x.isBase)).toHaveLength(1);
    expect(toHex(s.find((x) => x.isBase)?.color as Rgb)).toBe("#3b82f6");
    const ls = s.map((x) => rgbToOklch(x.color).l);
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1]);
    // Hue stays put.
    for (const x of s.slice(1, -1)) expect(Math.abs(rgbToOklch(x.color).h - 259.8)).toBeLessThan(6);
    // A grey makes a grey scale.
    expect(scale(c("#777")).every((x) => rgbToOklch(x.color).c < 0.01)).toBe(true);
  });

  it("makes harmonies and simulates colour vision", () => {
    expect(harmony(c("#3b82f6"), "triadic")).toHaveLength(3);
    const comp = harmony(c("#3b82f6"), "complementary")[1];
    expect(Math.abs(rgbToOklch(comp).h - ((259.8 + 180) % 360))).toBeLessThan(3);
    // Red and green look alike to someone with deuteranopia.
    const red = c("#d33");
    const green = c("#3a3");
    expect(deltaE(simulate(red, "deuteranopia"), simulate(green, "deuteranopia"))).toBeLessThan(deltaE(red, green) / 2);
    const grey = simulate(c("#3b82f6"), "achromatopsia");
    expect(grey.r).toBeCloseTo(grey.b, 6);
    expect(simulate(red, "normal")).toBe(red);
  });

  it("exports a scale", () => {
    const steps = [
      { step: 50, color: c("#eff6ff") },
      { step: 500, color: c("#3b82f6") },
    ];
    expect(exportScale("Brand Blue", steps, "css")).toBe(":root {\n  --brand-blue-50: #eff6ff;\n  --brand-blue-500: #3b82f6;\n}");
    expect(exportScale("x", steps, "tailwind")).toContain("--color-x-500: #3b82f6;");
    expect(exportScale("x", steps, "scss")).toBe("$x-50: #eff6ff;\n$x-500: #3b82f6;");
    expect(JSON.parse(exportScale("", steps, "json"))).toEqual({ brand: { "50": "#eff6ff", "500": "#3b82f6" } });
    expect(exportScale("x", steps, "css", "rgb")).toContain("rgb(59 130 246)");
  });

  it("finds colours written in code, but not anchors or issue numbers", () => {
    const found = findColors(".a { color: #fff; background: rgb(0 0 0 / .5) }\nconst x = 'oklch(70% 0.1 200)'; // see issue #123 and /page#abc\n<a href=\"#top\">&#123;</a> border: 1px solid #ABCDEF;");
    expect(found.map((f) => [f.text, f.line, f.column])).toEqual([
      ["#fff", 1, 13],
      ["rgb(0 0 0 / .5)", 1, 31],
      ["oklch(70% 0.1 200)", 2, 12],
      ["#ABCDEF", 3, 45],
    ]);
  });

  it("counts colours across files and groups near-duplicates", () => {
    const { colors, groups } = collectColors([
      { path: "a.css", text: "a{color:#3b82f6} b{color:#3B82F6} c{color:#3b83f6}" },
      { path: "b.tsx", text: "const c = 'rgb(59 130 246)'; const d = '#ef4444';" },
    ]);
    expect(colors[0]).toMatchObject({ hex: "#3b82f6", count: 3, spellings: ["#3b82f6", "#3B82F6", "rgb(59 130 246)"] });
    expect(colors[0].places.map((p) => p.file)).toEqual(["a.css", "a.css", "b.tsx"]);
    expect(colors).toHaveLength(3);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((g) => g.hex)).toEqual(["#3b82f6", "#3b83f6"]);
  });
});
