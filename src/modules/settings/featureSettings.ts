// Declarative settings for opt-in/tunable features. One schema drives typed
// accessors, normalization of whatever is on disk, and the auto-generated
// "Features" settings tab — the way editors let extensions "contribute"
// settings — so a new feature adds one entry here instead of touching the
// store, the loader, the change map and a hand-written settings row.
//
// Values persist together under a single preferences key.

export type FeatureSection =
  | "Terminal"
  | "Terminal output"
  | "Commands"
  | "Editor"
  | "Git"
  | "Workspace";

export const FEATURE_SECTIONS: readonly FeatureSection[] = [
  "Terminal",
  "Terminal output",
  "Commands",
  "Editor",
  "Git",
  "Workspace",
];

type Meta = {
  label: string;
  description: string;
  section: FeatureSection;
  min?: number;
  max?: number;
  /** For string settings with a fixed set of values. */
  options?: readonly { value: string; label: string }[];
  /** Render a string setting as a multi-line text area. */
  multiline?: boolean;
};

export const FEATURE_DEFAULTS = {
  "terminal.notifyLongCommands": true,
  "terminal.notifyLongCommandsSeconds": 10,
  "terminal.notifyIgnore": "vim nvim vi nano emacs less more man top htop btop ssh mosh tmux screen watch tail claude codex gemini",
  "terminal.problemMatchers": true,
  "terminal.problemToast": true,
  "terminal.detectServers": true,
  "terminal.secretWarnings": true,
  "terminal.typoCorrection": true,
  "terminal.commandGuard": true,
  "terminal.commandGuardCaution": false,
  "editor.colorSwatches": true,
  "editor.todoHighlight": true,
  "editor.rulers": "",
  "editor.renderWhitespace": false,
  "editor.highlightTrailingWhitespace": false,
  "editor.gitGutter": true,
  "git.commitLint": "conventional",
  "terminal.programNotifications": true,
} satisfies Record<string, boolean | number | string>;

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;
export type FeatureValues = { [K in FeatureKey]: (typeof FEATURE_DEFAULTS)[K] };

export const FEATURE_META: Record<FeatureKey, Meta> = {
  "terminal.programNotifications": {
    label: "Allow programs to send notifications",
    description:
      "Honour OSC 9 (iTerm2), OSC 777 notify (rxvt/WezTerm) and OSC 99 (Kitty) notification requests: a toast when you're looking at the pane, a desktop notification otherwise. Rate-limited per pane.",
    section: "Terminal",
  },
  "git.commitLint": {
    label: "Commit message checks",
    description: "Hints under the commit box: Conventional Commits format, 72-character subject, imperative mood, blank line before the body.",
    section: "Git",
    options: [
      { value: "conventional", label: "Conventional Commits" },
      { value: "basic", label: "Basic hygiene only" },
      { value: "off", label: "Off" },
    ],
  },
  "editor.gitGutter": {
    label: "Git change markers",
    description: "Mark added, modified and deleted lines in the gutter compared with the staged version of the file.",
    section: "Git",
  },
  "editor.rulers": {
    label: "Vertical rulers",
    description: "Columns to draw guide lines at, e.g. 80, 100, 120. Leave empty for none.",
    section: "Editor",
  },
  "editor.renderWhitespace": {
    label: "Render whitespace",
    description: "Show spaces and tabs as faint dots and arrows.",
    section: "Editor",
  },
  "editor.highlightTrailingWhitespace": {
    label: "Highlight trailing whitespace",
    description: "Tint spaces and tabs at the end of lines.",
    section: "Editor",
  },
  "editor.todoHighlight": {
    label: "Highlight TODO comments",
    description: "Colour TODO, FIXME, BUG, HACK, XXX and NOTE tags in comments so they stand out.",
    section: "Editor",
  },
  "editor.colorSwatches": {
    label: "Colour swatches",
    description: "Show a swatch before CSS colour literals (#hex, rgb(), hsl()); click it to convert between notations.",
    section: "Editor",
  },
  "terminal.commandGuard": {
    label: "Confirm destructive commands",
    description:
      "Before Gear submits a command (input bar, workflows, rerun, corrections) that could wipe data — rm -rf ~, force-pushing main, DROP DATABASE, mkfs, dd to a disk — ask first.",
    section: "Commands",
  },
  "terminal.commandGuardCaution": {
    label: "Also confirm risky-but-scoped commands",
    description:
      "Extend confirmation to recursive deletes, git reset --hard, git clean, curl | sh, docker prune and similar.",
    section: "Commands",
  },
  "terminal.typoCorrection": {
    label: "Suggest corrections for mistyped commands",
    description:
      "After \"command not found\" or an unknown subcommand (git, npm, cargo, docker, kubectl…), offer the likely intended command, ready to run.",
    section: "Commands",
  },
  "terminal.secretWarnings": {
    label: "Warn when secrets are printed",
    description:
      "Detect API keys, tokens, private keys and credentialed database URLs in terminal output and offer to clear the scrollback before it is shared or sent to AI.",
    section: "Terminal output",
  },
  "terminal.detectServers": {
    label: "Offer to preview local dev servers",
    description:
      "When a program prints a local URL or says it is listening on a port (Vite, Next, Django, uvicorn, Rails…), offer to open it in a preview tab.",
    section: "Terminal output",
  },
  "terminal.problemMatchers": {
    label: "Detect problems in command output",
    description:
      "Recognise compiler, linter and test failures (tsc, eslint, rustc, gcc/clang, go, mypy, pytest, Python tracebacks, Node stacks) so you can jump to them.",
    section: "Terminal output",
  },
  "terminal.problemToast": {
    label: "Show a toast when a failed command reports problems",
    description: "Offers to open the first error right away.",
    section: "Terminal output",
  },
  "terminal.notifyLongCommands": {
    label: "Notify when long commands finish",
    description:
      "Send a desktop notification when a command that ran longer than the threshold finishes while Gear is in the background or its tab is hidden.",
    section: "Commands",
  },
  "terminal.notifyLongCommandsSeconds": {
    label: "Long command threshold (seconds)",
    description: "Commands shorter than this never notify.",
    section: "Commands",
    min: 1,
    max: 86_400,
  },
  "terminal.notifyIgnore": {
    label: "Never notify for",
    description:
      "Space-separated program names. Interactive programs run for as long as you use them, so finishing them is not news.",
    section: "Commands",
  },
};

/** Coerce stored values onto the schema: wrong types and unknown keys fall back. */
export function normalizeFeatureSettings(raw: unknown): FeatureValues {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...FEATURE_DEFAULTS } as Record<FeatureKey, unknown>;
  for (const key of Object.keys(FEATURE_DEFAULTS) as FeatureKey[]) {
    const value = src[key];
    const def = FEATURE_DEFAULTS[key];
    if (typeof value !== typeof def) continue;
    if (typeof def === "number") {
      if (!Number.isFinite(value as number)) continue;
      const meta = FEATURE_META[key];
      let n = value as number;
      if (meta.min !== undefined) n = Math.max(meta.min, n);
      if (meta.max !== undefined) n = Math.min(meta.max, n);
      out[key] = n;
    } else if (typeof def === "string" && FEATURE_META[key].options) {
      const ok = FEATURE_META[key].options!.some((o) => o.value === value);
      out[key] = ok ? value : def;
    } else {
      out[key] = value;
    }
  }
  return out as FeatureValues;
}

/** Settings matching a search query, grouped by section in schema order. */
export function searchFeatureSettings(query: string): Array<{ section: FeatureSection; keys: FeatureKey[] }> {
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return FEATURE_SECTIONS.map((section) => ({
    section,
    keys: (Object.keys(FEATURE_META) as FeatureKey[]).filter((key) => {
      const meta = FEATURE_META[key];
      if (meta.section !== section) return false;
      const hay = `${meta.label} ${meta.description} ${key} ${section}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    }),
  })).filter((g) => g.keys.length > 0);
}
