// Runs the generated docker command lines against a real daemon.
// GEAR_TEST_DOCKER=1 pnpm vitest run src/modules/containers/docker.e2e.test.ts

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { chownSync } from "node:fs";
import { buildArgv, commandLine, composeArgv, composeOverride, execArgv, LABEL_FOLDER, lifecycleSteps, uidUpdateTarget, updateUidScript, parseJsonc, parsePs, resolveDevContainer, runArgv, type DevContainerConfig } from "./model";

const sh = (argv: string[]) => execSync(commandLine(argv, false), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const dir = mkdtempSync(join(tmpdir(), "gear-dc-"));
const cleanup: string[][] = [];

describe.skipIf(!process.env.GEAR_TEST_DOCKER)("dev containers against docker", () => {
  afterAll(() => {
    for (const c of cleanup.reverse()) {
      try {
        sh(c);
      } catch {
        /* already gone */
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds a Dockerfile config, runs lifecycle commands as the remote user and publishes ports", () => {
    const ws = join(dir, "My App");
    mkdirSync(join(ws, ".devcontainer"), { recursive: true });
    writeFileSync(join(ws, ".devcontainer", "Dockerfile"), "FROM alpine:3.20\nARG GREETING\nRUN adduser -D dev && echo \"$GREETING\" > /greeting\n");
    writeFileSync(
      join(ws, ".devcontainer", "devcontainer.json"),
      `{
        // comments are fine
        "build": { "dockerfile": "Dockerfile", "context": "..", "args": { "GREETING": "hello there" } },
        "forwardPorts": [8080],
        "containerEnv": { "APP_ENV": "dev" },
        "remoteUser": "dev",
        "remoteEnv": { "PATH": "\${containerEnv:PATH}:/opt/x" },
        "postCreateCommand": { "a": "echo \\"$APP_ENV $(whoami) $(cat /greeting)\\" > created.txt", "b": ["sh", "-c", "pwd > where.txt"] },
      }`,
    );
    const raw = parseJsonc<DevContainerConfig>(readFileSync(join(ws, ".devcontainer", "devcontainer.json"), "utf8"));
    const r = resolveDevContainer(raw, join(ws, ".devcontainer", "devcontainer.json"), ws);
    cleanup.push(["docker", "rmi", "-f", r.image]);
    sh(buildArgv(r)!);
    const id = sh(runArgv(r)).trim();
    cleanup.push(["docker", "rm", "-f", id]);
    // The labels find it again.
    const found = parsePs(sh(["docker", "ps", "-a", "--no-trunc", "--filter", `label=${LABEL_FOLDER}=${ws}`, "--format", "{{json .}}"]));
    expect(found.map((c) => c.id)).toEqual([id]);
    expect(found[0].ports[0]).toMatchObject({ hostIp: "127.0.0.1", containerPort: 8080 });
    // Pretend the workspace belongs to host user 1234: the remote user must take that UID to write to it.
    for (const p of [ws, join(ws, ".devcontainer")]) chownSync(p, 1234, 1234);
    const target = uidUpdateTarget(r, 1234);
    expect(target).toBe("dev");
    expect(sh(execArgv(id, ["/bin/sh", "-c", updateUidScript(target!, 1234, 1234)], { user: "root" }))).toMatch(/Updated dev to UID 1234/);
    expect(sh(execArgv(id, ["id"], { user: "dev" }))).toMatch(/uid=1234\(dev\) gid=1234\(dev\)/);
    // Idempotent.
    expect(sh(execArgv(id, ["/bin/sh", "-c", updateUidScript(target!, 1234, 1234)], { user: "root" }))).toBe("");
    for (const step of lifecycleSteps(r.lifecycle.postCreateCommand)) sh(execArgv(id, step.argv, { user: r.remoteUser, cwd: r.workspaceFolder }));
    // Written through the bind mount, by the remote user, with the container env.
    expect(readFileSync(join(ws, "created.txt"), "utf8").trim()).toBe("dev dev hello there");
    expect(readFileSync(join(ws, "where.txt"), "utf8").trim()).toBe("/workspaces/My App");
    const env = Object.fromEntries((JSON.parse(sh(["docker", "inspect", "--format", "{{json .Config.Env}}", id])) as string[]).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
    expect(env.APP_ENV).toBe("dev");
  }, 180_000);

  it("brings up a Compose config with the override", () => {
    const ws = join(dir, "shop");
    mkdirSync(join(ws, ".devcontainer"), { recursive: true });
    // Compose resolves relative volumes against the first file's directory, so mount the workspace explicitly.
    writeFileSync(join(ws, "docker-compose.yml"), `services:\n  app:\n    image: alpine:3.20\n    volumes:\n      - ${JSON.stringify(`${ws}:/src`)}\n  cache:\n    image: alpine:3.20\n    command: sleep 300\n`);
    const r = resolveDevContainer({ dockerComposeFile: "../docker-compose.yml", service: "app", runServices: ["cache"], workspaceFolder: "/src", overrideCommand: true, forwardPorts: [9000] }, join(ws, ".devcontainer", "devcontainer.json"), ws);
    const override = join(dir, "override.yml");
    writeFileSync(override, composeOverride(r));
    cleanup.push(composeArgv(r, override, "down"));
    sh(composeArgv(r, override, "up"));
    const cs = parsePs(sh(["docker", "ps", "--no-trunc", "--filter", `label=com.docker.compose.project=${r.composeProject}`, "--format", "{{json .}}"]));
    expect(cs.map((c) => c.labels["com.docker.compose.service"]).sort()).toEqual(["app", "cache"]);
    const app = cs.find((c) => c.labels["com.docker.compose.service"] === "app")!;
    expect(app.labels[LABEL_FOLDER]).toBe(ws);
    expect(app.ports.some((p) => p.containerPort === 9000 && p.hostPort)).toBe(true);
    sh(execArgv(app.id, ["sh", "-c", "touch /src/from-compose"], { cwd: r.workspaceFolder }));
    expect(existsSync(join(ws, "from-compose"))).toBe(true);
  }, 180_000);
});
