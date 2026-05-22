import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(process.cwd());
const envPath = resolve(repoRoot, ".env.build");

if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const args = process.argv.slice(2);
const tauriArgs = args.length > 0 ? args : ["build"];

const result = spawnSync("pnpm", ["exec", "tauri", ...tauriArgs], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
