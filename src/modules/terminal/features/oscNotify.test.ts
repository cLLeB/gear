import { describe, expect, it } from "vitest";
import { createThrottle, Osc99Assembler, parseOsc777, parseOsc9 } from "./oscNotify";

describe("parseOsc9", () => {
  it("reads plain notifications and ignores ConEmu subcommands", () => {
    expect(parseOsc9("Build finished")).toEqual({ title: null, body: "Build finished" });
    expect(parseOsc9("4;1;50")).toBeNull();
    expect(parseOsc9("9;C:\\dir")).toBeNull();
    expect(parseOsc9("  ")).toBeNull();
  });
});

describe("parseOsc777", () => {
  it("reads title and body, skipping Gear agent markers", () => {
    expect(parseOsc777("notify;Tests;All 120 passed")).toEqual({ title: "Tests", body: "All 120 passed" });
    expect(parseOsc777("notify;Only a title")).toEqual({ title: null, body: "Only a title" });
    expect(parseOsc777("notify;Gear;codex;attention")).toBeNull();
    expect(parseOsc777("preexec")).toBeNull();
  });
});

describe("Osc99Assembler", () => {
  it("assembles chunked title and body", () => {
    const a = new Osc99Assembler();
    expect(a.push("i=1:d=0;Hello ")).toBeNull();
    expect(a.push("i=1:d=0:p=body;from ")).toBeNull();
    expect(a.push("i=1:p=body;kitty")).toEqual({ title: "Hello ", body: "from kitty" });
  });

  it("decodes base64 payloads and ignores other payload types", () => {
    const a = new Osc99Assembler();
    expect(a.push(`e=1;${btoa("Done")}`)).toEqual({ title: null, body: "Done" });
    expect(a.push("p=icon;abc")).toBeNull();
  });
});

describe("createThrottle", () => {
  it("allows one event per interval per key", () => {
    const t = createThrottle(1000);
    expect(t("a", 0)).toBe(true);
    expect(t("a", 500)).toBe(false);
    expect(t("b", 500)).toBe(true);
    expect(t("a", 1500)).toBe(true);
  });
});
