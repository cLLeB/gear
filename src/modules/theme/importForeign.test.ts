import { describe, expect, it } from "vitest";
import { detectFormat, importForeignThemes, normalizeColor, parseForeignSchemes } from "./importForeign";
import { auditVariant, contrastRatio, mix } from "./contrast";

const ANSI_HEX = Array.from({ length: 16 }, (_, i) => `#${(i * 16 + 15).toString(16).padStart(2, "0").repeat(3)}`);

describe("normalizeColor", () => {
  it("accepts the common spellings", () => {
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor("0x1d1f21")).toBe("#1d1f21");
    expect(normalizeColor("'#1d1f21'")).toBe("#1d1f21");
    expect(normalizeColor("1d1f21")).toBe("#1d1f21");
    expect(normalizeColor("#1d1f21ff")).toBe("#1d1f21");
    expect(normalizeColor("rgb:ff/80/00")).toBe("#ff8000");
    expect(normalizeColor("rgb:ffff/0000/0000")).toBe("#ff0000");
    expect(normalizeColor("red")).toBeNull();
  });
});

describe("parseForeignSchemes", () => {
  it("reads iTerm2 .itermcolors", () => {
    const entry = (key: string, r: number, g: number, b: number) =>
      `<key>${key}</key><dict><key>Blue Component</key><real>${b}</real><key>Green Component</key><real>${g}</real><key>Red Component</key><real>${r}</real></dict>`;
    const body = [
      ...Array.from({ length: 16 }, (_, i) => entry(`Ansi ${i} Color`, i / 15, 0, 0)),
      entry("Background Color", 0, 0, 0),
      entry("Foreground Color", 1, 1, 1),
    ].join("\n");
    const [s] = parseForeignSchemes("Solar Thing.itermcolors", `<plist><dict>${body}</dict></plist>`);
    expect(s.name).toBe("Solar Thing");
    expect(s.background).toBe("#000000");
    expect(s.foreground).toBe("#ffffff");
    expect(s.ansi[15]).toBe("#ff0000");
  });

  it("reads a Windows Terminal scheme and a settings.json with several", () => {
    const names = ["black", "red", "green", "yellow", "blue", "purple", "cyan", "white"];
    const scheme: Record<string, string> = { name: "Campbell", background: "#0C0C0C", foreground: "#CCCCCC" };
    names.forEach((n, i) => {
      scheme[n] = ANSI_HEX[i];
      scheme[`bright${n[0].toUpperCase()}${n.slice(1)}`] = ANSI_HEX[i + 8];
    });
    expect(detectFormat("x.json", JSON.stringify(scheme))).toBe("windows-terminal");
    const [s] = parseForeignSchemes("x.json", JSON.stringify(scheme));
    expect(s.name).toBe("Campbell");
    expect(s.ansi).toEqual(ANSI_HEX);
    const many = parseForeignSchemes("settings.json", JSON.stringify({ schemes: [scheme, { ...scheme, name: "Two" }], brightBlack: 1 }));
    expect(many.map((m) => m.name)).toEqual(["Campbell", "Two"]);
  });

  it("reads Alacritty TOML and legacy YAML", () => {
    const toml = `[colors.primary]\nbackground = '#1d1f21'\nforeground = '#c5c8c6'\n\n[colors.normal]\n${["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"].map((n, i) => `${n} = '${ANSI_HEX[i]}'`).join("\n")}\n`;
    const [t] = parseForeignSchemes("tomorrow.toml", toml);
    expect(t.background).toBe("#1d1f21");
    expect(t.ansi[9]).toBe(ANSI_HEX[1]); // brights fall back to normals
    const yaml = `colors:\n  primary:\n    background: '0x002b36'\n    foreground: '0x839496'\n  normal:\n${["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"].map((n, i) => `    ${n}: '${ANSI_HEX[i].replace("#", "0x")}'`).join("\n")}\n`;
    expect(detectFormat("x.yml", yaml)).toBe("alacritty");
    const [y] = parseForeignSchemes("x.yml", yaml);
    expect(y.background).toBe("#002b36");
    expect(y.ansi[4]).toBe(ANSI_HEX[4]);
  });

  it("reads Kitty, Ghostty and Xresources", () => {
    const kitty = `background #111111\nforeground #eeeeee\n${ANSI_HEX.map((c, i) => `color${i} ${c}`).join("\n")}`;
    expect(detectFormat("k.conf", kitty)).toBe("kitty");
    expect(parseForeignSchemes("k.conf", kitty)[0].background).toBe("#111111");

    const ghostty = `background = 282c34\nforeground = abb2bf\n${ANSI_HEX.map((c, i) => `palette = ${i}=${c}`).join("\n")}`;
    expect(detectFormat("g", ghostty)).toBe("ghostty");
    const g = parseForeignSchemes("g", ghostty)[0];
    expect(g.background).toBe("#282c34");
    expect(g.ansi[3]).toBe(ANSI_HEX[3]);

    const xres = `#define bg #101010\n*.background: bg\n*.foreground: #f0f0f0\n${ANSI_HEX.map((c, i) => `*.color${i}: ${c}`).join("\n")}`;
    expect(detectFormat(".Xresources", xres)).toBe("xresources");
    expect(parseForeignSchemes(".Xresources", xres)[0].background).toBe("#101010");
  });

  it("maps base16 slots to ANSI colours", () => {
    const yaml = `scheme: "Ocean"\nauthor: "x"\n${Array.from({ length: 16 }, (_, i) => `base0${i.toString(16).toUpperCase()}: "${ANSI_HEX[i].slice(1)}"`).join("\n")}`;
    const [s] = parseForeignSchemes("ocean.yaml", yaml);
    expect(s.name).toBe("Ocean");
    expect(s.background).toBe(ANSI_HEX[0]);
    expect(s.foreground).toBe(ANSI_HEX[5]);
    expect(s.ansi[1]).toBe(ANSI_HEX[8]);
    expect(s.ansi[4]).toBe(ANSI_HEX[13]);
  });

  it("reads VS Code theme terminal colours", () => {
    const names = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
    const colors: Record<string, string> = { "editor.background": "#1e1e1e", "editor.foreground": "#d4d4d4" };
    names.forEach((n, i) => {
      colors[`terminal.ansi${n}`] = ANSI_HEX[i];
      colors[`terminal.ansiBright${n}`] = ANSI_HEX[i + 8];
    });
    const [s] = parseForeignSchemes("dark.json", JSON.stringify({ name: "Dark+", colors }));
    expect(s.name).toBe("Dark+");
    expect(s.background).toBe("#1e1e1e");
  });

  it("rejects unknown content", () => {
    expect(() => parseForeignSchemes("x.txt", "hello world")).toThrow();
  });
});

describe("importForeignThemes", () => {
  it("builds a full theme with readable derived colours", () => {
    const kitty = `background #1a1b26\nforeground #c0caf5\n${["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6", "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"].map((c, i) => `color${i} ${c}`).join("\n")}`;
    const [theme] = importForeignThemes("tokyonight.conf", kitty);
    expect(theme.name).toBe("tokyonight");
    const v = theme.variants.dark!;
    expect(v.terminal?.ansi?.length).toBe(16);
    expect(v.colors?.background).toBe("#1a1b26");
    expect(auditVariant(v).filter((i) => i.minimum === 4.5)).toEqual([]);
  });
});

describe("contrast", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("flags unreadable pairs and skips the blending ANSI colour", () => {
    const issues = auditVariant({
      colors: { foreground: "#444444", background: "#333333" },
      terminal: { background: "#000000", foreground: "#ffffff", ansi: Array(16).fill("#050505") as never },
    });
    expect(issues.map((i) => i.pair)).toContain("Text on background");
    expect(issues.some((i) => i.pair === "Terminal black")).toBe(false);
    expect(issues.some((i) => i.pair === "Terminal red")).toBe(true);
  });
});
