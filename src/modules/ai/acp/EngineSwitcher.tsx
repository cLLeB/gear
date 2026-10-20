// Picks what answers in the AI panel: a coding agent on the user's own
// subscription (Claude Code, Codex, Gemini CLI) or Gear's built-in agent
// with an API key or a local model.

import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AGENTS, type Availability, detectAgents, type EngineId } from "./agents";
import { useAcpStore } from "./store";

export function engineLabel(engine: EngineId): string {
  return engine === "gear" ? "Gear AI" : (AGENTS.find((a) => a.id === engine)?.name ?? engine);
}

export function EngineSwitcher() {
  const engine = useAcpStore((s) => s.engine);
  const setEngine = useAcpStore((s) => s.setEngine);
  const [avail, setAvail] = useState<Availability | null>(null);
  useEffect(() => {
    void detectAgents().then(setAvail);
  }, []);

  const row = (id: EngineId, name: string, detail: string, ready: boolean | null) => (
    <DropdownMenuItem key={id} onSelect={() => setEngine(id)} data-engine-option={id} className={cn("flex items-start gap-2 pr-2 text-[12px]", id === engine && "bg-accent/40")}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          {name}
          {ready === false && <span className="rounded bg-muted px-1 text-[9.5px] text-muted-foreground">not installed</span>}
          {ready === true && <span className="rounded bg-emerald-500/15 px-1 text-[9.5px] text-emerald-700 dark:text-emerald-400">ready</span>}
        </span>
        <span className="line-clamp-1 text-[10.5px] text-muted-foreground">{detail}</span>
      </span>
      {id === engine && <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} className="mt-0.5 shrink-0" />}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu onOpenChange={(open) => open && void detectAgents(true).then(setAvail)}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 rounded-md px-1.5 text-[11.5px] font-medium" data-engine-switcher title="Choose who answers">
          {engineLabel(engine)}
          <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="px-2 pt-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Your subscription</div>
        {AGENTS.map((a) => row(a.id, a.name, `${a.plan} · no API key`, avail ? avail[a.id].installed && avail[a.id].launcher : null))}
        <DropdownMenuSeparator />
        <div className="px-2 pt-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">API key or local model</div>
        {row("gear", "Gear AI", "OpenAI, Anthropic, Google… or Ollama / LM Studio", null)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
