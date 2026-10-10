// Palette commands for remote development over SSH.

import { quickPick } from "@/modules/quick-pick";
import { addHost, connect, forwardPort, loadHosts, openTerminal, search, useRemoteStore } from "./store";

function showView(): void {
  window.dispatchEvent(new CustomEvent("gear:show-remote-panel"));
}

async function pickHost(title: string, connectedOnly = false): Promise<string | undefined> {
  await loadHosts();
  const { hosts, conns } = useRemoteStore.getState();
  const list = hosts.filter((h) => !connectedOnly || conns[h.alias]?.status === "connected");
  if (!list.length) {
    showView();
    return undefined;
  }
  return quickPick(list.map((h) => ({ label: h.alias, description: conns[h.alias]?.status ?? "", detail: h.hostName, value: h.alias })), { title });
}

export const REMOTE_ACTIONS = [
  { id: "remote.show", label: "Remote: Show SSH hosts", keywords: ["ssh", "remote", "server", "sftp"], run: showView },
  { id: "remote.connect", label: "Remote: Connect to host…", keywords: ["ssh", "remote", "connect", "server"], run: async () => { const h = await pickHost("Connect to"); if (h) { showView(); await connect(h); } } },
  { id: "remote.addHost", label: "Remote: Add SSH host…", keywords: ["ssh", "remote", "add", "host"], run: () => void addHost() },
  { id: "remote.terminal", label: "Remote: Open SSH terminal…", keywords: ["ssh", "remote", "terminal", "shell"], run: async () => { const h = await pickHost("Terminal on"); if (h) openTerminal(h); } },
  { id: "remote.search", label: "Remote: Search files on host…", keywords: ["ssh", "remote", "grep", "search"], run: async () => { const h = await pickHost("Search on", true); if (h) await search(h, useRemoteStore.getState().conns[h]?.root ?? "/"); } },
  { id: "remote.forward", label: "Remote: Forward a port…", keywords: ["ssh", "remote", "port", "forward", "tunnel"], run: async () => { const h = await pickHost("Forward a port from"); if (h) await forwardPort(h); } },
];
