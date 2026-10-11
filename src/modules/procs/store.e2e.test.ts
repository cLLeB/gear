// The process store against this machine: real ps / ss / lsof, a real server to find and kill.
// GEAR_TEST_PROCS=1 pnpm vitest run src/modules/procs

import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/appBridge", () => ({ app: () => ({ workspaceRoot: () => process.cwd(), openFile: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/modules/quick-pick", () => ({ confirmPick: async () => true, inputBox: async () => "18766" }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    runCommand: async (command: string) => {
      const r = spawnSync("sh", ["-c", command], { encoding: "utf8", maxBuffer: 1 << 26 });
      return { stdout: r.stdout, stderr: r.stderr, exit_code: r.status, timed_out: false, truncated: false };
    },
  },
}));

describe.skipIf(!process.env.GEAR_TEST_PROCS)("processes on this machine", () => {
  it("finds a server by port, shows it in the tree with its cwd, and stops it", async () => {
    const server = spawn("python3", ["-m", "http.server", "18766", "--bind", "127.0.0.1"], { cwd: process.cwd(), stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 800));
    const s = await import("./store");
    await s.sample(true);
    const st = s.useProcStore.getState();
    const port = st.ports.find((p) => p.port === 18766);
    expect(port).toMatchObject({ pid: server.pid, command: "python3" });
    const proc = st.procs.find((p) => p.pid === server.pid)!;
    expect(proc.args).toContain("http.server 18766");
    expect(proc.cwd).toBe(process.cwd());
    expect(s.descendants(proc.ppid)).toContain(server.pid);
    const exited = new Promise<number | null>((r) => server.on("exit", (code, sig) => r(sig ? 143 : code)));
    await s.killPort();
    expect(await exited).toBe(143);
    await s.sample();
    expect(s.useProcStore.getState().ports.some((p) => p.port === 18766)).toBe(false);
  }, 30_000);
});
