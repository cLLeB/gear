// Command specs: what a CLI accepts after its name (subcommands, options and
// arguments), so the terminal input can complete `git che` → `checkout`,
// `npm run ` → the scripts in package.json, `git checkout ` → branches.

/** Live values computed in the terminal's directory (see generators.ts). */
export type GeneratorId =
  | "gitBranches"
  | "gitLocalBranches"
  | "gitRemotes"
  | "gitTags"
  | "gitChangedFiles"
  | "gitStashes"
  | "npmScripts"
  | "makeTargets"
  | "justRecipes"
  | "dockerContainers"
  | "dockerImages"
  | "composeServices"
  | "kubeContexts"
  | "kubeResources";

export interface Arg {
  name?: string;
  /** Fall back to the filesystem for this argument. */
  template?: "filepaths" | "folders";
  generator?: GeneratorId;
  suggestions?: string[];
  /** Repeats: every later positional uses this argument too. */
  variadic?: boolean;
}

export interface Opt {
  /** One or more spellings, e.g. ["-m", "--message"]. */
  name: string[];
  description?: string;
  /** The value the option takes, if any (`-m <msg>`). */
  args?: Arg;
}

export interface Spec {
  name: string[];
  description?: string;
  subcommands?: Spec[];
  options?: Opt[];
  args?: Arg[];
}

/** What the word under the cursor should be completed with. */
export type Suggestion = {
  label: string;
  description?: string;
  kind: "subcommand" | "option" | "value";
};

export type Resolution =
  | { kind: "none" }
  | { kind: "items"; items: Suggestion[]; arg: Arg | null };
