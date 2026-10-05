// Launch configurations: the adapters Gear knows how to start, VS Code
// `.vscode/launch.json` compatibility (types, ${variables}, JSONC), and
// zero-config defaults for the active file.

export type AdapterKind = "python" | "node" | "go" | "lldb" | "gdb" | "codelldb";

export interface AdapterSpec {
  kind: AdapterKind;
  label: string;
  transport: "stdio" | "tcp";
  /** Candidate executables, first found wins. */
  commands: string[];
  args: string[];
  /** `adapterID` sent in initialize. */
  adapterId: string;
  install: string;
}

export const ADAPTERS: Record<AdapterKind, AdapterSpec> = {
  python: { kind: "python", label: "Python (debugpy)", transport: "stdio", commands: ["python3", "python", "py"], args: ["-m", "debugpy.adapter"], adapterId: "python", install: "pip install debugpy" },
  node: { kind: "node", label: "Node.js (js-debug)", transport: "tcp", commands: ["node"], args: ["{jsDebug}", "{port}", "127.0.0.1"], adapterId: "pwa-node", install: "Download js-debug-dap from github.com/microsoft/vscode-js-debug/releases and set Debug › js-debug path in settings" },
  go: { kind: "go", label: "Go (Delve)", transport: "tcp", commands: ["dlv"], args: ["dap", "--listen=127.0.0.1:{port}"], adapterId: "go", install: "go install github.com/go-delve/delve/cmd/dlv@latest" },
  lldb: { kind: "lldb", label: "C / C++ / Rust (lldb-dap)", transport: "stdio", commands: ["lldb-dap", "lldb-vscode", "lldb-dap-18", "lldb-dap-19", "lldb-dap-20"], args: [], adapterId: "lldb-dap", install: "Install LLVM (lldb-dap ships with it)" },
  gdb: { kind: "gdb", label: "C / C++ / Rust (gdb ≥ 14)", transport: "stdio", commands: ["gdb"], args: ["-q", "-i", "dap"], adapterId: "gdb", install: "Install gdb 14 or newer" },
  codelldb: { kind: "codelldb", label: "C / C++ / Rust (CodeLLDB)", transport: "tcp", commands: ["codelldb"], args: ["--port", "{port}"], adapterId: "lldb", install: "Install CodeLLDB and put codelldb on PATH" },
};

export interface LaunchConfig {
  name: string;
  type: string;
  request: "launch" | "attach";
  [key: string]: unknown;
}

export interface ResolvedConfig {
  name: string;
  adapter: AdapterKind;
  request: "launch" | "attach";
  /** Arguments passed through to the adapter's launch/attach request. */
  args: Record<string, unknown>;
  cwd: string;
  /** Command to run first (VS Code `preLaunchTask` isn't supported; this is Gear's `preLaunchCommand`). */
  preLaunch?: string;
}

export interface VarContext {
  workspaceFolder: string;
  file?: string;
  env?: Record<string, string | undefined>;
  pathSep?: string;
}

/** Expand ${workspaceFolder}, ${file}, ${fileDirname}, ${env:X}, … recursively through a value. */
export function substitute<T>(value: T, ctx: VarContext): T {
  const file = (ctx.file ?? "").replace(/\\/g, "/");
  const dir = file.replace(/\/[^/]*$/, "");
  const base = file.replace(/^.*\//, "");
  const root = ctx.workspaceFolder.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
  const vars: Record<string, string> = {
    workspaceFolder: root,
    workspaceRoot: root,
    workspaceFolderBasename: root.replace(/^.*\//, ""),
    file,
    fileDirname: dir,
    fileBasename: base,
    fileBasenameNoExtension: base.replace(/\.[^.]*$/, ""),
    fileExtname: /\.[^.]*$/.exec(base)?.[0] ?? "",
    relativeFile: rel,
    relativeFileDirname: rel.replace(/\/[^/]*$/, ""),
    cwd: root,
    pathSeparator: ctx.pathSep ?? "/",
    "/": ctx.pathSep ?? "/",
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string")
      return v.replace(/\$\{([^}]+)\}/g, (m, k: string) => {
        if (k.startsWith("env:")) return ctx.env?.[k.slice(4)] ?? "";
        if (k.startsWith("workspaceFolder:")) return root;
        return vars[k] ?? m;
      });
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Which adapter serves a VS Code configuration `type`. */
export function adapterFor(type: string, available: (k: AdapterKind) => boolean = () => true): AdapterKind | null {
  switch (type) {
    case "python":
    case "debugpy":
      return "python";
    case "node":
    case "pwa-node":
    case "node-terminal":
    case "pwa-chrome":
    case "chrome":
    case "pwa-msedge":
      return "node";
    case "go":
      return "go";
    case "lldb": // CodeLLDB's type
      return available("codelldb") ? "codelldb" : available("lldb") ? "lldb" : "gdb";
    case "lldb-dap":
    case "lldb-vscode":
      return "lldb";
    case "gdb":
      return "gdb";
    case "cppdbg":
    case "cppvsdbg":
    case "rust":
      return available("lldb") ? "lldb" : available("gdb") ? "gdb" : "codelldb";
    default:
      return null;
  }
}

/** Translate a VS Code configuration into what Gear's adapter expects. */
export function resolveConfig(cfg: LaunchConfig, ctx: VarContext, available?: (k: AdapterKind) => boolean): ResolvedConfig {
  const c = substitute(cfg, ctx);
  const adapter = adapterFor(c.type, available);
  if (!adapter) throw new Error(`Unsupported debug type "${c.type}" in "${c.name}"`);
  const { name, type, request, preLaunchTask, postDebugTask, presentation, internalConsoleOptions, preLaunchCommand, ...rest } = c as LaunchConfig & Record<string, unknown>;
  void type;
  void preLaunchTask;
  void postDebugTask;
  void presentation;
  void internalConsoleOptions;
  const args: Record<string, unknown> = { ...rest };
  // cppdbg uses `environment: [{name, value}]`, the others `env: {}`.
  if (Array.isArray(args.environment)) {
    args.env = Object.fromEntries((args.environment as { name: string; value: string }[]).map((e) => [e.name, e.value]));
    delete args.environment;
  }
  if (adapter === "python" && args.module === undefined && args.program === undefined && request === "launch") args.program = ctx.file;
  if (adapter === "python") args.console ??= "internalConsole";
  if (adapter === "node") {
    args.type = c.type === "node" || c.type === "node-terminal" ? "pwa-node" : c.type;
    args.console ??= "internalConsole";
  }
  if (adapter === "go") args.mode ??= request === "launch" ? "debug" : "local";
  if ((adapter === "lldb" || adapter === "gdb") && c.type === "cppdbg") {
    delete args.MIMode;
    delete args.miDebuggerPath;
    delete args.setupCommands;
    delete args.externalConsole;
    delete args.stopAtEntry;
  }
  const cwd = typeof args.cwd === "string" && args.cwd ? args.cwd : ctx.workspaceFolder;
  return { name: String(name), adapter, request: request === "attach" ? "attach" : "launch", args, cwd, preLaunch: typeof preLaunchCommand === "string" ? preLaunchCommand : undefined };
}

/** Parse launch.json (JSONC: comments and trailing commas allowed). */
export function parseLaunchJson(text: string): LaunchConfig[] {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
    } else if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      i = i < 0 ? text.length : i + 2;
    } else {
      out += c;
      i++;
    }
  }
  const json = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as { configurations?: LaunchConfig[] };
  return (json.configurations ?? []).filter((c) => c && typeof c.name === "string" && typeof c.type === "string");
}

/** A zero-config launch configuration for the active file. */
export function defaultConfigFor(file: string, opts: { cargoBinary?: string; program?: string } = {}): LaunchConfig | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  switch (ext) {
    case "py":
      return { name: "Python: current file", type: "python", request: "launch", program: "${file}", cwd: "${workspaceFolder}", justMyCode: true };
    case "js":
    case "mjs":
    case "cjs":
      return { name: "Node: current file", type: "node", request: "launch", program: "${file}", cwd: "${workspaceFolder}", skipFiles: ["<node_internals>/**"] };
    case "ts":
    case "mts":
      return { name: "Node: current file (tsx)", type: "node", request: "launch", program: "${file}", runtimeExecutable: "npx", runtimeArgs: ["--yes", "tsx"], cwd: "${workspaceFolder}", skipFiles: ["<node_internals>/**", "**/node_modules/**"] };
    case "go":
      return { name: "Go: debug package", type: "go", request: "launch", mode: "debug", program: "${fileDirname}" };
    case "rs":
      return opts.cargoBinary ? { name: "Rust: debug binary", type: "rust", request: "launch", program: opts.cargoBinary, cwd: "${workspaceFolder}", preLaunchCommand: "cargo build" } : null;
    case "c":
    case "cc":
    case "cpp":
    case "cxx":
      return opts.program ? { name: "C/C++: debug program", type: "cppdbg", request: "launch", program: opts.program, cwd: "${workspaceFolder}" } : null;
    default:
      return null;
  }
}

/** Binary name from Cargo.toml ([[bin]] name, else [package] name). */
export function cargoBinaryName(cargoToml: string): string | null {
  const bin = /\[\[bin\]\][^[]*?name\s*=\s*"([^"]+)"/.exec(cargoToml);
  if (bin) return bin[1];
  const pkg = /\[package\][^[]*?name\s*=\s*"([^"]+)"/.exec(cargoToml);
  return pkg?.[1] ?? null;
}

export const LAUNCH_JSON_TEMPLATE = `{
  // Debug configurations (VS Code compatible). Gear supports the python,
  // node, go, lldb (CodeLLDB), lldb-dap, gdb and cppdbg types.
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: current file",
      "type": "python",
      "request": "launch",
      "program": "\${file}",
      "justMyCode": true
    },
    {
      "name": "Node: current file",
      "type": "node",
      "request": "launch",
      "program": "\${file}",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Go: debug package",
      "type": "go",
      "request": "launch",
      "mode": "debug",
      "program": "\${fileDirname}"
    }
  ]
}
`;
