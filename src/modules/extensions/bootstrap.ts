// Builds the source of an extension's Web Worker: a small CommonJS loader for
// the extension's files, the `gear` API (every call is a message to the host,
// which checks permissions), console → extension log, and network globals
// removed unless the extension asked for "network".
//
// Module sources are pasted into the worker as function bodies rather than
// evaluated, so the app's CSP (no 'unsafe-eval') holds inside the worker too.

import type { ExtensionManifest } from "./manifest";

export const PROTOCOL_VERSION = 1;

/** Extension files the loader can `require` (path relative to the extension root → source). */
export type ModuleMap = Record<string, string>;

function wrap(path: string, source: string): string {
  if (path.endsWith(".json")) return `${JSON.stringify(path)}: function (module) { module.exports = ${source.trim() || "null"}; }`;
  // The newline before the closing brace keeps a trailing // comment from swallowing it.
  return `${JSON.stringify(path)}: function (module, exports, require, gear, console) {\n${source}\n}`;
}

const RUNTIME = String.raw`
const __post = (m) => self.postMessage(m);
let __seq = 0;
const __pending = new Map();
const __commands = new Map();
const __listeners = Object.create(null);
let __exports = null;

function __call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++__seq;
    __pending.set(id, { resolve, reject });
    __post({ type: "call", id, method, args });
  });
}

function __fmt(args) {
  return args.map((a) => (typeof a === "string" ? a : a instanceof Error ? (a.stack || String(a)) : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
}

const console = {
  log: (...a) => void __post({ type: "log", level: "info", text: __fmt(a) }),
  info: (...a) => void __post({ type: "log", level: "info", text: __fmt(a) }),
  debug: (...a) => void __post({ type: "log", level: "debug", text: __fmt(a) }),
  warn: (...a) => void __post({ type: "log", level: "warn", text: __fmt(a) }),
  error: (...a) => void __post({ type: "log", level: "error", text: __fmt(a) }),
};
self.console = console;

const gear = Object.freeze({
  extension: Object.freeze({ id: __MANIFEST.id, version: __MANIFEST.version, permissions: Object.freeze([...__MANIFEST.permissions]) }),
  log: (...a) => console.log(...a),
  commands: Object.freeze({
    register(id, handler) {
      if (typeof handler !== "function") throw new TypeError("handler must be a function");
      __commands.set(id, handler);
      __call("commands.register", id).catch((e) => console.error(String(e && e.message || e)));
      return { dispose: () => __commands.delete(id) };
    },
    execute: (id, ...args) => __call("commands.execute", id, ...args),
  }),
  window: Object.freeze({
    showInformation: (message, ...actions) => __call("window.showMessage", "info", String(message), actions),
    showWarning: (message, ...actions) => __call("window.showMessage", "warning", String(message), actions),
    showError: (message, ...actions) => __call("window.showMessage", "error", String(message), actions),
    quickPick: (items, options) => __call("window.quickPick", items, options || {}),
    inputBox: (options) => __call("window.inputBox", options || {}),
    setStatus: (text, options) => __call("window.setStatus", text == null ? null : String(text), options || {}),
    openFile: (path, line) => __call("window.openFile", path, line ?? null),
  }),
  editor: Object.freeze({
    active: () => __call("editor.active"),
    replaceSelection: (text) => __call("editor.replaceSelection", String(text)),
    insert: (text) => __call("editor.insert", String(text)),
    setText: (text) => __call("editor.setText", String(text)),
  }),
  workspace: Object.freeze({
    root: () => __call("workspace.root"),
    readFile: (path) => __call("workspace.readFile", path),
    writeFile: (path, text) => __call("workspace.writeFile", path, String(text)),
    findFiles: (glob, max) => __call("workspace.findFiles", glob, max ?? 500),
  }),
  terminal: Object.freeze({ run: (command, options) => __call("terminal.run", String(command), options || {}) }),
  shell: Object.freeze({ exec: (command, options) => __call("shell.exec", String(command), options || {}) }),
  clipboard: Object.freeze({ read: () => __call("clipboard.read"), write: (text) => __call("clipboard.write", String(text)) }),
  config: Object.freeze({ get: (key) => __call("config.get", key) }),
  storage: Object.freeze({ get: (key) => __call("storage.get", key), set: (key, value) => __call("storage.set", key, value) }),
  events: Object.freeze({
    on(name, cb) {
      (__listeners[name] || (__listeners[name] = [])).push(cb);
      return { dispose: () => { __listeners[name] = (__listeners[name] || []).filter((x) => x !== cb); } };
    },
  }),
});

if (!__MANIFEST.permissions.includes("network")) {
  const deny = () => { throw new Error('Network access needs the "network" permission'); };
  self.fetch = () => Promise.reject(new Error('Network access needs the "network" permission'));
  for (const k of ["XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "Worker", "SharedWorker"]) { try { Object.defineProperty(self, k, { get: deny, configurable: false }); } catch {} }
}
self.importScripts = () => { throw new Error("importScripts is disabled; use require()"); };

const __cache = Object.create(null);
function __norm(p) {
  const out = [];
  for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") out.pop(); else out.push(s); }
  return out.join("/");
}
function __dir(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
function __resolve(from, spec) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) throw new Error("Cannot require " + JSON.stringify(spec) + ": only files inside the extension can be required");
  const base = __norm((__dir(from) ? __dir(from) + "/" : "") + spec);
  for (const c of [base, base + ".js", base + ".json", base + "/index.js"]) if (c in __DEFS) return c;
  throw new Error("Cannot find module " + JSON.stringify(spec) + " from " + from);
}
function __load(path) {
  if (__cache[path]) return __cache[path].exports;
  const module = { exports: {} };
  __cache[path] = module;
  __DEFS[path](module, module.exports, (spec) => __load(__resolve(path, spec)), gear, console);
  return module.exports;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "result") {
    const p = __pending.get(m.id);
    if (!p) return;
    __pending.delete(m.id);
    if (m.error !== undefined) p.reject(new Error(m.error)); else p.resolve(m.value);
  } else if (m.type === "invoke") {
    const fn = __commands.get(m.command);
    try {
      if (!fn) throw new Error("Command " + m.command + " isn't registered (call gear.commands.register in activate)");
      const v = await fn(...(m.args || []));
      __post({ type: "invokeResult", id: m.id, value: v === undefined ? null : v });
    } catch (err) {
      console.error(err);
      __post({ type: "invokeResult", id: m.id, error: String((err && err.message) || err) });
    }
  } else if (m.type === "event") {
    for (const cb of (__listeners[m.name] || []).slice()) {
      try { await cb(m.payload); } catch (err) { console.error("in " + m.name + " listener:", err); }
    }
  } else if (m.type === "activate") {
    try {
      __exports = __load(__MAIN);
      if (__exports && typeof __exports.activate === "function") await __exports.activate(gear);
      __post({ type: "activated" });
    } catch (err) {
      __post({ type: "activated", error: String((err && err.stack) || err) });
    }
  } else if (m.type === "deactivate") {
    try { if (__exports && typeof __exports.deactivate === "function") await __exports.deactivate(); } catch (err) { console.error(err); }
    __post({ type: "deactivated" });
  }
};
self.addEventListener("unhandledrejection", (e) => { console.error("Unhandled rejection:", e.reason); });
`;

/** The complete worker script for one extension. */
export function workerSource(manifest: ExtensionManifest, modules: ModuleMap): string {
  const main = manifest.main.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!(main in modules)) throw new Error(`The main file ${manifest.main} is missing`);
  const defs = Object.entries(modules)
    .map(([p, s]) => wrap(p, s))
    .join(",\n");
  const meta = JSON.stringify({ id: manifest.id, version: manifest.version, permissions: manifest.permissions });
  return `"use strict";\n// gear extension host protocol v${PROTOCOL_VERSION}\nconst __MANIFEST = ${meta};\nconst __MAIN = ${JSON.stringify(main)};\nconst __DEFS = {\n${defs}\n};\n${RUNTIME}`;
}
