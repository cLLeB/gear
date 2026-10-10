// The remote store end to end against a real sshd, with the Tauri bridge
// replaced by real processes and files. GEAR_TEST_SSH=<alias> pnpm vitest run src/modules/remote

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { connect as tcp } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const host = process.env.GEAR_TEST_SSH;
const cache = mkdtempSync(`${tmpdir()}/gear-remote-cache-`);
const opened: { path: string; line?: number }[] = [];
const picks: string[] = [];
const bg = new Map<number, { p: ChildProcess; out: string; code: number | null; exited: boolean }>();

vi.mock("@tauri-apps/api/path", () => ({ appCacheDir: async () => cache, homeDir: async () => homedir() }));
vi.mock("@/app/appBridge", () => ({ app: () => ({ openFile: (path: string, line?: number) => opened.push({ path, line }), openTerminal: () => {}, openPreview: () => {} }) }));
vi.mock("sonner", () => ({ toast: Object.assign(() => 0, { error: vi.fn(), success: vi.fn(), info: vi.fn(), loading: () => 1, dismiss: () => {} }) }));
vi.mock("@/modules/quick-pick", () => ({
  quickPick: async (items: { value: unknown }[] | Promise<{ value: unknown }[]>) => {
    const list = await items;
    const want = picks.shift();
    return list.find((i) => i.value === want)?.value;
  },
  inputBox: async () => undefined,
  confirmPick: async () => true,
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    runCommand: async (command: string, cwd: string | null) => {
      const r = spawnSync("sh", ["-c", command], { cwd: cwd ?? undefined, encoding: "utf8" });
      return { stdout: r.stdout, stderr: r.stderr, exit_code: r.status, timed_out: false, truncated: false };
    },
    readFile: async (p: string) => (existsSync(p) ? { kind: "text", content: readFileSync(p, "utf8"), size: 0 } : Promise.reject(new Error("missing"))),
    writeFile: async (p: string, c: string) => writeFileSync(p, c),
    createDir: async (p: string) => void mkdirSync(p, { recursive: true }),
    shellBgSpawn: async (command: string) => {
      const p = spawn("sh", ["-c", command]);
      const id = bg.size + 1;
      const e = { p, out: "", code: null as number | null, exited: false };
      p.stdout!.on("data", (d) => (e.out += d));
      p.stderr!.on("data", (d) => (e.out += d));
      p.on("exit", (c) => Object.assign(e, { code: c, exited: true }));
      bg.set(id, e);
      return id;
    },
    shellBgLogs: async (id: number) => {
      const e = bg.get(id)!;
      return { bytes: e.out, next_offset: e.out.length, dropped: 0, exited: e.exited, exit_code: e.code };
    },
    shellBgKill: async (id: number) => void bg.get(id)?.p.kill(),
  },
}));

describe.skipIf(!host)("remote store against a real sshd", () => {
  it("connects, lists, opens, saves back and catches conflicting edits", async () => {
    const s = await import("./store");
    const { posixQuote } = await import("./model");
    await s.loadHosts();
    expect(s.useRemoteStore.getState().hosts.some((h) => h.alias === host)).toBe(true);
    const dir = `/tmp/gear-remote-e2e-${Date.now()}`;
    await s.run(host!, `mkdir -p ${dir}/src && printf 'v1\\n' > ${dir}/src/app.txt`);
    expect(await s.connect(host!)).toBe(true);
    await s.setRoot(host!, dir);
    expect(s.useRemoteStore.getState().dirs[s.dirKey(host!, dir)].entries.map((e) => e.name)).toEqual(["src"]);
    s.toggleDir(host!, `${dir}/src`);
    await vi.waitFor(() => expect(s.useRemoteStore.getState().dirs[s.dirKey(host!, `${dir}/src`)]?.entries.map((e) => e.name)).toEqual(["app.txt"]));

    await s.openRemote(host!, `${dir}/src/app.txt`);
    const local = opened[opened.length - 1].path;
    expect(local.startsWith(cache)).toBe(true);
    expect(readFileSync(local, "utf8")).toBe("v1\n");

    // Edit locally and save: the editor fires gear:file-saved.
    writeFileSync(local, "v2 from gear\n");
    await s.uploadMirror(local);
    expect(await s.run(host!, `cat ${dir}/src/app.txt`)).toBe("v2 from gear\n");

    // Someone changes it on the server; our next save must ask first.
    await s.run(host!, `printf 'server edit\\n' > ${dir}/src/app.txt`);
    writeFileSync(local, "v3 from gear\n");
    picks.push("skip");
    await s.uploadMirror(local);
    expect(await s.run(host!, `cat ${dir}/src/app.txt`)).toBe("server edit\n");
    picks.push("compare");
    await s.uploadMirror(local);
    expect(opened[opened.length - 1].path).toBe(`${local}.remote`);
    expect(readFileSync(`${local}.remote`, "utf8")).toBe("server edit\n");
    picks.push("overwrite");
    await s.uploadMirror(local);
    expect(await s.run(host!, `cat ${dir}/src/app.txt`)).toBe("v3 from gear\n");
    // After our own upload the baseline moved, so the next save goes straight through.
    writeFileSync(local, "v4\n");
    await s.uploadMirror(local);
    expect(await s.run(host!, `cat ${dir}/src/app.txt`)).toBe("v4\n");

    await s.fileOp(host!, { op: "rename", from: `${dir}/src/app.txt`, to: `${dir}/src/main.txt` });
    expect(s.useRemoteStore.getState().dirs[s.dirKey(host!, `${dir}/src`)].entries.map((e) => e.name)).toEqual(["main.txt"]);
    await s.run(host!, `rm -rf -- ${posixQuote(dir)}`);

    // Port forward: localhost:18022 → the host's own sshd (2222); the SSH banner proves the tunnel.
    await s.startForward(host!, 18022, 2222);
    expect(s.useRemoteStore.getState().forwards[0]).toMatchObject({ status: "up", local: 18022, remote: 2222 });
    const banner = await new Promise<string>((res, rej) => {
      const c = tcp(18022, "127.0.0.1");
      c.once("data", (d) => (res(String(d)), c.destroy()));
      c.once("error", rej);
    });
    expect(banner).toMatch(/^SSH-2\.0-OpenSSH/);
    // A second forward on the same local port fails cleanly.
    await s.startForward(host!, 18022, 22);
    expect(s.useRemoteStore.getState().forwards[1]).toMatchObject({ status: "failed" });
    for (const f of s.useRemoteStore.getState().forwards) await s.stopForward(f.key);
    expect(s.useRemoteStore.getState().forwards).toEqual([]);
  }, 60_000);
});
