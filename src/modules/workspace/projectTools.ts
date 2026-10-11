// Pure helpers for project tools: dependency updates, file templates, README
// and changelog generation, version bumps, file trees and token estimates.

export interface Outdated {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  kind: "patch" | "minor" | "major" | "unknown";
}

function bumpKind(current: string, latest: string): Outdated["kind"] {
  const a = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  const b = /^(\d+)\.(\d+)\.(\d+)/.exec(latest);
  if (!a || !b) return "unknown";
  if (a[1] !== b[1]) return "major";
  if (a[2] !== b[2]) return "minor";
  return "patch";
}

/** `npm outdated --json` / `pnpm outdated --format json`. */
export function parseNpmOutdated(json: string): Outdated[] {
  if (!json.trim()) return [];
  const data = JSON.parse(json) as Record<string, { current?: string; wanted?: string; latest?: string }> | { packageName: string; current: string; wanted: string; latest: string }[];
  const rows = Array.isArray(data) ? data.map((d) => [d.packageName, d] as const) : Object.entries(data);
  return rows
    .map(([name, d]) => ({ name, current: d.current ?? "missing", wanted: d.wanted ?? "", latest: d.latest ?? "", kind: bumpKind(d.current ?? "0.0.0", d.latest ?? "") }))
    .sort((x, y) => ["major", "minor", "patch", "unknown"].indexOf(x.kind) - ["major", "minor", "patch", "unknown"].indexOf(y.kind) || x.name.localeCompare(y.name));
}

/** `pip list --outdated --format=json`. */
export function parsePipOutdated(json: string): Outdated[] {
  const data = JSON.parse(json || "[]") as { name: string; version: string; latest_version: string }[];
  return data.map((d) => ({ name: d.name, current: d.version, wanted: d.latest_version, latest: d.latest_version, kind: bumpKind(d.version, d.latest_version) }));
}

// ── file templates ────────────────────────────────────────────────────────

export interface FileTemplate {
  id: string;
  label: string;
  /** Suggested file name; {name} is replaced by the user's name. */
  file: string;
  body: (name: string) => string;
}

const pascal = (s: string) => s.replace(/(^|[-_\s.]+)(\w)/g, (_m, _a, c: string) => c.toUpperCase());
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();

export const FILE_TEMPLATES: FileTemplate[] = [
  { id: "react", label: "React component (TSX)", file: "{Name}.tsx", body: (n) => `interface ${pascal(n)}Props {\n  className?: string;\n}\n\nexport function ${pascal(n)}({ className }: ${pascal(n)}Props) {\n  return <div className={className}>${pascal(n)}</div>;\n}\n` },
  { id: "hook", label: "React hook", file: "use{Name}.ts", body: (n) => `import { useEffect, useState } from "react";\n\nexport function use${pascal(n)}() {\n  const [value, setValue] = useState<unknown>(null);\n\n  useEffect(() => {\n    // subscribe / fetch here\n  }, []);\n\n  return { value, setValue };\n}\n` },
  { id: "vitest", label: "Vitest / Jest test", file: "{name}.test.ts", body: (n) => `import { describe, expect, it } from "vitest";\nimport { ${n.replace(/\W/g, "")} } from "./${n}";\n\ndescribe("${n}", () => {\n  it("works", () => {\n    expect(${n.replace(/\W/g, "")}).toBeDefined();\n  });\n});\n` },
  { id: "pytest", label: "pytest test module", file: "test_{name}.py", body: (n) => `import pytest\n\nfrom ${n.replace(/\W/g, "_")} import *  # noqa: F403\n\n\ndef test_${n.replace(/\W/g, "_")}_works():\n    assert True\n` },
  { id: "pyscript", label: "Python CLI script", file: "{name}.py", body: () => `#!/usr/bin/env python3\n"""Describe what this script does."""\n\nimport argparse\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description=__doc__)\n    parser.add_argument("path")\n    args = parser.parse_args()\n    print(args.path)\n\n\nif __name__ == "__main__":\n    main()\n` },
  { id: "bash", label: "Bash script (strict mode)", file: "{name}.sh", body: () => `#!/usr/bin/env bash\nset -euo pipefail\n\nusage() {\n  echo "usage: $(basename "$0") <arg>" >&2\n  exit 2\n}\n\n[ $# -ge 1 ] || usage\n\nmain() {\n  echo "$1"\n}\n\nmain "$@"\n` },
  { id: "dockerfile-node", label: "Dockerfile (Node, multi-stage)", file: "Dockerfile", body: () => `FROM node:20-alpine AS deps\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\n\nFROM node:20-alpine AS build\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN npm run build\n\nFROM node:20-alpine\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=build /app/dist ./dist\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY package.json ./\nUSER node\nEXPOSE 3000\nCMD ["node", "dist/index.js"]\n` },
  { id: "dockerfile-python", label: "Dockerfile (Python)", file: "Dockerfile", body: () => `FROM python:3.12-slim\nENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nRUN useradd -m app\nUSER app\nCMD ["python", "-m", "app"]\n` },
  { id: "compose", label: "docker-compose.yml (app + Postgres)", file: "docker-compose.yml", body: () => `services:\n  app:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      DATABASE_URL: postgres://app:app@db:5432/app\n    depends_on:\n      - db\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_USER: app\n      POSTGRES_PASSWORD: app\n      POSTGRES_DB: app\n    volumes:\n      - db-data:/var/lib/postgresql/data\nvolumes:\n  db-data:\n` },
  { id: "gha-node", label: "GitHub Actions CI (Node)", file: ".github/workflows/ci.yml", body: () => `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n          cache: npm\n      - run: npm ci\n      - run: npm test\n` },
  { id: "gha-python", label: "GitHub Actions CI (Python)", file: ".github/workflows/ci.yml", body: () => `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        python: ["3.11", "3.12"]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: \${{ matrix.python }}\n          cache: pip\n      - run: pip install -r requirements.txt\n      - run: pytest\n` },
  { id: "gha-rust", label: "GitHub Actions CI (Rust)", file: ".github/workflows/ci.yml", body: () => `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: dtolnay/rust-toolchain@stable\n        with:\n          components: clippy, rustfmt\n      - uses: Swatinem/rust-cache@v2\n      - run: cargo fmt --check\n      - run: cargo clippy --all-targets -- -D warnings\n      - run: cargo test\n` },
  { id: "makefile", label: "Makefile (self-documenting)", file: "Makefile", body: () => `.DEFAULT_GOAL := help\n.PHONY: help build test lint\n\nhelp: ## Show this help\n\t@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\\n", $$1, $$2}'\n\nbuild: ## Build the project\n\t@echo build\n\ntest: ## Run the tests\n\t@echo test\n\nlint: ## Lint the code\n\t@echo lint\n` },
  { id: "editorconfig", label: ".editorconfig", file: ".editorconfig", body: () => `root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\nindent_style = space\nindent_size = 2\n\n[*.{py,rs,go}]\nindent_size = 4\n\n[Makefile]\nindent_style = tab\n\n[*.md]\ntrim_trailing_whitespace = false\n` },
  { id: "prettierrc", label: ".prettierrc", file: ".prettierrc", body: () => `{\n  "printWidth": 100,\n  "singleQuote": false,\n  "trailingComma": "all",\n  "semi": true\n}\n` },
  { id: "tsconfig", label: "tsconfig.json (strict)", file: "tsconfig.json", body: () => `{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "strict": true,\n    "noUncheckedIndexedAccess": true,\n    "esModuleInterop": true,\n    "skipLibCheck": true,\n    "outDir": "dist"\n  },\n  "include": ["src"]\n}\n` },
  { id: "dependabot", label: "Dependabot config", file: ".github/dependabot.yml", body: () => `version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    schedule:\n      interval: weekly\n  - package-ecosystem: github-actions\n    directory: /\n    schedule:\n      interval: weekly\n` },
  { id: "issue-bug", label: "GitHub bug report template", file: ".github/ISSUE_TEMPLATE/bug_report.md", body: () => `---\nname: Bug report\nabout: Something isn't working\nlabels: bug\n---\n\n**What happened**\n\n**Steps to reproduce**\n1.\n2.\n\n**Expected**\n\n**Environment** (OS, version)\n` },
  { id: "pr-template", label: "Pull request template", file: ".github/pull_request_template.md", body: () => `## What\n\n## Why\n\n## How tested\n\n- [ ] Tests added / updated\n- [ ] Docs updated\n` },
];

export function templateFileName(t: FileTemplate, name: string): string {
  return t.file.replace("{Name}", pascal(name)).replace("{name}", kebab(name));
}

// ── README & changelog ────────────────────────────────────────────────────

export interface ProjectInfo {
  name: string;
  description?: string;
  license?: string;
  scripts?: Record<string, string>;
  kind: "node" | "rust" | "python" | "go" | "other";
  repository?: string;
}

export function readmeFor(p: ProjectInfo): string {
  const install: Record<ProjectInfo["kind"], string> = {
    node: "npm install",
    rust: "cargo build --release",
    python: "pip install -e .",
    go: `go install ./...`,
    other: "# see the docs",
  };
  const run: Record<ProjectInfo["kind"], string> = {
    node: p.scripts?.dev ? "npm run dev" : p.scripts?.start ? "npm start" : "node .",
    rust: `cargo run`,
    python: `python -m ${p.name.replace(/-/g, "_")}`,
    go: "go run .",
    other: "",
  };
  const scripts = p.scripts && Object.keys(p.scripts).length
    ? `\n## Scripts\n\n| Command | What it does |\n| --- | --- |\n${Object.entries(p.scripts).map(([k, v]) => `| \`npm run ${k}\` | \`${v.replace(/\|/g, "\\|")}\` |`).join("\n")}\n`
    : "";
  return `# ${p.name}

${p.description ?? "One-paragraph description of what this project does and who it is for."}

## Getting started

\`\`\`bash
${p.repository ? `git clone ${p.repository}\ncd ${p.name}\n` : ""}${install[p.kind]}
${run[p.kind]}
\`\`\`
${scripts}
## Usage

Describe the main ways to use the project, with an example.

## Contributing

Issues and pull requests are welcome. Please run the tests before opening a PR.

## License

${p.license ? `${p.license}. See [LICENSE](LICENSE).` : "Add a license (see “Workspace: Add LICENSE file”)."}
`;
}

const CHANGELOG_SECTIONS: [RegExp, string][] = [
  [/^feat/, "Features"],
  [/^fix/, "Bug fixes"],
  [/^perf/, "Performance"],
  [/^refactor/, "Refactoring"],
  [/^docs/, "Documentation"],
  [/^(build|ci|chore|style|test)/, "Maintenance"],
];

/** Markdown changelog section from commit subjects (conventional ones grouped). */
export function changelogFrom(version: string, subjects: { subject: string; short: string }[], date = new Date()): string {
  const groups = new Map<string, string[]>();
  const breaking: string[] = [];
  for (const { subject, short } of subjects) {
    if (/^Merge (pull request|branch)/.test(subject)) continue;
    const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
    const section = m ? (CHANGELOG_SECTIONS.find(([re]) => re.test(m[1]))?.[1] ?? "Other") : "Other";
    const text = m ? `${m[2] ? `**${m[2]}:** ` : ""}${m[4]}` : subject;
    const line = `- ${text} (${short})`;
    if (m?.[3]) breaking.push(line);
    groups.set(section, [...(groups.get(section) ?? []), line]);
  }
  const order = ["Features", "Bug fixes", "Performance", "Refactoring", "Documentation", "Maintenance", "Other"];
  const parts = [`## ${version} (${date.toISOString().slice(0, 10)})`];
  if (breaking.length) parts.push(`### ⚠ Breaking changes\n\n${breaking.join("\n")}`);
  for (const s of order) if (groups.has(s)) parts.push(`### ${s}\n\n${groups.get(s)!.join("\n")}`);
  return `${parts.join("\n\n")}\n`;
}

// ── versions ──────────────────────────────────────────────────────────────

export function nextVersion(v: string, level: "patch" | "minor" | "major" | "prerelease"): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(v);
  if (!m) throw new Error(`"${v}" is not a semantic version`);
  let [ma, mi, pa] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === "prerelease") {
    if (m[4]) {
      const pm = /^(.*?)(\d+)$/.exec(m[4]);
      return `${ma}.${mi}.${pa}-${pm ? `${pm[1]}${Number(pm[2]) + 1}` : `${m[4]}.1`}`;
    }
    return `${ma}.${mi}.${pa + 1}-rc.0`;
  }
  if (level === "major") [ma, mi, pa] = [ma + 1, 0, 0];
  else if (level === "minor") [mi, pa] = [mi + 1, 0];
  else pa = m[4] ? pa : pa + 1;
  return `${ma}.${mi}.${pa}`;
}

/** Replace the project version in package.json / Cargo.toml / pyproject.toml text. */
export function setManifestVersion(file: string, content: string, version: string): { content: string; old: string } | null {
  if (/package\.json$/.test(file)) {
    const m = /("version"\s*:\s*")([^"]+)(")/.exec(content);
    return m ? { old: m[2], content: content.replace(m[0], `${m[1]}${version}${m[3]}`) } : null;
  }
  // First `version = "…"` inside [package] / [project] / [tool.poetry].
  const section = /^\[(package|project|tool\.poetry|workspace\.package)\]\s*$/m.exec(content);
  if (!section) return null;
  const rest = content.slice(section.index);
  const end = rest.slice(1).search(/^\[/m);
  const block = end < 0 ? rest : rest.slice(0, end + 1);
  const m = /^(version\s*=\s*")([^"]+)(")/m.exec(block);
  if (!m) return null;
  const at = section.index + m.index!;
  return { old: m[2], content: content.slice(0, at) + `${m[1]}${version}${m[3]}` + content.slice(at + m[0].length) };
}

// ── trees & tokens ────────────────────────────────────────────────────────

/** `tree`-style rendering of relative paths. */
export function renderTree(paths: string[], rootName = "."): string {
  type Node = Map<string, Node>;
  const root: Node = new Map();
  for (const p of paths) {
    let cur = root;
    for (const part of p.replace(/\\/g, "/").split("/").filter(Boolean)) {
      if (!cur.has(part)) cur.set(part, new Map());
      cur = cur.get(part)!;
    }
  }
  const lines = [rootName];
  const walk = (node: Node, prefix: string) => {
    const entries = [...node.entries()].sort(([a, x], [b, y]) => Number(y.size > 0) - Number(x.size > 0) || a.localeCompare(b));
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      lines.push(`${prefix}${last ? "└── " : "├── "}${name}${child.size ? "/" : ""}`);
      walk(child, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(root, "");
  return lines.join("\n") + "\n";
}

/** Rough LLM token estimate (≈4 chars/token for prose, denser for code/CJK). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? []).length;
  const symbols = (text.match(/[{}()[\];,.<>=+\-*/&|!?:"'`]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.1 + rest / 4 + symbols * 0.15);
}
