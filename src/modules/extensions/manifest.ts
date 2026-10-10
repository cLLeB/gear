// Extension manifests (gear-extension.json), permissions, and the rules the
// host enforces for every API call an extension makes.

export type Permission = "editor.read" | "editor.write" | "fs.read" | "fs.write" | "fs.any" | "shell" | "network" | "clipboard";

export const PERMISSIONS: Record<Permission, string> = {
  "editor.read": "Read the active editor's text and selection",
  "editor.write": "Change text in the active editor",
  "fs.read": "Read files in the workspace",
  "fs.write": "Create and change files in the workspace",
  "fs.any": "Read / write files outside the workspace",
  shell: "Run commands on this computer",
  network: "Make network requests",
  clipboard: "Read and write the clipboard",
};

export interface CommandContribution {
  id: string;
  title: string;
}

export interface ConfigContribution {
  type: "string" | "number" | "boolean";
  default: string | number | boolean;
  description?: string;
  enum?: (string | number)[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  permissions: Permission[];
  activationEvents: string[];
  contributes: {
    commands: CommandContribution[];
    configuration: Record<string, ConfigContribution>;
  };
}

/** Validate and normalize a manifest; throws with every problem found. */
export function parseManifest(text: string): ExtensionManifest {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`gear-extension.json isn't valid JSON: ${(e as Error).message}`);
  }
  const problems: string[] = [];
  const str = (k: string, required = true) => {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (required) problems.push(`"${k}" must be a non-empty string`);
    return undefined;
  };
  const id = str("id");
  if (id && !/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/.test(id)) problems.push(`"id" must look like "publisher.name" (lowercase letters, digits, dashes)`);
  const version = str("version");
  if (version && !/^\d+\.\d+\.\d+([-+].*)?$/.test(version)) problems.push(`"version" must be semver (1.2.3)`);
  const main = str("main", false) ?? "main.js";
  if (/(^|[\\/])\.\.([\\/]|$)/.test(main) || /^([\\/]|[A-Za-z]:)/.test(main)) problems.push(`"main" must be a path inside the extension folder`);
  const permissions = Array.isArray(raw.permissions) ? (raw.permissions as unknown[]) : [];
  for (const p of permissions) if (typeof p !== "string" || !(p in PERMISSIONS)) problems.push(`unknown permission ${JSON.stringify(p)}`);
  const contributes = (raw.contributes ?? {}) as { commands?: unknown; configuration?: unknown };
  const commands: CommandContribution[] = [];
  for (const c of Array.isArray(contributes.commands) ? contributes.commands : []) {
    const cc = c as Partial<CommandContribution>;
    if (typeof cc.id !== "string" || typeof cc.title !== "string") problems.push("each command needs an id and a title");
    else commands.push({ id: cc.id, title: cc.title });
  }
  const configuration: Record<string, ConfigContribution> = {};
  for (const [k, v] of Object.entries((contributes.configuration ?? {}) as Record<string, Partial<ConfigContribution>>)) {
    if (!v || !["string", "number", "boolean"].includes(v.type as string) || typeof v.default !== v.type) problems.push(`configuration "${k}" needs a type (string / number / boolean) and a default of that type`);
    else configuration[k] = v as ConfigContribution;
  }
  const activationEvents = Array.isArray(raw.activationEvents) ? (raw.activationEvents as unknown[]).filter((e): e is string => typeof e === "string") : ["onStartup"];
  if (problems.length) throw new Error(problems.join("\n"));
  return {
    id: id!,
    name: str("name", false) ?? id!,
    version: version!,
    description: str("description", false),
    author: str("author", false),
    main,
    permissions: [...new Set(permissions as Permission[])],
    activationEvents,
    contributes: { commands, configuration },
  };
}

/** Does `event` (e.g. "onCommand:x.run", "onLanguage:python", "onStartup") activate this extension? */
export function activatesOn(m: ExtensionManifest, event: string): boolean {
  return m.activationEvents.some((e) => e === "*" || e === event || (e === "onStartup" && event === "onStartup"));
}

/** Permission each API method needs (null: always allowed). */
export const METHOD_PERMISSION: Record<string, Permission | null> = {
  "window.showMessage": null,
  "window.quickPick": null,
  "window.inputBox": null,
  "window.setStatus": null,
  "window.openFile": null,
  "commands.register": null,
  "commands.execute": null,
  "workspace.root": null,
  "config.get": null,
  "storage.get": null,
  "storage.set": null,
  log: null,
  "editor.active": "editor.read",
  "editor.replaceSelection": "editor.write",
  "editor.insert": "editor.write",
  "editor.setText": "editor.write",
  "workspace.readFile": "fs.read",
  "workspace.findFiles": "fs.read",
  "workspace.writeFile": "fs.write",
  "terminal.run": "shell",
  "shell.exec": "shell",
  "clipboard.read": "clipboard",
  "clipboard.write": "clipboard",
  fetch: "network",
};

function norm(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const drive = /^[A-Za-z]:/.test(parts[0] ?? "") ? "" : "/";
  return drive + parts.join("/");
}

/** Resolve a path an extension passed (relative to the workspace) and check it may touch it. */
export function resolveExtensionPath(path: string, root: string | null, perms: readonly Permission[]): string {
  const abs = /^([A-Za-z]:[\\/]|[\\/])/.test(path) ? norm(path) : root ? norm(`${root}/${path}`) : null;
  if (!abs) throw new Error("No workspace folder is open");
  if (perms.includes("fs.any")) return abs;
  const r = root ? norm(root) : null;
  if (!r || (abs !== r && !abs.toLowerCase().startsWith(`${r.toLowerCase()}/`))) throw new Error(`${path} is outside the workspace (needs the "fs.any" permission)`);
  return abs;
}

/** Check a call; returns an error message or null. */
export function checkCall(m: ExtensionManifest, method: string, args: unknown[]): string | null {
  if (!(method in METHOD_PERMISSION)) return `Unknown API ${method}`;
  const need = METHOD_PERMISSION[method];
  if (need && !m.permissions.includes(need)) return `${method} needs the "${need}" permission in gear-extension.json`;
  if (method === "commands.register") {
    const id = args[0];
    if (!m.contributes.commands.some((c) => c.id === id)) return `Command ${String(id)} isn't declared in contributes.commands`;
  }
  return null;
}

/** Compare semver-ish versions: <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
