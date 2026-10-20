// Coding agents Gear can run through the Agent Client Protocol. Each signs
// in with the user's own account — a Claude Pro/Max plan, ChatGPT, or a
// Google account — so they work without an API key.

import { invoke } from "@tauri-apps/api/core";

export type EngineId = "gear" | "claude" | "codex" | "gemini";
export type AgentId = Exclude<EngineId, "gear">;

export interface AgentDef {
  id: AgentId;
  name: string;
  /** Who pays: shown next to the name. */
  plan: string;
  /** The CLI whose presence (and sign-in) the agent relies on. */
  cli: string;
  /** How to start it speaking ACP. */
  launch: { program: string; args: string[] };
  install: string;
  signIn: string;
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    plan: "Claude Pro / Max",
    cli: "claude",
    launch: { program: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"] },
    install: "npm install -g @anthropic-ai/claude-code",
    signIn: "claude",
  },
  {
    id: "codex",
    name: "Codex",
    plan: "ChatGPT Plus / Pro",
    cli: "codex",
    launch: { program: "npx", args: ["-y", "@agentclientprotocol/codex-acp@latest"] },
    install: "npm install -g @openai/codex",
    signIn: "codex login",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    plan: "Google account",
    cli: "gemini",
    launch: { program: "gemini", args: ["--acp"] },
    install: "npm install -g @google/gemini-cli",
    signIn: "gemini",
  },
];

export const agentDef = (id: AgentId): AgentDef => AGENTS.find((a) => a.id === id) as AgentDef;

export type Availability = Record<AgentId, { installed: boolean; launcher: boolean }>;

let cached: Promise<Availability> | null = null;

/** Which agents are installed (and whether npx is there to start the adapters). Cached; pass `refresh` after installing. */
export function detectAgents(refresh = false): Promise<Availability> {
  if (cached && !refresh) return cached;
  const programs = [...new Set(AGENTS.flatMap((a) => [a.cli, a.launch.program]))];
  cached = invoke<Record<string, string | null>>("acp_detect", { programs })
    .then((found) => Object.fromEntries(AGENTS.map((a) => [a.id, { installed: !!found[a.cli], launcher: !!found[a.launch.program] }])) as Availability)
    .catch(() => Object.fromEntries(AGENTS.map((a) => [a.id, { installed: false, launcher: false }])) as Availability);
  return cached;
}

/** The first installed agent, for a sensible default. */
export async function firstInstalled(): Promise<AgentId | null> {
  const a = await detectAgents();
  return AGENTS.find((d) => a[d.id].installed && a[d.id].launcher)?.id ?? null;
}
