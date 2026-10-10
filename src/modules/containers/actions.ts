// Palette commands for containers and dev containers.

import { inputBox } from "@/modules/quick-pick";
import { addConfig, devRun, devShell, devStop, devUp, prune } from "./store";

function showView(): void {
  window.dispatchEvent(new CustomEvent("gear:show-containers-panel"));
}

async function runInDev(): Promise<void> {
  const cmd = await inputBox({ title: "Run in the dev container", placeholder: "npm test" });
  if (cmd?.trim()) await devRun(cmd.trim());
}

export const CONTAINER_ACTIONS = [
  { id: "containers.show", label: "Containers: Show containers", keywords: ["docker", "containers", "compose", "images", "podman"], run: showView },
  { id: "devcontainer.up", label: "Dev Containers: Build & start the dev container", keywords: ["devcontainer", "docker", "reopen in container", "start"], run: () => void devUp() },
  { id: "devcontainer.rebuild", label: "Dev Containers: Rebuild container", keywords: ["devcontainer", "rebuild", "docker"], run: () => void devUp({ rebuild: true }) },
  { id: "devcontainer.rebuildNoCache", label: "Dev Containers: Rebuild without cache", keywords: ["devcontainer", "rebuild", "no cache", "docker"], run: () => void devUp({ rebuild: true, noCache: true }) },
  { id: "devcontainer.terminal", label: "Dev Containers: Open terminal in the dev container", keywords: ["devcontainer", "shell", "terminal", "exec", "docker"], run: () => void devShell() },
  { id: "devcontainer.run", label: "Dev Containers: Run a command in the dev container…", keywords: ["devcontainer", "exec", "run", "docker"], run: () => void runInDev() },
  { id: "devcontainer.stop", label: "Dev Containers: Stop the dev container", keywords: ["devcontainer", "stop", "docker"], run: () => void devStop(false) },
  { id: "devcontainer.remove", label: "Dev Containers: Remove the dev container", keywords: ["devcontainer", "remove", "delete", "docker"], run: () => void devStop(true) },
  { id: "devcontainer.add", label: "Dev Containers: Add configuration…", keywords: ["devcontainer", "devcontainer.json", "template", "docker"], run: () => void addConfig() },
  { id: "containers.prune", label: "Containers: Prune…", keywords: ["docker", "prune", "cleanup", "disk"], run: () => void prune() },
];
