import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterProcs, parseCwds, parseEtime, parseLsof, parseNetTcp, parsePs, parseSs, parseWinProcs, processTree } from "./model";

const fx = (f: string) => readFileSync(join(__dirname, "__fixtures__", f), "utf8");

describe("ports", () => {
  it("parses ss and lsof the same way", () => {
    const ss = parseSs(fx("ss.txt"));
    expect(ss.find((l) => l.port === 55432)).toEqual({ port: 55432, address: "127.0.0.1", pid: 3531, command: "postgres" });
    expect(ss.find((l) => l.port === 2024)).toEqual({ port: 2024, address: "0.0.0.0", pid: null, command: null });
    const lsof = parseLsof(fx("lsof.txt"));
    expect(lsof.find((l) => l.port === 18765)).toEqual({ port: 18765, address: "*", pid: 6041, command: "python3" });
    // Every port lsof sees, ss sees too with the same owner.
    for (const l of lsof) expect(ss.find((s) => s.port === l.port)?.pid).toBe(l.pid);
    expect(parseSs("LISTEN 0 511 [::]:3000 [::]:* users:((\"node\",pid=42,fd=20))\nLISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:((\"node\",pid=42,fd=19))")).toEqual([{ port: 3000, address: "::, 0.0.0.0", pid: 42, command: "node" }]);
  });

  it("parses Windows listeners", () => {
    const procs = parseWinProcs('[{"ProcessId":4242,"ParentProcessId":1,"Name":"node.exe","CommandLine":"node server.js","WorkingSetSize":52428800,"CreationDate":"2026-10-11T08:00:00Z","CPU":2}]', new Map(), Date.parse("2026-10-11T09:00:00Z"), 8, 16 * 1024 * 1024);
    expect(parseNetTcp('{"LocalAddress":"::","LocalPort":3000,"OwningProcess":4242}', procs)).toEqual([{ port: 3000, address: "::", pid: 4242, command: "node.exe" }]);
  });
});

describe("processes", () => {
  it("parses ps", () => {
    const ps = parsePs(fx("ps-linux.txt"));
    const pg = ps.find((p) => p.pid === 3531)!;
    expect(pg).toMatchObject({ ppid: 1, name: "postgres", user: "postgres", rssKb: 29760, elapsedSec: 9 * 60 + 13 });
    expect(pg.args).toMatch(/^\/usr\/lib\/postgresql\/16\/bin\/postgres -D/);
    expect(ps.find((p) => p.pid === 3532)!.args).toBe("postgres: checkpointer");
    expect(ps.find((p) => p.pid === 6012)!.cpu).toBe(25);
    expect(parseEtime("2-03:04:05")).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(parseEtime("01:02:03")).toBe(3723);
    // macOS: comm is a full path and args start the same way.
    expect(parsePs("  501     1   0.0  0.1  12345   01:02 me  /Applications/Visual Studio Code.app/Contents/MacOS/Electron  /Applications/Visual Studio Code.app/Contents/MacOS/Electron --type=gpu\n")[0]).toMatchObject({ pid: 501, name: "Electron", user: "me" });
  });

  it("builds a tree with subtree totals, collapse and filtering", () => {
    const ps = parsePs(fx("ps-linux.txt"));
    const rows = processTree(ps, "mem", new Set());
    const pg = rows.find((r) => r.proc.pid === 3531)!;
    expect(pg.children).toBe(5);
    expect(rows.filter((r) => r.proc.ppid === 3531).every((r) => r.depth === pg.depth + 1)).toBe(true);
    expect(pg.rssTotal).toBe(29760 + 10224 + 7580 + 10328 + 9028 + 8272);
    const collapsed = processTree(ps, "mem", new Set([3531]));
    expect(collapsed.some((r) => r.proc.ppid === 3531)).toBe(false);
    const f = filterProcs(ps, "checkpointer");
    expect(f.map((p) => p.pid).sort((a, b) => a - b)).toEqual([1, 3531, 3532]);
  });

  it("computes Windows CPU % between samples", () => {
    const prev = new Map<number, { cpu: number; at: number }>();
    const js = (cpu: number) => JSON.stringify([{ ProcessId: 7, ParentProcessId: 0, Name: "a.exe", CommandLine: null, WorkingSetSize: 1048576, CreationDate: null, CPU: cpu }]);
    parseWinProcs(js(10), prev, 1000, 4, 4096);
    // 2 CPU-seconds over 1 s on 4 cores = 50 %.
    expect(parseWinProcs(js(12), prev, 2000, 4, 4096)[0]).toMatchObject({ cpu: 50, rssKb: 1024, mem: 25 });
    expect(parseCwds("12 /home/me/app\n13 /\n").get(12)).toBe("/home/me/app");
    expect(parseCwds("p77\nfcwd\nn/Users/me/app\n").get(77)).toBe("/Users/me/app");
  });
});
