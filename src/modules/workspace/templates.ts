// .gitignore templates (detected from marker files) and short licence texts.

export interface GitignoreTemplate {
  id: string;
  label: string;
  /** File names whose presence suggests the template. */
  markers: string[];
  body: string;
}

export const GITIGNORE_TEMPLATES: GitignoreTemplate[] = [
  { id: "node", label: "Node / JavaScript", markers: ["package.json"], body: "node_modules/\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n.pnpm-store/\ndist/\nbuild/\ncoverage/\n.next/\n.nuxt/\n.svelte-kit/\n.turbo/\n.vite/\n*.tsbuildinfo\n.eslintcache\n" },
  { id: "python", label: "Python", markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], body: "__pycache__/\n*.py[cod]\n*.egg-info/\n.eggs/\nbuild/\ndist/\n.venv/\nvenv/\n.env\n.pytest_cache/\n.mypy_cache/\n.ruff_cache/\n.coverage\nhtmlcov/\n.ipynb_checkpoints/\n" },
  { id: "rust", label: "Rust", markers: ["Cargo.toml"], body: "target/\n**/*.rs.bk\n" },
  { id: "go", label: "Go", markers: ["go.mod"], body: "*.exe\n*.test\n*.out\n/bin/\ncoverage.txt\n" },
  { id: "java", label: "Java / Kotlin (Gradle, Maven)", markers: ["pom.xml", "build.gradle", "build.gradle.kts"], body: "*.class\n*.jar\n*.war\ntarget/\nbuild/\n.gradle/\nout/\n" },
  { id: "dotnet", label: ".NET", markers: [".csproj", ".sln", ".fsproj"], body: "bin/\nobj/\n*.user\n*.suo\n.vs/\nTestResults/\n" },
  { id: "ruby", label: "Ruby", markers: ["Gemfile"], body: "/.bundle/\n/vendor/bundle\n/log/*\n/tmp/*\n*.gem\ncoverage/\n" },
  { id: "php", label: "PHP / Composer", markers: ["composer.json"], body: "/vendor/\n.phpunit.result.cache\n" },
  { id: "terraform", label: "Terraform", markers: ["main.tf"], body: ".terraform/\n*.tfstate\n*.tfstate.*\ncrash.log\n*.tfvars\n.terraform.lock.hcl\n" },
  { id: "env", label: "Secrets & env files", markers: [".env"], body: ".env\n.env.*\n!.env.example\n*.pem\n*.key\n" },
  { id: "macos", label: "macOS", markers: [], body: ".DS_Store\n.AppleDouble\n.LSOverride\n._*\n" },
  { id: "windows", label: "Windows", markers: [], body: "Thumbs.db\nehthumbs.db\nDesktop.ini\n$RECYCLE.BIN/\n" },
  { id: "editors", label: "Editors (VS Code, JetBrains, Vim)", markers: [], body: ".vscode/*\n!.vscode/settings.json\n!.vscode/extensions.json\n.idea/\n*.swp\n*~\n" },
  { id: "logs", label: "Logs & temp", markers: [], body: "*.log\nlogs/\ntmp/\n*.tmp\n" },
];

export function detectTemplates(fileNames: readonly string[]): string[] {
  const names = new Set(fileNames);
  return GITIGNORE_TEMPLATES.filter((t) => t.markers.some((m) => (m.startsWith(".") && m.length > 4 ? fileNames.some((f) => f.endsWith(m)) : names.has(m)))).map((t) => t.id);
}

/** Merge chosen templates into existing content, skipping lines already present. */
export function mergeGitignore(existing: string, ids: readonly string[]): { content: string; added: number } {
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  let out = existing;
  let added = 0;
  for (const id of ids) {
    const t = GITIGNORE_TEMPLATES.find((x) => x.id === id);
    if (!t) continue;
    const lines = t.body.split("\n").filter((l) => l && !have.has(l));
    if (!lines.length) continue;
    if (out && !out.endsWith("\n")) out += "\n";
    out += `${out ? "\n" : ""}# ${t.label}\n${lines.join("\n")}\n`;
    lines.forEach((l) => have.add(l));
    added += lines.length;
  }
  return { content: out, added };
}

export const LICENSES: Record<string, { label: string; text: (year: string, holder: string) => string }> = {
  MIT: {
    label: "MIT",
    text: (y, h) => `MIT License

Copyright (c) ${y} ${h}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
  ISC: {
    label: "ISC",
    text: (y, h) => `ISC License

Copyright (c) ${y} ${h}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`,
  },
  "BSD-2-Clause": {
    label: "BSD 2-Clause",
    text: (y, h) => `BSD 2-Clause License

Copyright (c) ${y}, ${h}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`,
  },
  "BSD-3-Clause": {
    label: "BSD 3-Clause",
    text: (y, h) => `BSD 3-Clause License

Copyright (c) ${y}, ${h}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`,
  },
  "0BSD": {
    label: "Zero-Clause BSD (public-domain equivalent)",
    text: (y, h) => `Copyright (C) ${y} by ${h}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`,
  },
};
