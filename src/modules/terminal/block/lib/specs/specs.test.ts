import { describe, expect, it } from "vitest";
import { parseJustSummary, parseMakeTargets, parsePorcelain, parseScripts } from "./generators";
import { lastSegment, resolve, shellWords } from "./parse";
import { specFor } from "./specs";
import type { Resolution } from "./types";

function at(line: string): Resolution {
  const { words, trailing } = shellWords(lastSegment(line));
  const spec = specFor(words[0]);
  if (!spec) throw new Error(`no spec for ${words[0]}`);
  return resolve(spec, words, trailing);
}
const labels = (r: Resolution) => (r.kind === "items" ? r.items.map((i) => i.label) : []);
const argOf = (r: Resolution) => (r.kind === "items" ? r.arg : null);

describe("shellWords / lastSegment", () => {
  it("splits on spaces, keeps quoted text together and notes a trailing space", () => {
    expect(shellWords('git commit -m "two words" ')).toEqual({ words: ["git", "commit", "-m", "two words"], trailing: true });
    expect(shellWords("git che")).toEqual({ words: ["git", "che"], trailing: false });
  });

  it("completes the last command of a chain", () => {
    expect(lastSegment("cd app && npm run b")).toBe(" npm run b");
    expect(lastSegment('echo "a;b" ; git st')).toBe(" git st");
  });
});

describe("resolve", () => {
  it("offers subcommands by prefix", () => {
    expect(labels(at("git che"))).toEqual(["checkout", "cherry-pick"]);
    expect(labels(at("cargo cl"))).toEqual(["clippy", "clean"]);
  });

  it("offers options of the subcommand and its parents", () => {
    expect(labels(at("git commit --am"))).toEqual(["--amend"]);
    expect(labels(at("git log -"))).toContain("--oneline");
    expect(labels(at("git log -"))).toContain("-C");
  });

  it("points arguments at generators", () => {
    expect(argOf(at("git checkout "))?.generator).toBe("gitBranches");
    expect(argOf(at("npm run "))?.generator).toBe("npmScripts");
    expect(argOf(at("pnpm "))?.generator).toBe("npmScripts");
    expect(argOf(at("make "))?.generator).toBe("makeTargets");
    expect(argOf(at("docker compose logs -f "))?.generator).toBe("composeServices");
  });

  it("knows which option takes a value", () => {
    expect(argOf(at("git branch -D "))?.generator).toBe("gitLocalBranches");
    // After the value, back to positionals.
    expect(argOf(at("git commit -m msg "))).toBeNull();
    expect(argOf(at("git push origin "))?.generator).toBe("gitLocalBranches");
  });

  it("walks nested subcommands", () => {
    expect(labels(at("git stash p"))).toEqual(["push", "pop"]);
    expect(argOf(at("git stash pop "))?.generator).toBe("gitStashes");
    expect(labels(at("gh pr m"))).toEqual(["merge"]);
  });

  it("treats words after -- as plain arguments", () => {
    expect(labels(at("git log -- -"))).toEqual([]);
  });
});

describe("specFor", () => {
  it("accepts paths, Windows extensions and aliases", () => {
    expect(specFor("C:\\Program Files\\Git\\cmd\\git.exe")?.name).toContain("git");
    expect(specFor("npm.cmd")?.name).toContain("npm");
    expect(specFor("docker-compose")?.subcommands?.some((s) => s.name.includes("up"))).toBe(true);
    expect(specFor("unknown-tool")).toBeUndefined();
  });
});

describe("generator parsers", () => {
  it("reads package.json scripts", () => {
    expect(parseScripts('{"scripts":{"dev":"vite","test":"vitest"}}')).toEqual([
      { label: "dev", description: "vite" },
      { label: "test", description: "vitest" },
    ]);
    expect(parseScripts("not json")).toEqual([]);
  });

  it("reads Makefile targets with ## comments", () => {
    const mk = "CC := gcc\n## Build it\nbuild: main.o\n\tgcc\ntest: build ## Run tests\n.PHONY: build\n%.o: %.c\nbuild: extra\n";
    expect(parseMakeTargets(mk)).toEqual([
      { label: "build", description: "Build it" },
      { label: "test", description: "Run tests" },
    ]);
  });

  it("reads just recipes and git status paths", () => {
    expect(parseJustSummary("build test lint\n").map((v) => v.label)).toEqual(["build", "test", "lint"]);
    expect(parsePorcelain(" M src/a.ts\n?? new.txt\nR  old.ts -> renamed.ts\n")).toEqual([
      { label: "src/a.ts", description: "M" },
      { label: "new.txt", description: "??" },
      { label: "renamed.ts", description: "R" },
    ]);
  });
});
