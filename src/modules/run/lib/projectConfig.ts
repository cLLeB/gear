/**
 * Validation for the `run` block of a workspace's `.gear/settings.json`.
 *
 * This is untrusted input — the file travels with the repository — so it is
 * schema-checked at the boundary and a malformed entry is dropped rather than
 * taken on faith. Trust (whether these configs may execute at all) is a
 * separate decision, in `trust.ts`.
 */

import { z } from "zod";
import type { RunConfig } from "./types";

const configSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  command: z.string().min(1),
  extensions: z.array(z.string().min(1)).optional(),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const blockSchema = z.object({
  configs: z.array(z.unknown()).optional(),
});

export type ProjectRunParse = {
  configs: RunConfig[];
  /** Human-readable problems, for surfacing without blocking the good entries. */
  errors: string[];
};

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "config"
  );
}

/** Suffix duplicates so every id is addressable by the picker. */
function uniqueId(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  let n = 2;
  while (taken.has(`${candidate}-${n}`)) n++;
  return `${candidate}-${n}`;
}

export function parseProjectRunConfigs(raw: unknown): ProjectRunParse {
  if (raw === undefined || raw === null) return { configs: [], errors: [] };

  const block = blockSchema.safeParse(raw);
  if (!block.success) {
    return { configs: [], errors: ["run: expected an object with `configs`"] };
  }
  const entries = block.data.configs;
  if (entries === undefined) return { configs: [], errors: [] };

  const configs: RunConfig[] = [];
  const errors: string[] = [];
  const taken = new Set<string>();

  entries.forEach((entry, i) => {
    const parsed = configSchema.safeParse(entry);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      errors.push(`run.configs[${i}]: ${detail}`);
      return;
    }
    const { id, name, command, extensions, cwd, env } = parsed.data;
    const finalId = uniqueId(id ?? slugify(name), taken);
    taken.add(finalId);
    configs.push({
      id: finalId,
      name,
      command,
      ...(extensions && {
        extensions: extensions.map((e) =>
          e.replace(/^\.+/, "").toLowerCase(),
        ),
      }),
      ...(cwd && { cwd }),
      ...(env && { env }),
    });
  });

  return { configs, errors };
}
