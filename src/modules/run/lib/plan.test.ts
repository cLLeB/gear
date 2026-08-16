import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import type { Tab, TerminalTab } from "@/modules/tabs";
import { planRunSubmission, planRunTarget, shellDialect } from "./plan";
import type { RunSpec } from "./types";

const SPEC: RunSpec = {
  configId: "python",
  source: "preset",
  label: "Python",
  command: "python /w/heart.py",
  cwd: "/w",
  env: {},
};

const terminal = (over: Partial<TerminalTab> & { id: number }): Tab =>
  ({
    kind: "terminal",
    title: "shell",
    spaceId: "s1",
    paneTree: { kind: "leaf", id: over.id * 100 },
    activeLeafId: over.id * 100,
    ...over,
  }) as Tab;

describe("planRunTarget", () => {
  const alloc = (start: number) => {
    let n = start;
    return () => n++;
  };

  it("creates a run terminal when the space has none", () => {
    const plan = planRunTarget([], "s1", alloc(1), SPEC);
    expect(plan.created).toBe(true);
    expect(plan.tabs).toHaveLength(1);
    const tab = plan.tabs[0] as TerminalTab;
    expect(tab.kind).toBe("terminal");
    expect(tab.run).toBe(true);
    expect(tab.cwd).toBe("/w");
    expect(tab.spaceId).toBe("s1");
    expect(plan.tabId).toBe(tab.id);
    expect(plan.leafId).toBe(tab.activeLeafId);
  });

  it("reuses the space's existing run terminal instead of stacking tabs", () => {
    const existing = terminal({ id: 7, run: true });
    const plan = planRunTarget([existing], "s1", alloc(100), SPEC);
    expect(plan.created).toBe(false);
    expect(plan.tabs).toEqual([existing]);
    expect(plan.tabId).toBe(7);
    expect(plan.leafId).toBe(700);
  });

  it("does not hijack an ordinary terminal the user is working in", () => {
    const plain = terminal({ id: 7 });
    const plan = planRunTarget([plain], "s1", alloc(100), SPEC);
    expect(plan.created).toBe(true);
    expect(plan.tabs).toHaveLength(2);
    expect(plan.tabId).not.toBe(7);
  });

  it("keeps run terminals separate per space", () => {
    const other = terminal({ id: 7, run: true, spaceId: "s2" });
    const plan = planRunTarget([other], "s1", alloc(100), SPEC);
    expect(plan.created).toBe(true);
    expect(plan.tabs).toHaveLength(2);
  });

  it("warms a restored-but-cold run terminal so its shell spawns", () => {
    const cold = terminal({ id: 7, run: true, cold: true });
    const plan = planRunTarget([cold], "s1", alloc(100), SPEC);
    expect(plan.created).toBe(false);
    expect((plan.tabs[0] as TerminalTab).cold).toBeUndefined();
  });

  it("reuses the first run terminal when duplicates somehow exist", () => {
    const a = terminal({ id: 7, run: true });
    const b = terminal({ id: 8, run: true });
    expect(planRunTarget([a, b], "s1", alloc(100), SPEC).tabId).toBe(7);
  });
});

describe("shellDialect", () => {
  it("recognises PowerShell under either executable name", () => {
    expect(shellDialect("powershell.exe")).toBe("powershell");
    expect(shellDialect("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
      "powershell",
    );
  });

  it("recognises cmd", () => {
    expect(shellDialect("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
  });

  it("treats unix shells and anything unknown as posix", () => {
    expect(shellDialect("/bin/bash")).toBe("posix");
    expect(shellDialect("/usr/bin/zsh")).toBe("posix");
    expect(shellDialect("")).toBe("posix");
    expect(shellDialect(null)).toBe("posix");
  });

  it("does not mistake a path containing 'cmd' for the cmd shell", () => {
    expect(shellDialect("/home/me/cmdtools/bash")).toBe("posix");
  });
});

describe("planRunSubmission", () => {
  it("submits only the command when the shell is already in the right place", () => {
    expect(planRunSubmission(SPEC, "/w", "posix")).toEqual([
      "python /w/heart.py",
    ]);
  });

  it("changes directory first when the shell sits elsewhere", () => {
    expect(planRunSubmission(SPEC, "/elsewhere", "posix")).toEqual([
      "cd /w",
      "python /w/heart.py",
    ]);
  });

  it("changes directory when the shell's location is unknown", () => {
    expect(planRunSubmission(SPEC, null, "posix")).toEqual([
      "cd /w",
      "python /w/heart.py",
    ]);
  });

  it("quotes a target directory containing spaces", () => {
    const spec = { ...SPEC, cwd: "/my code" };
    expect(planRunSubmission(spec, null, "posix")[0]).toBe("cd '/my code'");
  });

  it("treats a trailing slash as the same directory", () => {
    expect(planRunSubmission(SPEC, "/w/", "posix")).toEqual([
      "python /w/heart.py",
    ]);
  });

  it("compares directories across path separator styles", () => {
    const spec = { ...SPEC, cwd: "C:/w" };
    expect(planRunSubmission(spec, "C:\\w", "posix")).toEqual([
      "python /w/heart.py",
    ]);
  });

  describe("environment", () => {
    const withEnv = { ...SPEC, env: { PORT: "3000", MODE: "dev" } };

    it("exports each variable before the command on posix", () => {
      expect(planRunSubmission(withEnv, "/w", "posix")).toEqual([
        "export MODE='dev'",
        "export PORT='3000'",
        "python /w/heart.py",
      ]);
    });

    it("assigns into $env: on PowerShell", () => {
      expect(planRunSubmission(withEnv, "/w", "powershell")).toEqual([
        "$env:MODE = 'dev'",
        "$env:PORT = '3000'",
        "python /w/heart.py",
      ]);
    });

    it("uses set on cmd", () => {
      expect(planRunSubmission(withEnv, "/w", "cmd")).toEqual([
        "set MODE=dev",
        "set PORT=3000",
        "python /w/heart.py",
      ]);
    });

    it("emits variables in a stable order regardless of key order", () => {
      const a = planRunSubmission({ ...SPEC, env: { B: "1", A: "2" } }, "/w", "posix");
      const b = planRunSubmission({ ...SPEC, env: { A: "2", B: "1" } }, "/w", "posix");
      expect(a).toEqual(b);
    });

    it("escapes a quote inside a posix value", () => {
      const spec = { ...SPEC, env: { MSG: "it's here" } };
      expect(planRunSubmission(spec, "/w", "posix")[0]).toBe(
        `export MSG='it'\\''s here'`,
      );
    });

    it("doubles a quote inside a PowerShell value", () => {
      const spec = { ...SPEC, env: { MSG: "it's here" } };
      expect(planRunSubmission(spec, "/w", "powershell")[0]).toBe(
        "$env:MSG = 'it''s here'",
      );
    });

    it("puts the cd before the exports so relative values still apply", () => {
      expect(planRunSubmission(withEnv, "/elsewhere", "posix")[0]).toBe("cd /w");
    });

    it("skips env entirely when there is none", () => {
      expect(planRunSubmission(SPEC, "/w", "posix")).toHaveLength(1);
    });
  });
});
