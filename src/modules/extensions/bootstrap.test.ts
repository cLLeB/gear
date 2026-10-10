import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { workerSource } from "./bootstrap";
import { activatesOn, checkCall, compareVersions, parseManifest, resolveExtensionPath, type ExtensionManifest } from "./manifest";

/** Run a worker script in a VM with a scripted host on the other end. */
function fakeWorker(source: string, answer: (method: string, args: unknown[]) => unknown) {
  const sent: Record<string, unknown>[] = [];
  const waiters: ((m: Record<string, unknown>) => boolean)[] = [];
  const self: Record<string, unknown> = {
    fetch: () => Promise.resolve("real fetch"),
    addEventListener: () => {},
    postMessage: (m: Record<string, unknown>) => {
      sent.push(m);
      if (m.type === "call") {
        Promise.resolve()
          .then(() => answer(m.method as string, m.args as unknown[]))
          .then(
            (value) => deliver({ type: "result", id: m.id, value }),
            (e: Error) => deliver({ type: "result", id: m.id, error: e.message }),
          );
      }
      for (const w of [...waiters]) if (w(m)) waiters.splice(waiters.indexOf(w), 1);
    },
  };
  self.self = self;
  const ctx = createContext(self);
  runInContext(source, ctx);
  const deliver = (m: unknown) => (self.onmessage as (e: { data: unknown }) => void)({ data: m });
  const next = (pred: (m: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((res) => {
      const hit = sent.find(pred);
      if (hit) return res(hit);
      waiters.push((m) => (pred(m) ? (res(m), true) : false));
    });
  return { sent, deliver, next, self };
}

const manifest = (over: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
  id: "me.words",
  name: "Words",
  version: "1.0.0",
  main: "main.js",
  permissions: ["editor.read"],
  activationEvents: ["onStartup"],
  contributes: { commands: [{ id: "words.count", title: "Count words" }], configuration: {} },
  ...over,
});

describe("manifest", () => {
  it("validates and normalizes", () => {
    const m = parseManifest(JSON.stringify({ id: "me.words", version: "0.1.0", permissions: ["editor.read"], contributes: { commands: [{ id: "words.count", title: "Count" }], configuration: { "words.min": { type: "number", default: 3 } } } }));
    expect(m).toMatchObject({ id: "me.words", name: "me.words", main: "main.js", activationEvents: ["onStartup"] });
    expect(() => parseManifest(JSON.stringify({ id: "Bad Id", version: "1", main: "../x.js", permissions: ["root"], contributes: { configuration: { a: { type: "number", default: "x" } } } }))).toThrow(/publisher\.name[\s\S]*semver[\s\S]*inside the extension[\s\S]*unknown permission "root"[\s\S]*configuration "a"/);
    expect(activatesOn(manifest({ activationEvents: ["onCommand:words.count"] }), "onCommand:words.count")).toBe(true);
    expect(activatesOn(manifest({ activationEvents: ["onCommand:words.count"] }), "onStartup")).toBe(false);
    expect(compareVersions("1.10.0", "1.9.3")).toBeGreaterThan(0);
  });

  it("gates calls on permissions and paths", () => {
    const m = manifest();
    expect(checkCall(m, "editor.active", [])).toBeNull();
    expect(checkCall(m, "shell.exec", ["rm -rf /"])).toMatch(/"shell" permission/);
    expect(checkCall(m, "commands.register", ["other.cmd"])).toMatch(/isn't declared/);
    expect(checkCall(m, "nope", [])).toMatch(/Unknown API/);
    expect(resolveExtensionPath("src/a.ts", "/w/app", ["fs.read"])).toBe("/w/app/src/a.ts");
    expect(() => resolveExtensionPath("../../etc/passwd", "/w/app", ["fs.read"])).toThrow(/outside the workspace/);
    expect(() => resolveExtensionPath("/w/application/x", "/w/app", ["fs.read"])).toThrow(/outside/);
    expect(resolveExtensionPath("/etc/hosts", "/w/app", ["fs.read", "fs.any"])).toBe("/etc/hosts");
  });
});

describe("worker runtime", () => {
  it("loads modules, activates, registers commands and round-trips calls", async () => {
    const src = workerSource(manifest(), {
      "main.js": `const { count } = require("./lib/count");
const cfg = require("./config.json");
exports.activate = async (gear) => {
  console.log("activating", gear.extension.id, cfg.greeting);
  gear.commands.register("words.count", async () => {
    const ed = await gear.editor.active();
    const n = count(ed.text);
    await gear.window.showInformation(n + " words");
    return n;
  });
}; // trailing comment`,
      "lib/count.js": "module.exports.count = (s) => s.split(/\\s+/).filter(Boolean).length;",
      "config.json": '{ "greeting": "hi" }',
    });
    const calls: [string, unknown[]][] = [];
    const w = fakeWorker(src, (method, args) => {
      calls.push([method, args]);
      return method === "editor.active" ? { text: "one two  three" } : null;
    });
    w.deliver({ type: "activate" });
    expect(await w.next((m) => m.type === "activated")).toEqual({ type: "activated" });
    expect(w.sent.find((m) => m.type === "log")).toEqual({ type: "log", level: "info", text: "activating me.words hi" });
    w.deliver({ type: "invoke", id: 7, command: "words.count", args: [] });
    expect(await w.next((m) => m.type === "invokeResult")).toEqual({ type: "invokeResult", id: 7, value: 3 });
    expect(calls).toEqual([
      ["commands.register", ["words.count"]],
      ["editor.active", []],
      ["window.showMessage", ["info", "3 words", []]],
    ]);
  });

  it("reports activation errors, host rejections and blocks the network", async () => {
    const src = workerSource(manifest(), {
      "main.js": `exports.activate = async (gear) => {
  gear.commands.register("words.count", async () => {
    let net;
    try { await fetch("https://example.com"); } catch (e) { net = e.message; }
    try { new XMLHttpRequest(); } catch (e) { net += " | " + e.message; }
    try { await gear.shell.exec("ls"); } catch (e) { return net + " | " + e.message; }
  });
  require("left-pad");
};`,
    });
    const w = fakeWorker(src, (method) => {
      if (method === "shell.exec") throw new Error('shell.exec needs the "shell" permission');
      return null;
    });
    w.deliver({ type: "activate" });
    const act = await w.next((m) => m.type === "activated");
    expect(String(act.error)).toMatch(/only files inside the extension can be required/);
    // The command registered before the failure still works.
    w.deliver({ type: "invoke", id: 1, command: "words.count", args: [] });
    const r = await w.next((m) => m.type === "invokeResult");
    expect(r.value).toBe('Network access needs the "network" permission | Network access needs the "network" permission | shell.exec needs the "shell" permission');
  });

  it("keeps fetch with the network permission and delivers events", async () => {
    const src = workerSource(manifest({ permissions: ["network"] }), {
      "main.js": `exports.activate = (gear) => {
  gear.events.on("save", async (p) => { console.log("saved", p.path, await fetch("x")); });
};`,
    });
    const w = fakeWorker(src, () => null);
    w.deliver({ type: "activate" });
    await w.next((m) => m.type === "activated");
    w.deliver({ type: "event", name: "save", payload: { path: "/w/a.ts" } });
    expect((await w.next((m) => m.type === "log" && String(m.text).startsWith("saved"))).text).toBe("saved /w/a.ts real fetch");
  });

  it("refuses a missing main file", () => {
    expect(() => workerSource(manifest({ main: "dist/index.js" }), { "main.js": "" })).toThrow(/main file dist\/index.js is missing/);
  });
});
