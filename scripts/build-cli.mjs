import { cpSync, chmodSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const release = process.argv.includes("--release");

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    process.stderr.write(`Could not run ${command}: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function hostTriple() {
  const output = run("rustc", ["-vV"], { capture: true });
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match) {
    process.stderr.write("rustc did not report a host target triple\n");
    process.exit(1);
  }
  return match[1].trim();
}

function requireArtifact(path, label) {
  try {
    const artifact = statSync(path);
    if (artifact.isFile() && artifact.size > 0) return;
  } catch {}
  process.stderr.write(`${label} is missing or empty: ${path}\n`);
  process.exit(1);
}

const target =
  process.env.GEAR_CLI_TARGET?.trim() ||
  process.env.CARGO_BUILD_TARGET?.trim() ||
  hostTriple();

// Gear's macOS release builds one universal app (`--target
// universal-apple-darwin`), but that is a Tauri/lipo alias, not a rustc target.
// Build both real arches and merge them so the sidecar matches the app.
const UNIVERSAL_MACOS = "universal-apple-darwin";
const UNIVERSAL_MEMBERS = ["x86_64-apple-darwin", "aarch64-apple-darwin"];

const profile = release ? "release" : "debug";
const extension = target.includes("windows") ? ".exe" : "";

function buildFor(triple) {
  const cargoArgs = [
    "build",
    "--locked",
    "--manifest-path",
    join(tauriDir, "Cargo.toml"),
    "--package",
    "gear-cli",
    "--bin",
    "gear-cli",
    "--target",
    triple,
  ];
  if (release) cargoArgs.push("--release");
  run("cargo", cargoArgs);
  const artifact = join(
    tauriDir,
    "target",
    triple,
    profile,
    `gear-cli${extension}`,
  );
  requireArtifact(artifact, `Built CLI artifact (${triple})`);
  return artifact;
}

const binariesDir = join(tauriDir, "binaries");
const sidecarPath = (triple) =>
  join(binariesDir, `gear-cli-${triple}${extension}`);

mkdirSync(binariesDir, { recursive: true });

// Which suffix Tauri looks for on a universal build is a bundler detail we
// would rather not depend on, so emit the merged binary under the universal
// alias *and* both real arch triples. Tauri picks whichever it wants; the
// unused copies are simply never referenced.
const written = [];
if (target === UNIVERSAL_MACOS) {
  const slices = UNIVERSAL_MEMBERS.map(buildFor);
  const universal = sidecarPath(UNIVERSAL_MACOS);
  run("lipo", ["-create", "-output", universal, ...slices]);
  written.push(universal);
  for (const triple of UNIVERSAL_MEMBERS) {
    const alias = sidecarPath(triple);
    cpSync(universal, alias);
    written.push(alias);
  }
} else {
  const destination = sidecarPath(target);
  cpSync(buildFor(target), destination);
  written.push(destination);
}

for (const path of written) {
  if (!extension) chmodSync(path, 0o755);
  requireArtifact(path, "Prepared CLI sidecar");
  console.log(`Prepared ${path.slice(root.length + 1)}`);
}
