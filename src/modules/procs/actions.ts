// Palette commands for ports & processes.

import { killPort, openProcesses } from "./store";

export const PROCS_ACTIONS = [
  { id: "procs.open", label: "Processes: Show ports and processes", keywords: ["process", "ports", "kill", "task manager", "top", "htop", "listening", "pid"], run: openProcesses },
  { id: "procs.killPort", label: "Processes: Stop whatever is listening on a port…", keywords: ["port", "in use", "EADDRINUSE", "kill", "address already in use"], run: () => void killPort() },
];
