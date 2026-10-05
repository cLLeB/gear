// Prompt builders and reply parsers for the AI palette tools. Kept pure so
// they can be tested without a model.

/** Strip one surrounding code fence (```lang … ```), if the reply has one. */
export function stripFence(reply: string): string {
  const t = reply.trim();
  const m = /^```[\w+#.-]*\n([\s\S]*?)\n?```\s*$/.exec(t);
  if (m) return m[1];
  const inner = /```[\w+#.-]*\n([\s\S]*?)```/.exec(t);
  return inner ? inner[1].replace(/\n$/, "") : t;
}

export function langName(path: string, languageId: string): string {
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript (React)", js: "JavaScript", jsx: "JavaScript (React)", py: "Python", rs: "Rust", go: "Go",
    java: "Java", kt: "Kotlin", cs: "C#", rb: "Ruby", php: "PHP", swift: "Swift", c: "C", cpp: "C++", h: "C/C++ header",
    sh: "Bash", ps1: "PowerShell", sql: "SQL", md: "Markdown", yaml: "YAML", yml: "YAML", json: "JSON", html: "HTML", css: "CSS",
  };
  return map[ext] ?? (languageId && languageId !== "plaintext" ? languageId : "plain text");
}

export const PROMPTS = {
  explain: {
    system: "You explain code to an experienced developer. Be concise and concrete: what it does, how, notable edge cases or bugs. Use short Markdown with bullet points. No preamble.",
    user: (lang: string, code: string, file: string) => `File: ${file}\nLanguage: ${lang}\n\n\`\`\`\n${code}\n\`\`\``,
  },
  docComment: {
    system: "Write a documentation comment for the given code in the idiomatic style for its language (JSDoc/TSDoc, Python docstring, rustdoc ///, Go doc comment, Javadoc, XML doc for C#…). Describe purpose, parameters, return value and errors briefly. Reply with ONLY the comment text, exactly as it should be inserted, no code fence, no code.",
    user: (lang: string, code: string) => `Language: ${lang}\n\n${code}`,
  },
  tests: {
    system: "Write focused unit tests for the given code using the conventional test framework for the language (Vitest for TS/JS unless the code suggests Jest, pytest, Rust #[test], Go testing, JUnit 5…). Cover normal cases, edge cases and errors. Reply with only the test file content in one code block.",
    user: (lang: string, code: string, file: string) => `Source file: ${file}\nLanguage: ${lang}\n\n\`\`\`\n${code}\n\`\`\``,
  },
  review: {
    system: "You are a strict code reviewer. Review the diff for bugs, security issues, race conditions, missing error handling and unclear naming. Ignore pure style. Reply in Markdown: a one-line verdict, then numbered findings as `**file:line** — problem — suggested fix`. Say 'No issues found' if there are none.",
    user: (diff: string) => `\`\`\`diff\n${diff}\n\`\`\``,
  },
  names: {
    system: "Suggest 6 better names for the identifier, following the language's conventions. Reply with one name per line, best first, no numbering or commentary.",
    user: (lang: string, name: string, context: string) => `Language: ${lang}\nIdentifier: ${name}\nContext:\n${context}`,
  },
  translate: {
    system: "Translate the code to the target language idiomatically (use its standard library and conventions, keep behaviour identical). Reply with only the translated code in one code block.",
    user: (from: string, to: string, code: string) => `From: ${from}\nTo: ${to}\n\n\`\`\`\n${code}\n\`\`\``,
  },
  prDescription: {
    system: "Write a pull request description in Markdown with sections: Summary (2-3 sentences), Changes (bullets), Testing (bullets), Risks (bullets, or 'None'). Base it only on the commits and diff given. No preamble.",
    user: (branch: string, commits: string, diff: string) => `Branch: ${branch}\n\nCommits:\n${commits}\n\nDiff (may be truncated):\n\`\`\`diff\n${diff}\n\`\`\``,
  },
  oneLiner: {
    system: "Write a single expression in the requested tool/language that does what is described. Reply with only the expression (no code fence, no explanation). If the request is ambiguous, pick the most common interpretation.",
    user: (tool: string, request: string, sample?: string) => `Tool: ${tool}\nTask: ${request}${sample ? `\nSample input:\n${sample}` : ""}`,
  },
  summarize: {
    system: "Summarize terminal output for a developer: what ran, whether it succeeded, the key errors or warnings (quote the exact important lines), and the most likely next step. Short Markdown, no preamble.",
    user: (command: string, output: string) => `Command: ${command}\n\nOutput (may be truncated):\n\`\`\`\n${output}\n\`\`\``,
  },
  edit: {
    system: "Apply the requested change to the code. Keep everything else identical, including formatting and comments. Reply with only the full replacement code in one code block.",
    user: (lang: string, instruction: string, code: string) => `Language: ${lang}\nChange: ${instruction}\n\n\`\`\`\n${code}\n\`\`\``,
  },
  stackTrace: {
    system: "Explain the error or stack trace: the root cause in one sentence, where it originates (the most relevant frame in the user's code, not library frames), and concrete steps to fix it. Short Markdown, no preamble.",
    user: (trace: string) => `\`\`\`\n${trace}\n\`\`\``,
  },
};

/** Keep prompts under a size budget, cutting the middle of long text. */
export function truncateMiddle(text: string, max = 24_000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n… [${text.length - max} characters omitted] …\n${text.slice(-tail)}`;
}

/** Parse "one name per line" replies, tolerating bullets/numbers/backticks. */
export function parseNameList(reply: string): string[] {
  return [...new Set(reply.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/[`"']/g, "").trim()).filter((l) => /^[A-Za-z_$][\w$]*$/.test(l)))].slice(0, 10);
}

/** Indent every line of a doc comment to match the target line. */
export function indentBlock(text: string, indent: string): string {
  return text
    .replace(/\s+$/, "")
    .split("\n")
    .map((l) => (l ? indent + l : l))
    .join("\n");
}

/** Test file name next to the source: foo.ts → foo.test.ts, foo.py → test_foo.py, foo.go → foo_test.go. */
export function testFileFor(path: string): string {
  const m = /^(.*[\\/])?([^\\/]+?)\.([^.\\/]+)$/.exec(path);
  if (!m) return `${path}.test`;
  const [, dir = "", base, ext] = m;
  if (ext === "py") return `${dir}test_${base}.py`;
  if (ext === "go") return `${dir}${base}_test.go`;
  if (ext === "rs") return `${dir}${base}_tests.rs`;
  if (ext === "java" || ext === "kt") return `${dir}${base}Test.${ext}`;
  return `${dir}${base}.test.${ext}`;
}
