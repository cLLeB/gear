// Terminal intelligence features that react to command results and output.
// `installTerminalFeatures` is called once by the main window; each feature
// reads its own settings at event time so toggling takes effect immediately.

import { app } from "@/app/appBridge";
import { osNotify } from "@/modules/agents/lib/notify";
import { getFeature } from "@/modules/settings/useFeature";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onTerminalCommandFinished } from "../lib/useTerminalSession";
import { formatCommandNotification, shouldNotifyCommand } from "./commandNotify";
import { handleProblemsForCommand } from "./terminalProblems";
import { onTerminalOutputLines } from "../lib/outputTap";
import { detectServer, ServerAnnouncer } from "./portDetect";
import { scanForSecrets } from "./secretScan";
import {
  clearLeafScrollback,
  isLeafCommandRunning,
  submitToLeaf,
} from "../lib/useTerminalSession";
import { commandProgram } from "./commandNotify";
import { suggestCorrection } from "./typoFix";
import { setPendingCorrection } from "./corrections";
import { openExternalUrl } from "@/lib/external-link";
import { toast } from "sonner";

export { TERMINAL_FEATURE_ACTIONS } from "./actions";

let installed = false;
let windowFocused = typeof document !== "undefined" ? document.hasFocus() : true;

export function installTerminalFeatures(): () => void {
  if (installed) return () => {};
  installed = true;
  const disposers: Array<() => void> = [];

  getCurrentWindow()
    .onFocusChanged(({ payload }) => {
      windowFocused = payload;
    })
    .then((u) => disposers.push(u))
    .catch(() => {});

  disposers.push(onTerminalCommandFinished(handleProblemsForCommand));

  const servers = new ServerAnnouncer();
  disposers.push(
    onTerminalOutputLines((leafId, lines) => {
      if (!getFeature("terminal.detectServers")) return;
      for (const line of lines) {
        const hit = detectServer(line);
        if (!hit || !servers.firstSighting(leafId, hit.port)) continue;
        toast.message(`Server running on port ${hit.port}`, {
          description: hit.url,
          duration: 12_000,
          action: { label: "Preview", onClick: () => app().openPreview(hit.url) },
          cancel: { label: "Browser", onClick: () => void openExternalUrl(hit.url) },
        });
      }
    }),
  );
  disposers.push(onTerminalCommandFinished((cmd) => servers.reset(cmd.leafId)));

  // One warning per pane and secret kind every few minutes; a `cat .env`
  // printing ten keys should produce one toast, not ten.
  const warned = new Map<string, number>();
  const SECRET_WARN_COOLDOWN_MS = 5 * 60_000;
  disposers.push(
    onTerminalOutputLines((leafId, lines) => {
      if (!getFeature("terminal.secretWarnings")) return;
      for (const line of lines) {
        for (const hit of scanForSecrets(line)) {
          const key = `${leafId}:${hit.kind}`;
          const now = Date.now();
          if (now - (warned.get(key) ?? 0) < SECRET_WARN_COOLDOWN_MS) continue;
          warned.set(key, now);
          toast.warning(`A ${hit.label} was printed in a terminal`, {
            description: `${hit.preview} — clear the scrollback before sharing your screen or asking AI about this pane.`,
            duration: 15_000,
            action: {
              label: "Clear scrollback",
              onClick: () => void clearLeafScrollback(leafId),
            },
          });
        }
      }
    }),
  );

  disposers.push(
    onTerminalCommandFinished((cmd) => {
      if (!getFeature("terminal.notifyLongCommands")) return;
      const ignore = getFeature("terminal.notifyIgnore").split(/\s+/).filter(Boolean);
      const notify = shouldNotifyCommand({
        command: cmd.command,
        exitCode: cmd.exitCode,
        durationMs: cmd.durationMs,
        thresholdMs: getFeature("terminal.notifyLongCommandsSeconds") * 1000,
        windowFocused,
        paneVisible: app().activeTerminalLeaf() === cmd.leafId,
        ignore,
      });
      if (!notify || cmd.durationMs === null) return;
      const { title, body } = formatCommandNotification(cmd.command, cmd.exitCode, cmd.durationMs);
      void osNotify(title, body);
    }),
  );

  const knownPrograms = new Set<string>();
  disposers.push(
    onTerminalCommandFinished((cmd) => {
      const program = commandProgram(cmd.command);
      if (cmd.exitCode === 0 && program) knownPrograms.add(program);
      if (!getFeature("terminal.typoCorrection")) return;
      const fixed = suggestCorrection({
        command: cmd.command,
        exitCode: cmd.exitCode,
        output: cmd.output ?? "",
        knownPrograms,
      });
      if (!fixed) return;
      setPendingCorrection(cmd.leafId, fixed);
      toast.message(`Did you mean \`${fixed}\`?`, {
        duration: 10_000,
        action: {
          label: "Run",
          onClick: () => {
            if (!isLeafCommandRunning(cmd.leafId)) submitToLeaf(cmd.leafId, fixed);
          },
        },
      });
    }),
  );

  return () => {
    installed = false;
    for (const d of disposers) d();
  };
}
