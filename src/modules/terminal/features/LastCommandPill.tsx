import { quickPick } from "@/modules/quick-pick";
import { explainLastCommandWithAi } from "../ai/explainFailure";
import { TERMINAL_ACTIONS } from "../actions/terminalActions";
import { formatDurationShort, useLastCommandStore } from "./lastCommandStore";

function runAction(id: string) {
  void TERMINAL_ACTIONS.find((a) => a.id === id)?.run();
}

/** Exit status and duration of the active pane's last command. */
export function LastCommandPill() {
  const last = useLastCommandStore((s) => (s.activeLeaf !== null ? s.byLeaf[s.activeLeaf] : undefined));
  if (!last) return null;
  const ok = last.exitCode === 0 || last.exitCode === null;
  const duration = last.durationMs !== null ? formatDurationShort(last.durationMs) : null;
  const onClick = async () => {
    const choice = await quickPick(
      [
        { label: "Rerun", value: "terminal.rerunLastCommand" },
        { label: "Copy command", value: "terminal.copyLastCommand" },
        { label: "Copy output", value: "terminal.copyLastOutput" },
        { label: ok ? "Ask AI about it" : "Ask AI why it failed", value: "ai" },
      ],
      { title: `$ ${last.command}`, placeholder: `${ok ? "succeeded" : `exit ${last.exitCode}`}${duration ? ` in ${duration}` : ""}` },
    );
    if (choice === "ai") explainLastCommandWithAi();
    else if (choice) runAction(choice);
  };
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={`Last command: ${last.command}`}
      className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums transition-colors ${
        ok
          ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
          : "bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-400"
      }`}
    >
      <span>{ok ? "✓" : `✗ ${last.exitCode}`}</span>
      {duration ? <span className="opacity-80">{duration}</span> : null}
    </button>
  );
}
