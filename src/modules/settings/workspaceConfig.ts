import { MODELS, type ModelId } from "@/modules/ai/config";
import { native } from "@/modules/ai/lib/native";
import { create } from "zustand";

const VALID_MODEL_IDS = new Set<string>(MODELS.map((m) => m.id));

export type WorkspaceConfig = {
  customInstructions?: string;
  defaultModelId?: string;
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
  await native.writeFile(
    configPath(rootPath),
    JSON.stringify(config, null, 2),
  );
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
