// Loading and validating workflows from the three sources: the built-in
// library, a project's `.gear/workflows.json`, and the user's saved commands.

import type { Platform, Workflow } from "./library";

export const PROJECT_WORKFLOWS_FILE = ".gear/workflows.json";

/**
 * Accepts `[ {...} ]` or `{ "workflows": [ {...} ] }`. Entries need a name
 * and a command; anything malformed is skipped and reported.
 */
export function parseProjectWorkflows(json: string): { workflows: Workflow[]; errors: string[] } {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { workflows: [], errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { workflows?: unknown }).workflows)
      ? (data as { workflows: unknown[] }).workflows
      : null;
  if (!list) return { workflows: [], errors: ['Expected an array or { "workflows": [...] }'] };
  const workflows: Workflow[] = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") {
      errors.push(`#${i + 1}: not an object`);
      return;
    }
    const w = raw as Record<string, unknown>;
    if (typeof w.name !== "string" || !w.name.trim() || typeof w.command !== "string" || !w.command.trim()) {
      errors.push(`#${i + 1}: needs "name" and "command" strings`);
      return;
    }
    const platforms = Array.isArray(w.platforms)
      ? (w.platforms.filter((p) => p === "mac" || p === "linux" || p === "windows") as Platform[])
      : undefined;
    workflows.push({
      id: `project:${i}:${w.name}`,
      name: w.name.trim(),
      command: w.command,
      description: typeof w.description === "string" ? w.description : undefined,
      tags: Array.isArray(w.tags) ? w.tags.filter((t): t is string => typeof t === "string") : undefined,
      platforms: platforms && platforms.length > 0 ? platforms : undefined,
      source: "project",
    });
  });
  return { workflows, errors };
}

export function availableOn(w: Workflow, platform: Platform): boolean {
  return !w.platforms || w.platforms.includes(platform);
}

const USER_KEY = "gear.workflows.user";

export function loadUserWorkflows(): Workflow[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USER_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is Workflow => !!w && typeof w.name === "string" && typeof w.command === "string")
      .map((w) => ({ ...w, source: "user" as const }));
  } catch {
    return [];
  }
}

export function saveUserWorkflows(list: readonly Workflow[]): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(list));
  } catch {
    // Non-essential.
  }
}
