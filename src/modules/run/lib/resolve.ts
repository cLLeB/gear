/**
 * Pure "what command runs this file" resolution across the three config
 * layers. No I/O, no React, no shell — the executor takes the `RunSpec` this
 * produces and drives a terminal with it.
 *
 * Precedence is project > settings > preset, and within a layer the first
 * match wins. Everything here is side-effect free so that precedence, which is
 * the part most likely to surprise, is exhaustively testable.
 */

import { basename, dirname, extname } from "@/lib/toolkit/pathUtils";
import { quoteShellPath } from "@/modules/terminal/lib/quoteShellPath";
import { RUN_PRESETS } from "./presets";
import {
  type LayeredRunConfig,
  qualifiedId,
  type RunConfig,
  type RunSpec,
  type RunVars,
} from "./types";

export type RunLayers = {
  /** Highest precedence: the workspace's `.gear/settings.json`. */
  project?: RunConfig[];
  /** User overrides from Settings. */
  settings?: RunConfig[];
  /** Built-ins. Defaults to RUN_PRESETS. */
  presets?: RunConfig[];
};

export type ResolveOptions = RunLayers & {
  workspaceRoot?: string;
  /** Qualified id ("project:dev") pinned via the run picker. */
  selectedId?: string;
};

const PLACEHOLDER = /\{(\w+)\}/g;

function substitute(
  template: string,
  vars: Partial<RunVars>,
  quote: boolean,
): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name as keyof RunVars];
    if (value === undefined) return match;
    return quote ? quoteShellPath(value) : value;
  });
}

/**
 * Substitute {placeholders}, shell-quoting each value. Single pass: a value
 * that itself looks like a placeholder is never re-expanded. An unrecognised
 * placeholder is left verbatim so a typo shows up in the command rather than
 * silently becoming "undefined".
 */
export function renderCommand(
  template: string,
  vars: Partial<RunVars>,
): string {
  return substitute(template, vars, true);
}

/** Same substitution without quoting — for cwd and env, quoted later per shell. */
export function renderPath(template: string, vars: Partial<RunVars>): string {
  return substitute(template, vars, false);
}

/** Every config from every layer, ordered by precedence. */
export function allRunConfigs(layers: RunLayers): LayeredRunConfig[] {
  const presets = layers.presets ?? RUN_PRESETS;
  return [
    ...(layers.project ?? []).map((c) => ({ ...c, source: "project" as const })),
    ...(layers.settings ?? []).map((c) => ({
      ...c,
      source: "settings" as const,
    })),
    ...presets.map((c) => ({ ...c, source: "preset" as const })),
  ];
}

/**
 * Configs that auto-match this file, in precedence order. A config declaring
 * no extensions is deliberately excluded: it is selectable by name only.
 */
export function matchingRunConfigs(
  filePath: string,
  layers: RunLayers,
): LayeredRunConfig[] {
  const ext = extname(filePath).slice(1).toLowerCase();
  if (!ext) return [];
  return allRunConfigs(layers).filter((c) =>
    c.extensions?.some((e) => e.toLowerCase() === ext),
  );
}

function varsFor(filePath: string, workspaceRoot: string | undefined): RunVars {
  const fileDir = dirname(filePath);
  return {
    file: filePath.replace(/\\/g, "/"),
    fileDir,
    fileStem: basename(filePath, extname(filePath)),
    // A rootless window still has to render {workspaceRoot} as something; the
    // file's own directory is the best guess available.
    workspaceRoot: workspaceRoot ?? fileDir,
  };
}

function toSpec(
  config: LayeredRunConfig,
  vars: RunVars,
): RunSpec {
  return {
    configId: config.id,
    source: config.source,
    label: config.name,
    command: renderCommand(config.command, vars),
    cwd: config.cwd ? renderPath(config.cwd, vars) : vars.fileDir,
    env: Object.fromEntries(
      Object.entries(config.env ?? {}).map(([k, v]) => [k, renderPath(v, vars)]),
    ),
  };
}

export function resolveRunSpec(
  filePath: string,
  opts: ResolveOptions = {},
): RunSpec | null {
  const vars = varsFor(filePath, opts.workspaceRoot);

  // An explicit pick wins over extension matching entirely, so a selected
  // "Dev server" keeps running even while a .py file is focused.
  if (opts.selectedId) {
    const selected = allRunConfigs(opts).find(
      (c) => qualifiedId(c) === opts.selectedId,
    );
    if (selected) return toSpec(selected, vars);
  }

  const match = matchingRunConfigs(filePath, opts)[0];
  return match ? toSpec(match, vars) : null;
}

/** Whether anything can run this file — cheap enough for render-time checks. */
export function canRun(filePath: string, layers: RunLayers = {}): boolean {
  return matchingRunConfigs(filePath, layers).length > 0;
}
