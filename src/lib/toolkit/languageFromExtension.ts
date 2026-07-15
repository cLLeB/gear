import { basename, extname } from "./pathUtils";

const BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".php": "php",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".ps1": "powershell",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".sql": "sql",
  ".lua": "lua",
  ".vim": "viml",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".gitignore": "ignore",
  ".env": "dotenv",
};

/**
 * Resolve a syntax-highlighting language id from a file path, using special
 * filenames first, then the extension. Returns "plaintext" when unknown.
 */
export function languageFromExtension(path: string): string {
  const name = basename(path).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = extname(name);
  return BY_EXT[ext] ?? "plaintext";
}
