import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildArgv,
  commandLine,
  composeArgv,
  composeOverride,
  execArgv,
  groupByCompose,
  joinPath,
  lifecycleSteps,
  parseImages,
  parseJsonc,
  parseLogLines,
  parsePorts,
  parsePs,
  parseStats,
  resolveDevContainer,
  runArgv,
  substitute,
  suggestTemplate,
  templateFile,
  type DevContainerConfig,
} from "./model";

const fx = (f: string) => readFileSync(join(__dirname, "__fixtures__", f), "utf8");

describe("devcontainer.json", () => {
  it("parses JSONC", () => {
    const cfg = parseJsonc<DevContainerConfig>(`{
      // the image
      "image": "mcr.microsoft.com/devcontainers/base:bookworm", /* block */
      "postCreateCommand": "echo // not a comment",
      "forwardPorts": [3000, 5432,],
    }`);
    expect(cfg).toEqual({ image: "mcr.microsoft.com/devcontainers/base:bookworm", postCreateCommand: "echo // not a comment", forwardPorts: [3000, 5432] });
  });

  it("substitutes variables", () => {
    const ctx = { localWorkspaceFolder: "/home/me/app", containerWorkspaceFolder: "/workspaces/app", devcontainerId: "abc", localEnv: { HOME: "/home/me" } };
    expect(substitute({ a: ["${localWorkspaceFolderBasename}", "${localEnv:HOME}/.ssh", "${localEnv:NOPE:fallback}", "${containerEnv:PATH}"], b: 3 }, ctx)).toEqual({
      a: ["app", "/home/me/.ssh", "fallback", "${containerEnv:PATH}"],
      b: 3,
    });
    expect(substitute("${containerEnv:PATH}:/x", { ...ctx, containerEnv: { PATH: "/usr/bin" } })).toBe("/usr/bin:/x");
  });

  it("joins paths", () => {
    expect(joinPath("/w/app/.devcontainer", "..")).toBe("/w/app");
    expect(joinPath("/w/app/.devcontainer", "Dockerfile")).toBe("/w/app/.devcontainer/Dockerfile");
    expect(joinPath("C:\\w\\app\\.devcontainer", "..\\docker\\Dockerfile")).toBe("C:\\w\\app\\docker\\Dockerfile");
  });
});

describe("resolution and commands", () => {
  const cfg: DevContainerConfig = {
    name: "API",
    build: { dockerfile: "Dockerfile", context: "..", args: { VARIANT: "3.12" } },
    forwardPorts: [8000, "db:5432"],
    containerEnv: { APP_ENV: "dev" },
    remoteEnv: { PATH: "${containerEnv:PATH}:/home/vscode/.local/bin" },
    remoteUser: "vscode",
    mounts: ["source=${localEnv:HOME}/.aws,target=/home/vscode/.aws,type=bind"],
    postCreateCommand: { deps: "pip install -r requirements.txt", hooks: ["pre-commit", "install"] },
    capAdd: ["SYS_PTRACE"],
  };
  const r = resolveDevContainer(cfg, "/w/api/.devcontainer/devcontainer.json", "/w/api", { HOME: "/home/me" });

  it("resolves a Dockerfile config", () => {
    expect(r.kind).toBe("dockerfile");
    expect(r.dockerfile).toBe("/w/api/.devcontainer/Dockerfile");
    expect(r.context).toBe("/w/api");
    expect(r.workspaceFolder).toBe("/workspaces/api");
    expect(r.ports).toEqual([8000, 5432]);
    expect(r.mounts).toEqual(["source=/home/me/.aws,target=/home/vscode/.aws,type=bind"]);
    expect(r.image).toMatch(/^gear-dev-api-[0-9a-z]{1,8}$/);
    // Same inputs, same id and hash; a config change changes the hash.
    expect(resolveDevContainer(cfg, "/w/api/.devcontainer/devcontainer.json", "/w/api", { HOME: "/home/me" }).configHash).toBe(r.configHash);
    expect(resolveDevContainer({ ...cfg, forwardPorts: [9000] }, "/w/api/.devcontainer/devcontainer.json", "/w/api", { HOME: "/home/me" }).configHash).not.toBe(r.configHash);
    // …but not when only a lifecycle command changes.
    expect(resolveDevContainer({ ...cfg, postCreateCommand: "true" }, "/w/api/.devcontainer/devcontainer.json", "/w/api", { HOME: "/home/me" }).configHash).toBe(r.configHash);
  });

  it("builds docker command lines", () => {
    expect(buildArgv(r)).toEqual(["docker", "build", "-f", "/w/api/.devcontainer/Dockerfile", "-t", r.image, "--build-arg", "VARIANT=3.12", "/w/api"]);
    const run = runArgv(r);
    expect(run.slice(0, 3)).toEqual(["docker", "run", "-d"]);
    expect(run).toContain("devcontainer.local_folder=/w/api");
    expect(run).toContain("type=bind,source=/w/api,target=/workspaces/api");
    expect(run.join(" ")).toContain("-p 127.0.0.1::8000 -p 127.0.0.1::5432 --cap-add SYS_PTRACE --entrypoint /bin/sh");
    expect(run[run.length - 3]).toBe(r.image);
    expect(commandLine(["docker", "exec", "-e", "A=b c", "x", "/bin/sh", "-c", "echo 'hi'"], false)).toBe(`docker exec -e 'A=b c' x /bin/sh -c 'echo '\\''hi'\\'''`);
    expect(commandLine(["docker", "run", "--mount", "type=bind,source=C:/w"], true)).toBe("docker run --mount 'type=bind,source=C:/w'");
    expect(execArgv("c1", ["ls"], { user: "vscode", cwd: "/workspaces/api", env: { A: "1", B: null } })).toEqual(["docker", "exec", "-u", "vscode", "-w", "/workspaces/api", "-e", "A=1", "c1", "ls"]);
  });

  it("expands lifecycle commands", () => {
    expect(lifecycleSteps(r.lifecycle.postCreateCommand)).toEqual([
      { label: "deps", argv: ["/bin/sh", "-c", "pip install -r requirements.txt"] },
      { label: "hooks", argv: ["pre-commit", "install"] },
    ]);
    expect(lifecycleSteps("")).toEqual([]);
  });

  it("handles Compose configs", () => {
    const c = resolveDevContainer({ dockerComposeFile: ["../docker-compose.yml", "compose.dev.yml"], service: "app", runServices: ["db"], workspaceFolder: "/src", forwardPorts: [3000] }, "/w/shop/.devcontainer/devcontainer.json", "/w/Shop");
    expect(c.kind).toBe("compose");
    expect(c.composeFiles).toEqual(["/w/shop/docker-compose.yml", "/w/shop/.devcontainer/compose.dev.yml"]);
    expect(c.overrideCommand).toBe(false);
    expect(composeArgv(c, "/tmp/o.yml", "up")).toEqual(["docker", "compose", "-p", "shop_devcontainer", "-f", "/w/shop/docker-compose.yml", "-f", "/w/shop/.devcontainer/compose.dev.yml", "-f", "/tmp/o.yml", "up", "-d", "--build", "app", "db"]);
    expect(composeOverride(c)).toContain('- "127.0.0.1::3000"');
    expect(() => resolveDevContainer({ dockerComposeFile: "x.yml" }, "/w/.devcontainer/devcontainer.json", "/w")).toThrow(/service/);
  });
});

describe("docker CLI output", () => {
  it("parses ps / images / stats", () => {
    const ps = parsePs(fx("ps.jsonl"));
    const web = ps.find((c) => c.name === "fx-web")!;
    expect(web.state).toBe("running");
    expect(web.ports).toEqual([
      { hostIp: "127.0.0.1", hostPort: 32768, containerPort: 80, proto: "tcp" },
      { hostIp: "127.0.0.1", hostPort: 32769, containerPort: 443, proto: "tcp" },
    ]);
    expect(web.labels["com.docker.compose.project"]).toBe("shop");
    expect(groupByCompose(ps).map((g) => g.project)).toEqual(["shop", null]);
    expect(parseImages(fx("images.jsonl"))[0]).toMatchObject({ repository: "alpine", tag: "3.20", size: "12.2MB" });
    const stats = parseStats(fx("stats.jsonl"));
    expect(stats).toHaveLength(2);
    expect(stats[0].pids).toBe(1);
    expect(parsePorts("0.0.0.0:5000->5000/tcp, :::5000->5000/tcp, 6379/tcp")).toEqual([
      { hostIp: "0.0.0.0", hostPort: 5000, containerPort: 5000, proto: "tcp" },
      { hostIp: "", hostPort: null, containerPort: 6379, proto: "tcp" },
    ]);
  });

  it("parses timestamped logs", () => {
    const lines = parseLogLines(fx("logs.txt"));
    expect(lines.map((l) => [l.level, l.text])).toEqual([
      ["error", "ERROR boom"],
      ["info", "INFO started"],
    ]);
    expect(lines[0].time).toMatch(/^2026-.*Z$/);
    expect(parseLogLines("\x1b[32mok\x1b[0m\n")).toEqual([{ time: null, text: "ok", level: null }]);
  });
});

describe("templates", () => {
  it("suggests from the project files", () => {
    expect(suggestTemplate(["Cargo.toml", "src"]).id).toBe("rust");
    expect(suggestTemplate(["README.md"]).id).toBe("base");
    const node = templateFile(suggestTemplate(["package.json", "pnpm-lock.yaml"]), ["package.json", "pnpm-lock.yaml"]);
    expect(parseJsonc<DevContainerConfig>(node).postCreateCommand).toBe("corepack enable && pnpm install");
  });
});

describe("ansi", () => {
  it("splits SGR spans", async () => {
    const { ansiSpans } = await import("./model");
    expect(ansiSpans("a\x1b[1;31mred\x1b[0m b\x1b[38;5;200mx\x1b[K")).toEqual([
      { text: "a", fg: null, bold: false },
      { text: "red", fg: 1, bold: true },
      { text: " bx", fg: null, bold: false },
    ]);
  });
});
