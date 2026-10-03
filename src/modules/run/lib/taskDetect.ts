// Auto-detect runnable project tasks from the files a project already has —
// VS Code's task auto-detection across ecosystems. Every parser is pure: it
// takes file contents and returns tasks, so detection is fully testable and
// the I/O layer only decides which files to read.

export interface DetectedTask {
  /** What the user sees, e.g. "dev" or "test". */
  label: string;
  /** Shell command that runs it from the project root. */
  command: string;
  /** Tool family: npm, make, just, cargo… */
  source: string;
  /** The underlying definition, for context (script body, recipe deps). */
  detail?: string;
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Lockfile → package manager; `packageManager` field wins when present. */
export function detectPackageManager(files: readonly string[], packageManagerField?: string): PackageManager {
  const field = packageManagerField?.split("@")[0];
  if (field === "pnpm" || field === "yarn" || field === "bun" || field === "npm") return field;
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  return "npm";
}

export function npmTasks(packageJson: string, pm: PackageManager): DetectedTask[] {
  let pkg: { scripts?: Record<string, unknown> };
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    return [];
  }
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  return Object.entries(scripts)
    .filter(([, body]) => typeof body === "string")
    // Lifecycle hooks run implicitly; listing them is noise.
    .filter(([name]) => !/^(pre|post)(install|pack|publish|version|prepare|test|build)$/.test(name))
    .map(([name, body]) => ({
      label: name,
      command: pm === "npm" ? (name === "test" || name === "start" ? `npm ${name}` : `npm run ${name}`) : `${pm} ${name === "install" ? "run install" : name}`,
      source: pm,
      detail: body as string,
    }));
}

/** Makefile targets declared at column 0, skipping pattern rules and specials. */
export function makeTasks(makefile: string): DetectedTask[] {
  const out: DetectedTask[] = [];
  const seen = new Set<string>();
  const lines = makefile.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9][\w./-]*(?:\s+[A-Za-z0-9][\w./-]*)*)\s*:(?!=)\s*([^=]*)$/.exec(lines[i]);
    if (!m) continue;
    // "## comment" on the line above is a common convention for help text.
    const doc = i > 0 ? /^##?\s*(.+)$/.exec(lines[i - 1])?.[1] : undefined;
    for (const target of m[1].split(/\s+/)) {
      if (seen.has(target) || target.includes("%") || target.startsWith(".")) continue;
      if (/\.(o|a|so|c|h|cpp)$/.test(target)) continue; // file targets
      seen.add(target);
      out.push({ label: target, command: `make ${target}`, source: "make", detail: doc });
    }
  }
  return out;
}

/** justfile recipes (not private `_x` ones or `[private]` ones). */
export function justTasks(justfile: string): DetectedTask[] {
  const out: DetectedTask[] = [];
  const lines = justfile.split("\n");
  let privateNext = false;
  let doc: string | undefined;
  for (const line of lines) {
    if (/^\[private\]/.test(line)) {
      privateNext = true;
      continue;
    }
    const comment = /^#\s*(.+)$/.exec(line);
    if (comment) {
      doc = comment[1];
      continue;
    }
    const m = /^@?([A-Za-z_][\w-]*)((?:\s+[+*$]?[\w-]+(?:=[^:]*)?)*)\s*:(?!=)/.exec(line);
    if (m && !/^\s/.test(line) && !/^(set|export|alias|import|mod)\b/.test(line)) {
      if (!privateNext && !m[1].startsWith("_")) {
        const params = m[2].trim();
        out.push({
          label: m[1],
          command: `just ${m[1]}`,
          source: "just",
          detail: [doc, params ? `params: ${params}` : ""].filter(Boolean).join(" · ") || undefined,
        });
      }
      privateNext = false;
      doc = undefined;
    } else if (line.trim() !== "" && !/^\s/.test(line)) {
      doc = undefined;
    }
  }
  return out;
}

export function denoTasks(denoJson: string): DetectedTask[] {
  try {
    const d = JSON.parse(denoJson) as { tasks?: Record<string, unknown> };
    return Object.entries(d.tasks ?? {}).map(([name, body]) => ({
      label: name,
      command: `deno task ${name}`,
      source: "deno",
      detail: typeof body === "string" ? body : typeof body === "object" && body && "command" in body ? String((body as { command: unknown }).command) : undefined,
    }));
  } catch {
    return [];
  }
}

export function composerTasks(composerJson: string): DetectedTask[] {
  try {
    const c = JSON.parse(composerJson) as { scripts?: Record<string, unknown> };
    return Object.entries(c.scripts ?? {})
      .filter(([name]) => !/^(pre|post)-/.test(name))
      .map(([name, body]) => ({
        label: name,
        command: `composer run-script ${name}`,
        source: "composer",
        detail: Array.isArray(body) ? body.join(" && ") : typeof body === "string" ? body : undefined,
      }));
  } catch {
    return [];
  }
}

/** Taskfile.yml (go-task): top-level keys under `tasks:` with a `desc:`. */
export function taskfileTasks(yaml: string): DetectedTask[] {
  const out: DetectedTask[] = [];
  const lines = yaml.split("\n");
  let inTasks = false;
  let taskIndent = -1;
  let current: DetectedTask | null = null;
  for (const raw of lines) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    if (/^tasks:\s*$/.test(raw)) {
      inTasks = true;
      continue;
    }
    if (!inTasks) continue;
    if (indent === 0) break; // next top-level key
    const key = /^(\s*)([\w:.-]+):\s*(.*)$/.exec(raw);
    if (!key) continue;
    if (taskIndent === -1) taskIndent = indent;
    if (indent === taskIndent) {
      current = { label: key[2], command: `task ${key[2]}`, source: "task" };
      out.push(current);
    } else if (current && key[2] === "desc") {
      current.detail = key[3].replace(/^["']|["']$/g, "");
    } else if (current && key[2] === "internal" && /true/.test(key[3])) {
      out.pop();
      current = null;
    }
  }
  return out;
}

/** pyproject: Poetry/PDM/Hatch scripts and the obvious test runners. */
export function pythonTasks(pyproject: string, files: readonly string[]): DetectedTask[] {
  const out: DetectedTask[] = [];
  const runner = /\[tool\.poetry\]/.test(pyproject)
    ? "poetry run"
    : files.includes("uv.lock")
      ? "uv run"
      : /\[tool\.pdm\]/.test(pyproject)
        ? "pdm run"
        : "";
  const section = (name: string): string[] => {
    const re = new RegExp(String.raw`^\[${name.replace(/\./g, "\\.")}\]\s*$`, "m");
    const m = re.exec(pyproject);
    if (!m) return [];
    const rest = pyproject.slice(m.index + m[0].length);
    const end = rest.search(/^\[/m);
    return (end === -1 ? rest : rest.slice(0, end)).split("\n");
  };
  for (const line of section("tool.pdm.scripts")) {
    const m = /^([\w-]+)\s*=\s*"(.*)"/.exec(line);
    if (m) out.push({ label: m[1], command: `pdm run ${m[1]}`, source: "pdm", detail: m[2] });
  }
  for (const line of [...section("tool.poetry.scripts"), ...section("project.scripts")]) {
    const m = /^([\w-]+)\s*=\s*"(.*)"/.exec(line);
    if (m && !out.some((t) => t.label === m[1])) {
      out.push({ label: m[1], command: runner ? `${runner} ${m[1]}` : m[1], source: "python", detail: m[2] });
    }
  }
  if (/\bpytest\b/.test(pyproject) || files.includes("pytest.ini") || files.includes("conftest.py")) {
    out.push({ label: "pytest", command: `${runner ? `${runner} ` : ""}pytest`, source: "python" });
  }
  return out;
}

export function cargoTasks(cargoToml: string): DetectedTask[] {
  const tasks: DetectedTask[] = [
    { label: "build", command: "cargo build", source: "cargo" },
    { label: "test", command: "cargo test", source: "cargo" },
    { label: "check", command: "cargo check", source: "cargo" },
    { label: "clippy", command: "cargo clippy --all-targets", source: "cargo" },
    { label: "fmt", command: "cargo fmt", source: "cargo" },
  ];
  const isWorkspaceOnly = /^\[workspace\]/m.test(cargoToml) && !/^\[package\]/m.test(cargoToml);
  if (!isWorkspaceOnly) tasks.splice(1, 0, { label: "run", command: "cargo run", source: "cargo" });
  for (const m of cargoToml.matchAll(/\[\[bin\]\][^[]*?name\s*=\s*"([^"]+)"/g)) {
    tasks.push({ label: `run ${m[1]}`, command: `cargo run --bin ${m[1]}`, source: "cargo" });
  }
  return tasks;
}

export function goTasks(): DetectedTask[] {
  return [
    { label: "build", command: "go build ./...", source: "go" },
    { label: "test", command: "go test ./...", source: "go" },
    { label: "vet", command: "go vet ./...", source: "go" },
    { label: "run", command: "go run .", source: "go" },
  ];
}

/** docker compose services (top-level `services:` keys). */
export function composeTasks(yaml: string): DetectedTask[] {
  const out: DetectedTask[] = [{ label: "up", command: "docker compose up", source: "compose" }];
  const lines = yaml.split("\n");
  let inServices = false;
  let indent = -1;
  for (const raw of lines) {
    if (/^\s*(#|$)/.test(raw)) continue;
    if (/^services:\s*$/.test(raw)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    const ind = raw.length - raw.trimStart().length;
    if (ind === 0) break;
    const key = /^\s*([\w.-]+):/.exec(raw);
    if (!key) continue;
    if (indent === -1) indent = ind;
    if (ind === indent) {
      out.push({ label: `up ${key[1]}`, command: `docker compose up ${key[1]}`, source: "compose" });
      out.push({ label: `logs ${key[1]}`, command: `docker compose logs -f ${key[1]}`, source: "compose" });
    }
  }
  out.push({ label: "down", command: "docker compose down", source: "compose" });
  return out;
}

/** Files the detector may read, in priority order. */
export const TASK_FILES = [
  "package.json",
  "Makefile",
  "makefile",
  "GNUmakefile",
  "justfile",
  "Justfile",
  ".justfile",
  "deno.json",
  "deno.jsonc",
  "composer.json",
  "Taskfile.yml",
  "Taskfile.yaml",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
] as const;

/** Run every applicable parser over the files present at the project root. */
export function detectTasks(
  names: readonly string[],
  read: (name: string) => string | null,
): DetectedTask[] {
  const out: DetectedTask[] = [];
  const has = (n: string) => names.includes(n);
  const first = (...ns: string[]) => ns.find(has) ?? null;

  if (has("package.json")) {
    const pkg = read("package.json") ?? "";
    let field: string | undefined;
    try {
      field = (JSON.parse(pkg) as { packageManager?: string }).packageManager;
    } catch {
      field = undefined;
    }
    out.push(...npmTasks(pkg, detectPackageManager(names, field)));
  }
  const make = first("GNUmakefile", "Makefile", "makefile");
  if (make) out.push(...makeTasks(read(make) ?? ""));
  const just = first("justfile", "Justfile", ".justfile");
  if (just) out.push(...justTasks(read(just) ?? ""));
  const deno = first("deno.json", "deno.jsonc");
  if (deno) out.push(...denoTasks(read(deno) ?? ""));
  if (has("composer.json")) out.push(...composerTasks(read("composer.json") ?? ""));
  const taskfile = first("Taskfile.yml", "Taskfile.yaml");
  if (taskfile) out.push(...taskfileTasks(read(taskfile) ?? ""));
  if (has("pyproject.toml")) out.push(...pythonTasks(read("pyproject.toml") ?? "", names));
  if (has("Cargo.toml")) out.push(...cargoTasks(read("Cargo.toml") ?? ""));
  if (has("go.mod")) out.push(...goTasks());
  const compose = first("compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml");
  if (compose) out.push(...composeTasks(read(compose) ?? ""));
  return out;
}
