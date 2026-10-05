import { describe, expect, it } from "vitest";
import { AsciicastRecorder, parseDockerPs, parseLsof, parseNetstat, parseSs, parseSshConfig, sshIncludes } from "./devTools";

describe("parseSshConfig", () => {
  it("lists concrete hosts with their details", () => {
    const cfg = `# global\nHost *\n  ServerAliveInterval 30\n\nHost prod web-1\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n\nHost=gh\n  Hostname=github.com\nMatch host x\n  User nobody\nHost !bad *.corp\n`;
    expect(parseSshConfig(cfg)).toEqual([
      { alias: "prod", hostName: "10.0.0.5", user: "deploy", port: "2222" },
      { alias: "web-1", hostName: "10.0.0.5", user: "deploy", port: "2222" },
      { alias: "gh", hostName: "github.com", user: null, port: null },
    ]);
  });

  it("resolves Include paths", () => {
    expect(sshIncludes("Include config.d/work\nInclude ~/other\ninclude conf.d/*", "/home/a/.ssh")).toEqual([
      "/home/a/.ssh/config.d/work",
      "/home/a/other",
    ]);
  });
});

describe("parseDockerPs", () => {
  it("reads json lines, running first", () => {
    const out = [
      JSON.stringify({ ID: "b1", Names: "db", Image: "postgres:16", State: "exited", Status: "Exited (0) 2 hours ago", Ports: "" }),
      JSON.stringify({ ID: "a1", Names: "web", Image: "nginx", State: "running", Status: "Up 3 minutes", Ports: "0.0.0.0:8080->80/tcp" }),
      "garbage",
    ].join("\n");
    const list = parseDockerPs(out);
    expect(list.map((c) => c.name)).toEqual(["web", "db"]);
    expect(list[0].ports).toContain("8080");
  });
});

describe("listening ports", () => {
  it("parses ss", () => {
    const out = `LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=4242,fd=21))\nLISTEN 0 128 [::]:22 [::]:*\n`;
    expect(parseSs(out)).toEqual([
      { address: "::", port: 22, pid: null, process: null },
      { address: "0.0.0.0", port: 3000, pid: 4242, process: "node" },
    ]);
  });

  it("parses lsof", () => {
    const out = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 501 me 23u IPv6 0x1 0t0 TCP *:5173 (LISTEN)\nnode 501 me 24u IPv4 0x2 0t0 TCP 127.0.0.1:5173 (LISTEN)\n`;
    expect(parseLsof(out)).toEqual([{ address: "*", port: 5173, pid: 501, process: "node" }]);
  });

  it("parses netstat with tasklist names", () => {
    const out = `\r\nActive Connections\r\n  Proto  Local Address  Foreign Address  State  PID\r\n  TCP    0.0.0.0:135    0.0.0.0:0   LISTENING   1100\r\n  TCP    127.0.0.1:8000  0.0.0.0:0  LISTENING  7788\r\n  TCP    10.0.0.2:5000  1.2.3.4:443  ESTABLISHED 1\r\n`;
    const tasks = `"svchost.exe","1100","Services","0","10,000 K"\r\n"python.exe","7788","Console","1","50,000 K"`;
    expect(parseNetstat(out, tasks)).toEqual([
      { address: "0.0.0.0", port: 135, pid: 1100, process: "svchost.exe" },
      { address: "127.0.0.1", port: 8000, pid: 7788, process: "python.exe" },
    ]);
  });
});

describe("AsciicastRecorder", () => {
  it("writes a v2 header and timed events", () => {
    const r = new AsciicastRecorder(80, 24, 1_000_000, "demo");
    r.output("hello\r\n", 1_000_500);
    r.resize(100, 30, 1_001_000);
    r.resize(100, 30, 1_001_100);
    r.output(new TextEncoder().encode("é"), 1_002_000);
    const lines = r.toString().trim().split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({ version: 2, width: 80, height: 24, timestamp: 1000, title: "demo" });
    expect(JSON.parse(lines[1])).toEqual([0.5, "o", "hello\r\n"]);
    expect(JSON.parse(lines[2])).toEqual([1, "r", "100x30"]);
    expect(JSON.parse(lines[3])).toEqual([2, "o", "é"]);
    expect(lines).toHaveLength(4);
  });
});

describe("parseEnvOutput", async () => {
  const { parseEnvOutput } = await import("./sessionTools");
  it("splits KEY=VALUE lines and sorts", () => {
    expect(parseEnvOutput("B=2\nA=x=y\nnot a var\nProgramFiles(x86)=C:\\P\n")).toEqual([
      ["A", "x=y"],
      ["B", "2"],
      ["ProgramFiles(x86)", "C:\\P"],
    ]);
  });
});
