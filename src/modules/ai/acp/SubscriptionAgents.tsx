// Settings → Models: the agents that run on the user's own subscription,
// shown first, with whether each is installed and which one the AI panel uses.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AGENTS, type Availability, detectAgents } from "./agents";
import { useAcpStore } from "./store";

export function SubscriptionAgents() {
  const engine = useAcpStore((s) => s.engine);
  const setEngine = useAcpStore((s) => s.setEngine);
  const [avail, setAvail] = useState<Availability | null>(null);
  const refresh = () => void detectAgents(true).then(setAvail);
  useEffect(refresh, []);

  const copy = (text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copied — run it in a terminal"))
      .catch(() => toast.error("Could not copy"));

  return (
    <div className="flex flex-col gap-2" data-subscription-agents>
      <div>
        <div className="text-[12.5px] font-medium">Use your subscription</div>
        <p className="text-[11px] text-muted-foreground">Claude Code, Codex and Gemini CLI run on the plan you already pay for — no API key. The AI panel, commit messages and other helpers use the one you pick.</p>
      </div>
      {AGENTS.map((a) => {
        const s = avail?.[a.id];
        const ready = !!s && s.installed && s.launcher;
        return (
          <div key={a.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2", engine === a.id ? "border-primary/50 bg-primary/5" : "border-border/60 bg-card/40")} data-subscription-agent={a.id}>
            <div className="min-w-48 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
                {a.name}
                <span className="text-[10.5px] text-muted-foreground">{a.plan}</span>
              </div>
              <div className="text-[10.5px] text-muted-foreground">{!avail ? "Checking…" : ready ? `Installed. Sign in once with \`${a.signIn}\` in a terminal if you have not yet.` : !s?.launcher && s?.installed ? "Needs Node.js (npx) to start." : `Not installed: ${a.install}`}</div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
            {avail && !ready && (
              <button type="button" className="whitespace-nowrap rounded border border-border/60 px-2 py-0.5 text-[11px] hover:bg-muted" onClick={() => copy(`${a.install}; ${a.signIn}`)}>
                Copy install command
              </button>
            )}
            <button type="button" disabled={!ready} className={cn("whitespace-nowrap rounded border px-2 py-0.5 text-[11px] disabled:opacity-40", engine === a.id ? "border-primary/50 text-primary" : "border-border/60 hover:bg-muted")} onClick={() => setEngine(engine === a.id ? "gear" : a.id)}>
              {engine === a.id ? "In use" : "Use"}
            </button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
        <span>{engine === "gear" ? "The AI panel uses Gear AI with the providers below." : "Gear AI with the providers below is still there: pick it in the AI panel header."}</span>
        <button type="button" className="underline" onClick={refresh}>
          Check again
        </button>
      </div>
    </div>
  );
}
