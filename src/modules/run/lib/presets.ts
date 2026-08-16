/**
 * Built-in "how do I run this file" table, keyed by file extension.
 *
 * Deliberately mirrors the shape of `@/modules/lsp/lib/presets` so the two
 * capability tables read the same way. Commands are templates rendered by
 * `renderCommand`; every substituted value is shell-quoted at render time, so
 * templates must not add their own quotes around a placeholder.
 */

import type { RunConfig } from "./types";

export const RUN_PRESETS: RunConfig[] = [
  {
    id: "python",
    name: "Python",
    extensions: ["py"],
    command: "python {file}",
  },
  {
    id: "node",
    name: "Node",
    extensions: ["js", "mjs", "cjs"],
    command: "node {file}",
  },
  {
    id: "tsx",
    name: "TypeScript",
    extensions: ["ts", "mts", "cts"],
    command: "npx tsx {file}",
  },
  {
    id: "rust",
    name: "Rust",
    extensions: ["rs"],
    command: "cargo run",
    cwd: "{workspaceRoot}",
  },
  {
    id: "go",
    name: "Go",
    extensions: ["go"],
    command: "go run {file}",
  },
  {
    id: "shell",
    name: "Shell",
    extensions: ["sh", "bash"],
    command: "bash {file}",
  },
  {
    id: "powershell",
    name: "PowerShell",
    extensions: ["ps1"],
    command: "powershell -NoProfile -File {file}",
  },
  {
    id: "ruby",
    name: "Ruby",
    extensions: ["rb"],
    command: "ruby {file}",
  },
  {
    id: "php",
    name: "PHP",
    extensions: ["php"],
    command: "php {file}",
  },
  {
    id: "lua",
    name: "Lua",
    extensions: ["lua"],
    command: "lua {file}",
  },
  {
    // Single-file source mode, Java 11+.
    id: "java",
    name: "Java",
    extensions: ["java"],
    command: "java {file}",
  },
];
