import { MODELS, type ModelId } from "@/modules/ai/config";
import { parseProjectRunConfigs } from "@/modules/run/lib/projectConfig";
import type { RunConfig } from "@/modules/run/lib/types";
import { native } from "@/modules/ai/lib/native";
import { create } from "zustand";

const VALID_MODEL_IDS = new Set<string>(MODELS.map((m) => m.id));

export type WorkspaceConfig = {
  customInstructions?: string;
  defaultModelId?: string;
  /** Run configurations this project ships. Inert until the root is trusted. */
  run?: { configs: RunConfig[] };
  /** Problems found in the run block, surfaced without blocking valid entries. */
  runErrors?: string[];
};

const CONFIG_RELATIVE = ".gear/settings.json";
const DIR_RELATIVE = ".gear";

function configPath(rootPath: string): string {
  return `${rootPath}/${CONFIG_RELATIVE}`;
}

function gearDirPath(rootPath: string): string {
  return `${rootPath}/${DIR_RELATIVE}`;
}

export async function loadWorkspaceConfig(
  rootPath: string,
): Promise<WorkspaceConfig | null> {
  try {
    const result = await native.readFile(configPath(rootPath));
    if (result.kind !== "text") return null;
    const parsed: unknown = JSON.parse(result.content);
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    const config: WorkspaceConfig = {};
    if (typeof rec.customInstructions === "string") {
      config.customInstructions = rec.customInstructions;
    }
    if (typeof rec.defaultModelId === "string") {
      config.defaultModelId = rec.defaultModelId;
    }
    // Schema-checked rather than typeof-checked: the run block is executable
    // content that travels with the repo, and it nests arrays and records.
    const { configs, errors } = parseProjectRunConfigs(rec.run);
    if (configs.length > 0) config.run = { configs };
    if (errors.length > 0) config.runErrors = errors;
    return Object.keys(config).length > 0 ? config : null;
  } catch {
    return null;
  }
}

export async function saveWorkspaceConfig(
  rootPath: string,
  config: WorkspaceConfig,
): Promise<void> {
  try {
    await native.createDir(gearDirPath(rootPath));
  } catch {
    // directory already exists
  }
  // Merge over whatever is on disk. gear only owns the keys it writes here;
  // any key a future version adds must survive a save from an older screen
  // that never knew about it. The run block is hand-authored and is dropped
  // rather than written back, so saving never reformats the user's own file;
  // runErrors is derived, not stored.
  const { run: _run, runErrors: _runErrors, ...writable } = config;
  await native.writeFile(
    configPath(rootPath),
    JSON.stringify({ ...(await readRawConfig(rootPath)), ...writable }, null, 2),
  );
}

/** The file's current contents as a plain record, or {} when unreadable. */
async function readRawConfig(rootPath: string): Promise<Record<string, unknown>> {
  try {
    const result = await native.readFile(configPath(rootPath));
    if (result.kind !== "text") return {};
    const parsed: unknown = JSON.parse(result.content);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

type State = {
  rootPath: string | null;
  config: WorkspaceConfig | null;
  load: (rootPath: string | null) => Promise<void>;
  set: (config: WorkspaceConfig) => Promise<void>;
  clear: () => Promise<void>;
};

export const useWorkspaceConfigStore = create<State>((set, get) => ({
  rootPath: null,
  config: null,

  load: async (rootPath) => {
    if (!rootPath) {
      set({ rootPath: null, config: null });
      return;
    }
    const config = await loadWorkspaceConfig(rootPath);
    set({ rootPath, config });
  },

  set: async (config) => {
    const { rootPath } = get();
    if (!rootPath) return;
    await saveWorkspaceConfig(rootPath, config);
    set({ config });
  },

  clear: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    try {
      await native.writeFile(configPath(rootPath), "{}");
    } catch {
      // file may not exist
    }
    set({ config: null });
  },
}));

export function getEffectiveCustomInstructions(
  globalInstructions: string,
): string {
  const wsConfig = useWorkspaceConfigStore.getState().config;
  return wsConfig?.customInstructions ?? globalInstructions;
}

export function getEffectiveDefaultModelId(globalModelId: ModelId): ModelId {
  const wsConfig = useWorkspaceConfigStore.getState().config;
  const candidate = wsConfig?.defaultModelId;
  if (candidate && VALID_MODEL_IDS.has(candidate)) return candidate as ModelId;
  return globalModelId;
}
