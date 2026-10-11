import { describe, expect, it } from "vitest";
import type { PaneNode } from "../lib/panes";
import {
  activationCommands,
  commandAsMarkdown,
  OutputRing,
  parseKubeContexts,
  parsePods,
  parsePs,
  parseSchedule,
  parseTasklist,
  rotatePanes,
  searchRegex,
} from "./terminalExtras";

describe("OutputRing", () => {
  it("keeps the newest lines and searches newest first", () => {
    const r = new OutputRing(3);
    r.push(["a error", "", "b", "c ERROR", "d"]);
    expect(r.size).toBe(3);
    expect(r.search(searchRegex("error"))).toEqual([{ index: 2, text: "c ERROR" }]);
    expect(r.search(searchRegex("/^[bd]$/")).map((x) => x.text)).toEqual(["d", "b"]);
    expect(searchRegex("Err").flags).toBe("");
  });
});

describe("rotatePanes", () => {
  it("moves leaves one slot along", () => {
    const tree: PaneNode = { kind: "split", id: 9, dir: "row", children: [{ kind: "leaf", id: 1 }, { kind: "split", id: 8, dir: "col", children: [{ kind: "leaf", id: 2 }, { kind: "leaf", id: 3 }] }] };
    const ids = (n: PaneNode): number[] => (n.kind === "leaf" ? [n.id] : n.children.flatMap(ids));
    expect(ids(rotatePanes(tree))).toEqual([3, 1, 2]);
    expect(ids(rotatePanes(tree, -1))).toEqual([2, 3, 1]);
  });
});

describe("parsers", () => {
  it("reads kubectl contexts and pods", () => {
    const ctx = "CURRENT   NAME        CLUSTER     AUTHINFO   NAMESPACE\n*         prod        prod-eks    admin      payments\n          kind-dev    kind-dev    kind-dev   \n";
    expect(parseKubeContexts(ctx)).toEqual([
      { current: true, name: "prod", cluster: "prod-eks", namespace: "payments" },
      { current: false, name: "kind-dev", cluster: "kind-dev", namespace: "default" },
    ]);
    expect(parsePods("api-7d9  1/1  Running  3 (2m ago)  4d\nweb-1  0/1  CrashLoopBackOff  12  1h")).toEqual([
      { name: "api-7d9", ready: "1/1", status: "Running", restarts: "3 (2m ago)", age: "4d" },
      { name: "web-1", ready: "0/1", status: "CrashLoopBackOff", restarts: "12", age: "1h" },
    ]);
  });

  it("reads ps and tasklist", () => {
    const ps = parsePs("  10  0.0  2048 /usr/bin/bash bash\n 4242 87.5 512000 node node server.js\n");
    expect(ps[0]).toEqual({ pid: 4242, cpu: 87.5, memMb: 500, name: "node", command: "node server.js" });
    expect(parseTasklist('"chrome.exe","1234","Console","1","204,800 K"')[0]).toMatchObject({ pid: 1234, memMb: 200, name: "chrome.exe" });
  });
});

describe("parseSchedule", () => {
  const now = new Date(2024, 0, 1, 10, 0, 0);
  it("understands relative, absolute and repeating schedules", () => {
    expect(parseSchedule("in 1h30m", now)).toEqual({ kind: "once", at: now.getTime() + 5_400_000 });
    expect(parseSchedule("every 10m", now)).toEqual({ kind: "every", ms: 600_000 });
    expect(parseSchedule("at 9:30", now)).toEqual({ kind: "once", at: new Date(2024, 0, 2, 9, 30).getTime() });
    expect(parseSchedule("2pm", now)).toEqual({ kind: "once", at: new Date(2024, 0, 1, 14, 0).getTime() });
    expect(() => parseSchedule("every 1s", now)).toThrow();
    expect(() => parseSchedule("whenever", now)).toThrow();
  });
});

describe("activation and markdown", () => {
  it("builds activation commands per shell", () => {
    const e = { venvDirs: [".venv"], hasNvmrc: true, hasNodeVersion: false, hasToolVersions: false };
    expect(activationCommands(e, "posix")).toEqual(["source .venv/bin/activate", "nvm use || fnm use"]);
    expect(activationCommands(e, "powershell")).toEqual(["& ./.venv/Scripts/Activate.ps1", "fnm use"]);
  });

  it("formats a command and its output", () => {
    expect(commandAsMarkdown("ls", "a\nb\n", 1, "/tmp")).toBe("`/tmp`\n\n```console\n$ ls\na\nb\n```\n\n_✗ exit 1_\n");
  });
});
