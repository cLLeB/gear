import { describe, expect, it } from "vitest";
import {
  composeServices,
  extractJsonBlocks,
  filterLog,
  forEachDirCommand,
  logLevelCounts,
  logLevelOf,
  packageDirs,
  parseColumnar,
  parseComposePs,
  retryCommand,
  rowsToCsv,
  rowsToJson,
  rowsToMarkdown,
  serveCommand,
  tailCommand,
  transferCommand,
  watchCommand,
} from "./terminalTools3";

describe("columnar output", () => {
  it("parses docker ps with multi-word headers and spaced values", () => {
    const out = [
      "CONTAINER ID   IMAGE          COMMAND                  STATUS          NAMES",
      "a1b2c3d4e5f6   nginx:latest   \"/docker-entrypoint.…\"   Up 2 hours      web",
      "0f9e8d7c6b5a   redis:7        \"docker-entrypoint.s…\"   Exited (0) 3m   cache",
    ].join("\n");
    const t = parseColumnar(out)!;
    expect(t.header).toEqual(["CONTAINER ID", "IMAGE", "COMMAND", "STATUS", "NAMES"]);
    expect(t.rows[1]).toEqual(["0f9e8d7c6b5a", "redis:7", '"docker-entrypoint.s…"', "Exited (0) 3m", "cache"]);
  });

  it("parses kubectl output and converts", () => {
    const t = parseColumnar("NAME    READY   STATUS    RESTARTS   AGE\nweb-1   1/1     Running   0          5d\n")!;
    expect(t.rows).toEqual([["web-1", "1/1", "Running", "0", "5d"]]);
    expect(rowsToCsv(t.header, t.rows)).toBe("NAME,READY,STATUS,RESTARTS,AGE\nweb-1,1/1,Running,0,5d\n");
    expect(JSON.parse(rowsToJson(["CONTAINER ID", "x"], [["1", "2"]]))).toEqual([{ container_id: "1", x: "2" }]);
    expect(rowsToMarkdown(["a", "b"], [["1", "x|y"]])).toBe("| a   | b    |\n| --- | ---- |\n| 1   | x\\|y |");
    expect(parseColumnar("one line")).toBeNull();
  });
});

describe("JSON in output", () => {
  it("finds embedded objects and JSON lines", () => {
    const out = 'HTTP/1.1 200\n{"a": {"b": [1, 2]}, "s": "}"}\nlog {"level":"info","msg":"x"}\n[] {}\n';
    expect(extractJsonBlocks(out)).toEqual([{ a: { b: [1, 2] }, s: "}" }, { level: "info", msg: "x" }]);
  });
});

describe("logs", () => {
  it("classifies levels", () => {
    expect(logLevelOf("2024-01-01 12:00:00 ERROR something broke")).toBe("error");
    expect(logLevelOf('{"level":"warn","msg":"x"}')).toBe("warn");
    expect(logLevelOf('{"level":50,"msg":"x"}')).toBe("fatal");
    expect(logLevelOf("time=1 level=debug msg=y")).toBe("debug");
    expect(logLevelOf("[INFO] started")).toBe("info");
    expect(logLevelOf("Traceback (most recent call last):")).toBe("error");
    expect(logLevelOf("hello world")).toBeNull();
  });

  it("filters with continuation lines", () => {
    const lines = ["INFO a", "ERROR b", "    at foo (x.js:1)", "INFO c", "WARN d"];
    expect(filterLog(lines, "warn").map((l) => l.index)).toEqual([1, 2, 4]);
    expect(logLevelCounts(lines)).toMatchObject({ info: 2, error: 1, warn: 1 });
  });
});

describe("shell snippets", () => {
  it("builds retry / watch / loops", () => {
    expect(retryCommand("npm test", 3, 2, "posix")).toBe(
      `sh -c 'd=2; i=1; until npm test; do if [ $i -ge 3 ]; then echo "Gave up after 3 attempts" >&2; exit 1; fi; echo "Attempt $i failed - retrying in \${d}s" >&2; sleep $d; d=$((d*2)); i=$((i+1)); done'`,
    );
    expect(retryCommand("npm test", 3, 2, "powershell")).toContain("for ($i=1; $i -le 3; $i++) { npm test; if ($?) { break }");
    expect(watchCommand("kubectl get pods", 5, "posix")).toContain("sleep 5");
    expect(watchCommand("git status", 2, "powershell")).toContain("Start-Sleep -Seconds 2");
    const loop = forEachDirCommand(["packages/a", "it's"], "npm test", "posix");
    expect(loop).toContain(`for d in '\\''packages/a'\\'' '\\''it'\\''\\'\\'''\\''s'\\''; do`);
    expect(forEachDirCommand(["a"], "cargo test", "powershell", true)).toContain("foreach ($d in @('a'))");
  });

  it("finds package folders", () => {
    expect(packageDirs(["package.json", "packages/a/package.json", "node_modules/x/package.json", "packages/a/package.json", "apps/web/Cargo.toml"])).toEqual([".", "apps/web", "packages/a"]);
  });

  it("builds transfer, tail and serve commands", () => {
    expect(transferCommand({ direction: "upload", host: "me@box", local: "dist", remote: "/srv/app", tool: "rsync", recursive: true })).toBe("rsync -avz --progress dist me@box:/srv/app");
    expect(transferCommand({ direction: "download", host: "box", local: "./my file", remote: "/var/log/x.log", tool: "scp", recursive: false })).toBe('scp box:/var/log/x.log "./my file"');
    expect(tailCommand("/var/log/a b.log", "posix")).toBe("tail -n 100 -F '/var/log/a b.log'");
    expect(tailCommand("C:\\x.log", "powershell", 20)).toBe("Get-Content -Path 'C:\\x.log' -Tail 20 -Wait");
    expect(serveCommand({ python: "python3" }, 8000)).toBe("python3 -m http.server 8000");
    expect(serveCommand({}, 8000)).toBeNull();
  });
});

describe("compose", () => {
  it("parses ps json and service names", () => {
    const ps = parseComposePs('{"Service":"web","Name":"app-web-1","State":"running","Status":"Up 1m","Publishers":[{"PublishedPort":8080,"TargetPort":80},{"PublishedPort":0,"TargetPort":443}]}\n');
    expect(ps).toEqual([{ service: "web", name: "app-web-1", state: "running", status: "Up 1m", ports: "8080→80" }]);
    expect(composeServices("version: '3'\nservices:\n  web:\n    image: x\n    ports:\n      - 80\n  db:\n    image: pg\nvolumes:\n  data:\n")).toEqual(["web", "db"]);
  });
});
