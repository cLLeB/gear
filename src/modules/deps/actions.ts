// Palette commands for the dependency manager.

import { openDependencies } from "./store";

export const DEPS_ACTIONS = [
  { id: "deps.open", label: "Dependencies: Show outdated and vulnerable packages", keywords: ["dependencies", "outdated", "upgrade", "audit", "vulnerabilities", "npm", "cargo", "pip", "go", "security"], run: openDependencies },
];
