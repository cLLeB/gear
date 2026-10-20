// The conversation with an ACP agent (Claude Code, Codex, Gemini CLI):
// replies, thoughts, tool calls with their diffs, the plan, and the
// permission questions the agent asks before it edits or runs anything.

import { useEffect, useState } from "react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { agentDef, type AgentId, type Availability, detectAgents } from "./agents";
import type { DiffContent, Item, ToolItem } from "./protocol";
import { useAcpStore } from "./store";

const TOOL_ICON: Record<string, string> = { read: "📄", edit: "✏️", delete: "🗑", move: "↔", search: "🔍", execute: "▶", think: "💭", fetch: "🌐", other: "•", switch_mode: "⇄" };
const STATUS_STYLE: Record<string, string> = { pending: "text-muted-foreground", in_progress: "text-sky-600", completed: "text-emerald-600", failed: "text-red-600" };

function openPath(path: string, line?: number | null) {
  const root = app().workspaceRoot() ?? "";
  const abs = /^([a-zA-Z]:)?[\\/]/.test(path) ? path : `${root.replace(/[\\/]+$/, "")}/${path}`;
  app().openFile(abs, line ?? undefined);
}

/** A compact line diff: removed lines from the old text, added from the new. */
export function diffLines(oldText: string | null | undefined, newText: string): { sign: " " | "-" | "+"; text: string }[] {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const ctx = (lines: string[]) => lines.map((text) => ({ sign: " " as const, text }));
  return [...ctx(a.slice(Math.max(0, start - 2), start)), ...a.slice(start, endA + 1).map((text) => ({ sign: "-" as const, text })), ...b.slice(start, endB + 1).map((text) => ({ sign: "+" as const, text })), ...ctx(b.slice(endB + 1, endB + 3))];
}

function DiffView({ d }: { d: DiffContent }) {
  const lines = diffLines(d.oldText, d.newText);
  const shown = lines.slice(0, 80);
  return (
    <div className="mt-1 overflow-hidden rounded border border-border/50">
      <button type="button" className="block w-full truncate bg-muted/50 px-2 py-0.5 text-left font-mono text-[11px] hover:underline" onClick={() => openPath(d.path)}>
        {d.oldText == null ? "new file " : ""}
        {d.path}
      </button>
      <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-snug">
        {shown.map((l, i) => (
          <div key={i} className={cn("px-2", l.sign === "+" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", l.sign === "-" && "bg-red-500/10 text-red-700 dark:text-red-300")}>
            {l.sign} {l.text}
          </div>
        ))}
        {lines.length > shown.length && <div className="px-2 text-muted-foreground">… {lines.length - shown.length} more lines</div>}
      </pre>
    </div>
  );
}

function ToolView({ t }: { t: ToolItem }) {
  const [open, setOpen] = useState(t.diffs.length > 0);
  return (
    <div className="rounded-md border border-border/50 px-2 py-1" data-acp-tool={t.toolKind}>
      <button type="button" className="flex w-full items-baseline gap-1.5 text-left" onClick={() => setOpen(!open)}>
        <span className="w-4 shrink-0 text-center">{TOOL_ICON[t.toolKind] ?? "•"}</span>
        <span className="min-w-0 flex-1 truncate text-[12px]">{t.title}</span>
        <span className={cn("shrink-0 text-[10.5px]", STATUS_STYLE[t.status])}>{t.status.replace("_", " ")}</span>
      </button>
      {open && (
        <div className="pl-5">
          {t.locations.slice(0, 5).map((l, i) => (
            <button key={i} type="button" className="mr-2 font-mono text-[11px] text-primary hover:underline" onClick={() => openPath(l.path, l.line)}>
              {l.path}
              {l.line ? `:${l.line}` : ""}
            </button>
          ))}
          {t.diffs.map((d, i) => (
            <DiffView key={i} d={d} />
          ))}
          {t.text && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-1.5 font-mono text-[11px]">{t.text.slice(0, 8000)}</pre>}
        </div>
      )}
    </div>
  );
}

function ItemView({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return <div className="ml-8 self-end whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-[12.5px]" data-acp-user>{item.text}</div>;
    case "agent":
      return (
        <div className="text-[12.5px]" data-acp-agent>
          <MessageResponse>{item.text}</MessageResponse>
        </div>
      );
    case "thought":
      return <div className="border-l-2 border-border pl-2 text-[11.5px] italic text-muted-foreground">{item.text}</div>;
    case "tool":
      return <ToolView t={item} />;
    case "plan":
      return (
        <div className="rounded-md border border-border/50 px-2 py-1.5" data-acp-plan>
          <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">Plan</div>
          {item.entries.map((e, i) => (
            <div key={i} className={cn("flex gap-1.5 text-[12px]", e.status === "completed" && "text-muted-foreground line-through")}>
              <span>{e.status === "completed" ? "✓" : e.status === "in_progress" ? "›" : "○"}</span>
              <span>{e.content}</span>
            </div>
          ))}
        </div>
      );
    case "notice":
      return <div className={cn("text-[11.5px]", item.tone === "error" ? "text-red-600" : "text-muted-foreground")}>{item.text}</div>;
  }
}

function Permissions() {
  const permissions = useAcpStore((s) => s.permissions);
  const answer = useAcpStore((s) => s.answer);
  if (!permissions.length) return null;
  const p = permissions[0];
  const t = p.request.toolCall;
  const diffs = (t.content ?? []).filter((c): c is DiffContent => c.type === "diff");
  return (
    <div className="border-t border-amber-500/40 bg-amber-500/10 p-2" data-acp-permission>
      <div className="mb-1 text-[12px] font-medium">Allow this?</div>
      <div className="text-[12px]">{t.title ?? "The agent wants to use a tool."}</div>
      {diffs.map((d, i) => (
        <DiffView key={i} d={d} />
      ))}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {p.request.options.map((o) => (
          <button
            key={o.optionId}
            type="button"
            data-acp-option={o.kind}
            onClick={() => answer(p.id, { outcome: "selected", optionId: o.optionId })}
            className={cn("rounded border px-2 py-0.5 text-[11.5px]", o.kind.startsWith("allow") ? "border-emerald-600/40 bg-emerald-600/10 hover:bg-emerald-600/20" : "border-border/60 hover:bg-muted")}
          >
            {o.name}
          </button>
        ))}
      </div>
      {permissions.length > 1 && <div className="mt-1 text-[11px] text-muted-foreground">{permissions.length - 1} more waiting</div>}
    </div>
  );
}

function Setup({ agent, avail }: { agent: AgentId; avail: Availability | null }) {
  const def = agentDef(agent);
  const a = avail?.[agent];
  const status = useAcpStore((s) => s.status);
  const authMethods = useAcpStore((s) => s.authMethods);
  const signIn = useAcpStore((s) => s.signIn);
  const runInTerminal = (cmd: string) => app().openTerminal({ command: cmd });
  if (status === "signin")
    return (
      <div className="space-y-2 p-3 text-[12px]" data-acp-signin>
        <div className="font-medium">Sign in to {def.name}</div>
        <div className="text-muted-foreground">{def.name} uses your {def.plan} account. Sign in once in a terminal, then send your message again.</div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="rounded border border-border/60 px-2 py-0.5 hover:bg-muted" onClick={() => runInTerminal(def.signIn)}>
            Open a terminal and run <span className="font-mono">{def.signIn}</span>
          </button>
          {authMethods.map((m) => (
            <button key={m.id} type="button" className="rounded border border-border/60 px-2 py-0.5 hover:bg-muted" title={m.description ?? undefined} onClick={() => void signIn(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      </div>
    );
  if (a && (!a.installed || !a.launcher))
    return (
      <div className="space-y-2 p-3 text-[12px]" data-acp-install>
        <div className="font-medium">{def.name} is not installed</div>
        <div className="text-muted-foreground">{!a.launcher ? "Node.js (npx) is needed to start it. " : ""}Install it, sign in with your {def.plan} account, and come back:</div>
        <button type="button" className="rounded border border-border/60 px-2 py-0.5 font-mono hover:bg-muted" onClick={() => runInTerminal(`${def.install}; ${def.signIn}`)}>
          {def.install}
        </button>
      </div>
    );
  return null;
}

/** The AI panel's body while an ACP agent is the engine. */
export function AcpConversation({ agent }: { agent: AgentId }) {
  const items = useAcpStore((s) => s.items);
  const status = useAcpStore((s) => s.status);
  const error = useAcpStore((s) => s.error);
  const reset = useAcpStore((s) => s.reset);
  const [avail, setAvail] = useState<Availability | null>(null);
  useEffect(() => {
    void detectAgents().then(setAvail);
  }, []);
  const def = agentDef(agent);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-acp-conversation={agent}>
      <Setup agent={agent} avail={avail} />
      <Conversation>
        <ConversationContent className="gap-3 p-3">
          {items.length === 0 && status !== "signin" ? (
            <ConversationEmptyState title={`Ask ${def.name}`} description={`Runs on your ${def.plan} account in this folder. It asks before it edits files or runs commands.`} />
          ) : (
            items.map((it, i) => <ItemView key={i} item={it} />)
          )}
          {(status === "starting" || status === "working") && (
            <div className="text-[11.5px] text-muted-foreground" data-acp-status={status}>
              {status === "starting" ? `Starting ${def.name}…` : "Working…"}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-acp-error>
              <pre className="whitespace-pre-wrap font-sans">{error}</pre>
              <button type="button" className="mt-1 underline" onClick={() => void reset()}>
                Start over
              </button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <Permissions />
    </div>
  );
}
