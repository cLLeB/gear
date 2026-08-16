/**
 * The one shape a run entry takes, whatever layer it came from. Presets, user
 * settings and a project's `.gear/settings.json` all produce `RunConfig`s, so
 * precedence is a matter of ordering lists rather than merging dissimilar
 * records.
 */

/** Ordered lowest-to-highest precedence. */
export type RunConfigSource = "preset" | "settings" | "project";

export type RunConfig = {
  /** Unique within its layer. Qualified with the source when addressed. */
  id: string;
  /** Shown on the run control, in the picker and in the palette. */
  name: string;
  /** Command template over {file}, {fileDir}, {fileStem}, {workspaceRoot}. */
  command: string;
  /**
   * Lowercase extensions, without the dot, that this config runs. A config
   * with none never auto-matches — it is selectable by name only, which keeps
   * a project's "Dev server" from hijacking the Run button on a .py file.
   */
  extensions?: string[];
  /** Working-directory template. Defaults to {fileDir}. */
  cwd?: string;
  /** Environment templates applied to the shell before the command runs. */
  env?: Record<string, string>;
};

export type LayeredRunConfig = RunConfig & { source: RunConfigSource };

/** A fully resolved, ready-to-execute run. */
export type RunSpec = {
  configId: string;
  source: RunConfigSource;
  /** The config's display name. */
  label: string;
  /** Rendered and shell-quoted — ready to submit to a terminal verbatim. */
  command: string;
  /** Directory the command expects to run in, unquoted. */
  cwd: string;
  /** Rendered environment, unquoted; the executor quotes per shell dialect. */
  env: Record<string, string>;
};

export type RunVars = {
  file: string;
  fileDir: string;
  fileStem: string;
  workspaceRoot: string;
};

/** How a shell wants environment variables and paths written. */
export type ShellDialect = "posix" | "powershell" | "cmd";

/** Qualified id, unique across layers — what the picker stores. */
export function qualifiedId(config: LayeredRunConfig): string {
  return `${config.source}:${config.id}`;
}
