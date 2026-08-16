/**
 * Form <-> RunConfig translation for the Settings editor. The dialog edits
 * plain strings; this turns them into a validated config, and back again for
 * editing. Pure, so the parsing rules are testable without rendering anything.
 */

import type { RunConfig } from "./types";

export type RunConfigForm = {
  id: string;
  name: string;
  command: string;
  /** Comma-separated, dots optional. */
  extensions: string;
  cwd: string;
  /** One KEY=value per line. */
  env: string;
};

export const EMPTY_RUN_CONFIG_FORM: RunConfigForm = {
  id: "",
  name: "",
  command: "",
  extensions: "",
  cwd: "",
  env: "",
};

export function parseEnvInput(value: string): {
  env: Record<string, string>;
  errors: string[];
} {
  const env: Record<string, string> = {};
  const errors: string[] = [];

  value.split("\n").forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq === -1) {
      errors.push(`Line ${i + 1}: expected KEY=value`);
      return;
    }
    const key = line.slice(0, eq).trim();
    if (key === "") {
      errors.push(`Line ${i + 1}: missing variable name`);
      return;
    }
    env[key] = line.slice(eq + 1).trim();
  });

  return { env, errors };
}

export function formatEnvInput(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function formatExtensionsInput(
  extensions: string[] | undefined,
): string {
  return (extensions ?? []).join(", ");
}

function parseExtensionsInput(value: string): string[] {
  return value
    .split(",")
    .map((e) => e.trim().replace(/^\.+/, "").toLowerCase())
    .filter((e) => e !== "");
}

export function toRunConfigForm(config: RunConfig): RunConfigForm {
  return {
    id: config.id,
    name: config.name,
    command: config.command,
    extensions: formatExtensionsInput(config.extensions),
    cwd: config.cwd ?? "",
    env: formatEnvInput(config.env),
  };
}

export function validateRunConfigForm(form: RunConfigForm): {
  config: RunConfig | null;
  errors: string[];
} {
  const errors: string[] = [];
  const name = form.name.trim();
  const command = form.command.trim();
  if (name === "") errors.push("Name is required.");
  if (command === "") errors.push("Command is required.");

  const { env, errors: envErrors } = parseEnvInput(form.env);
  errors.push(...envErrors);
  if (errors.length > 0) return { config: null, errors };

  const extensions = parseExtensionsInput(form.extensions);
  const cwd = form.cwd.trim();

  return {
    config: {
      // A blank id means "new"; ids only have to be unique within this layer.
      id: form.id.trim() || `custom-${Date.now().toString(36)}`,
      name,
      command,
      ...(extensions.length > 0 && { extensions }),
      ...(cwd !== "" && { cwd }),
      ...(Object.keys(env).length > 0 && { env }),
    },
    errors: [],
  };
}
