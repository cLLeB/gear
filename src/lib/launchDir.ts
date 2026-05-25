import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;

export async function initLaunchDir(): Promise<void> {
  let dir = await invoke<string | null>("get_launch_dir").catch(() => null);
  if (!dir) {
    dir = await invoke<string>("workspace_current_dir").catch(() => null);
  }
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}
