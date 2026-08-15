/** Display labels for coding-agent ids.
 *
 * Agent ids reach the UI from two places: the hook installer (see AGENTS in
 * src-tauri/src/modules/agent.rs) and the PTY detector, which parses whatever
 * name an OSC 133;C;<name> marker carries — so the id is not a closed set and
 * unknown values must still render sensibly. */
const LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  pi: "Pi",
  gear: "Gear",
  opencode: "OpenCode",
  grok: "Grok",
};

export function displayAgent(agent: string): string {
  if (!agent) return "Agent";
  return (
    LABELS[agent.toLowerCase()] ??
    agent.charAt(0).toUpperCase() + agent.slice(1)
  );
}
