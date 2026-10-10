import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cksumScript,
  grepScript,
  listScript,
  mirrorPath,
  opScript,
  parentRemote,
  parseCksum,
  parseDestination,
  parseGrep,
  parseList,
  parseListening,
  parseProbe,
  parseSshConfig,
  PORTS_SCRIPT,
  posixQuote,
  PROBE,
  sftpArgv,
  encodeScript,
  sftpBatch,
  sshArgv,
} from "./model";

describe("ssh config", () => {
  it("parses hosts, aliases and first-value-wins", () => {
    const hosts = parseSshConfig(`
# work
Host prod prod-alias
  HostName 10.0.0.5
  User deploy
  Port=2200
  IdentityFile "~/.ssh/id prod"
  User ignored

Host *.internal !bad
  User x
Host dev
  hostname dev.example.com # trailing comment
  ProxyJump bastion
Match host prod
  User nope
Host *
  ServerAliveInterval 30
`);
    expect(hosts).toEqual([
      { alias: "prod", hostName: "10.0.0.5", user: "deploy", port: 2200, identityFile: "~/.ssh/id prod" },
      { alias: "prod-alias", hostName: "10.0.0.5", user: "deploy", port: 2200, identityFile: "~/.ssh/id prod" },
      { alias: "dev", hostName: "dev.example.com", proxyJump: "bastion" },
    ]);
    expect(parseDestination("me@box.example.com:2222")).toEqual({ dest: "me@box.example.com", port: 2222 });
    expect(parseDestination("ssh://[::1]:22")).toEqual({ dest: "::1", port: 22 });
    expect(parseDestination("prod")).toEqual({ dest: "prod" });
    expect(parseDestination("not a host")).toBeNull();
  });

  it("parses command output", () => {
    expect(parseList("d\t0\tsrc\nf\t12\tb.txt\nL\t0\tlinked\nf\t3\tA.md\nl\t0\tdangling\njunk\n")).toEqual([
      { name: "linked", kind: "link", isDir: true, size: 0 },
      { name: "src", kind: "dir", isDir: true, size: 0 },
      { name: "A.md", kind: "file", isDir: false, size: 3 },
      { name: "b.txt", kind: "file", isDir: false, size: 12 },
      { name: "dangling", kind: "link", isDir: false, size: 0 },
    ]);
    expect(parseListening("LISTEN 0 4096 127.0.0.1:5432 0.0.0.0:*\nLISTEN 0 128 [::]:22 [::]:*\ntcp 0 0 0.0.0.0:8080 0.0.0.0:* LISTEN\n")).toEqual([22, 5432, 8080]);
    expect(parseCksum("3015617425 6\n")).toBe("3015617425 6");
    expect(parseGrep("./src/a.ts:3:const x = 1;\n./b c.md:10:x:y\n", "/srv/app/")).toEqual([
      { path: "/srv/app/src/a.ts", line: 3, text: "const x = 1;" },
      { path: "/srv/app/b c.md", line: 10, text: "x:y" },
    ]);
    expect(sftpBatch([["put", "C:\\tmp\\a.txt", '/srv/we"ird.txt']])).toBe('put "C:\\\\tmp\\\\a.txt" "/srv/we\\"ird.txt"\n');
    expect(mirrorPath("/cache/remote/", "me@box", "/srv/app/a:b.txt")).toBe("/cache/remote/me@box/srv/app/a_b.txt");
    expect(parentRemote("/srv/app/x")).toBe("/srv/app");
    expect(parentRemote("/srv")).toBe("/");
    expect(() => opScript({ op: "delete", path: "/home" })).toThrow(/Refusing/);
  });
});

// Real host: GEAR_TEST_SSH=<alias from ~/.ssh/config> pnpm vitest run src/modules/remote
const host = process.env.GEAR_TEST_SSH;
describe.skipIf(!host)("against a real sshd", () => {
  const o = { multiplex: true, batch: true };
  const ssh = (script: string) => {
    const [cmd, ...args] = sshArgv(host!, script, o);
    return execFileSync(cmd, args, { encoding: "utf8" });
  };
  const sh = (argv: string[]) => execFileSync(argv[0], argv.slice(1), { encoding: "utf8" });

  it("probes, lists, edits through sftp and detects remote changes", () => {
    const probe = parseProbe(ssh(PROBE));
    expect(probe.system).toMatch(/Linux|Darwin|BSD/);
    const dir = `${probe.home}/gear test 'dir'`;
    ssh(`rm -rf -- ${posixQuote(dir)}`);
    ssh(opScript({ op: "mkdir", path: `${dir}/sub` }));
    ssh(opScript({ op: "touch", path: `${dir}/.hidden` }));
    expect(() => ssh(opScript({ op: "touch", path: `${dir}/.hidden` }))).toThrow();
    // Upload through sftp from a local file, as saving does.
    const local = mkdtempSync(join(tmpdir(), "gear-ssh-"));
    writeFileSync(join(local, "a.txt"), "hello\nTODO: fix\n");
    writeFileSync(join(local, "batch"), sftpBatch([["put", join(local, "a.txt"), `${dir}/a b.txt`]]));
    sh(sftpArgv(host!, join(local, "batch"), o));
    expect(parseList(ssh(listScript(dir)))).toEqual([
      { name: "sub", kind: "dir", isDir: true, size: 0 },
      { name: ".hidden", kind: "file", isDir: false, size: 0 },
      { name: "a b.txt", kind: "file", isDir: false, size: 16 },
    ]);
    const before = parseCksum(ssh(cksumScript(`${dir}/a b.txt`)));
    expect(before).toMatch(/^\d+ 16$/);
    // Download back.
    writeFileSync(join(local, "batch"), sftpBatch([["get", `${dir}/a b.txt`, join(local, "back.txt")]]));
    sh(sftpArgv(host!, join(local, "batch"), o));
    expect(readFileSync(join(local, "back.txt"), "utf8")).toBe("hello\nTODO: fix\n");
    // Someone else edits it: the checksum changes.
    ssh(`echo more >> ${posixQuote(`${dir}/a b.txt`)}`);
    expect(parseCksum(ssh(cksumScript(`${dir}/a b.txt`)))).not.toBe(before);
    expect(parseGrep(ssh(grepScript(dir, "TODO")), dir)).toEqual([{ path: `${dir}/a b.txt`, line: 2, text: "TODO: fix" }]);
    ssh(opScript({ op: "rename", from: `${dir}/a b.txt`, to: `${dir}/sub/c.txt` }));
    expect(parseList(ssh(listScript(`${dir}/sub`))).map((e) => e.name)).toEqual(["c.txt"]);
    ssh(opScript({ op: "delete", path: dir }));
    expect(parseCksum(ssh(cksumScript(`${dir}/sub/c.txt`)))).toBe("missing");
    expect(parseListening(ssh(PORTS_SCRIPT))).toContain(2222);
    // The encoded form gives the same answer.
    expect(ssh(encodeScript(`${PROBE}; echo "ünï 'q'"`))).toBe(`${ssh(PROBE)}ünï 'q'\n`);
  }, 60_000);
});
