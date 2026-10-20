// The parts of the Agent Client Protocol (v1) Gear speaks, and a pure
// reducer that turns an agent's session updates into a conversation.
// Reference: the @agentclientprotocol/sdk schema (protocol version 1).

export const PROTOCOL_VERSION = 1;

export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "resource_link"; uri: string; name: string } | { type: string; [k: string]: unknown };

export interface DiffContent {
  type: "diff";
  path: string;
  oldText?: string | null;
  newText: string;
}
export type ToolCallContent = { type: "content"; content: ContentBlock } | DiffContent | { type: "terminal"; terminalId: string };

export interface ToolCallFields {
  toolCallId: string;
  title?: string | null;
  kind?: ToolKind | null;
  status?: ToolStatus | null;
  content?: ToolCallContent[] | null;
  locations?: { path: string; line?: number | null }[] | null;
  rawInput?: unknown;
}

export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export type SessionUpdate =
  | { sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk"; content: ContentBlock; messageId?: string | null }
  | (ToolCallFields & { sessionUpdate: "tool_call" | "tool_call_update" })
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: string; [k: string]: unknown };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionRequest {
  sessionId: string;
  toolCall: ToolCallFields;
  options: PermissionOption[];
}

export type PermissionOutcome = { outcome: "cancelled" } | { outcome: "selected"; optionId: string };

export interface AuthMethod {
  id: string;
  name: string;
  description?: string | null;
  type?: string;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: { loadSession?: boolean; promptCapabilities?: { image?: boolean; embeddedContext?: boolean } };
  authMethods?: AuthMethod[];
  agentInfo?: { name: string; version?: string; title?: string } | null;
}

export interface NewSessionResult {
  sessionId: string;
  modes?: { currentModeId: string; availableModes: { id: string; name: string; description?: string | null }[] } | null;
}

// ---------------------------------------------------------------- conversation

export interface ToolItem {
  kind: "tool";
  id: string;
  title: string;
  toolKind: ToolKind;
  status: ToolStatus;
  diffs: DiffContent[];
  text: string;
  locations: { path: string; line?: number | null }[];
}

export type Item =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "thought"; text: string }
  | ToolItem
  | { kind: "plan"; entries: PlanEntry[] }
  | { kind: "notice"; text: string; tone: "info" | "error" };

const blockText = (c: ContentBlock): string => (c.type === "text" && typeof c.text === "string" ? c.text : c.type === "resource_link" ? `[${String((c as { name?: string }).name ?? "")}]` : "");

function toolText(content: ToolCallContent[] | null | undefined): string {
  return (content ?? [])
    .filter((c): c is { type: "content"; content: ContentBlock } => c.type === "content")
    .map((c) => blockText(c.content))
    .filter(Boolean)
    .join("\n");
}

const diffsOf = (content: ToolCallContent[] | null | undefined): DiffContent[] => (content ?? []).filter((c): c is DiffContent => c.type === "diff");

/** Folds one update into the conversation; returns a new array (or the same one when nothing changes). */
export function applyUpdate(items: Item[], u: SessionUpdate): Item[] {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "user_message_chunk": {
      const kind = u.sessionUpdate === "agent_message_chunk" ? "agent" : u.sessionUpdate === "agent_thought_chunk" ? "thought" : "user";
      const text = blockText((u as { content: ContentBlock }).content);
      if (!text) return items;
      const last = items[items.length - 1];
      if (last && last.kind === kind) return [...items.slice(0, -1), { ...last, text: last.text + text }];
      return [...items, { kind, text } as Item];
    }
    case "tool_call":
    case "tool_call_update": {
      const t = u as ToolCallFields;
      const i = items.findIndex((x) => x.kind === "tool" && x.id === t.toolCallId);
      const prev = i >= 0 ? (items[i] as ToolItem) : null;
      const next: ToolItem = {
        kind: "tool",
        id: t.toolCallId,
        title: t.title ?? prev?.title ?? "Tool call",
        toolKind: t.kind ?? prev?.toolKind ?? "other",
        status: t.status ?? prev?.status ?? "pending",
        diffs: t.content ? diffsOf(t.content) : (prev?.diffs ?? []),
        text: t.content ? toolText(t.content) : (prev?.text ?? ""),
        locations: t.locations ?? prev?.locations ?? [],
      };
      if (i < 0) return [...items, next];
      return [...items.slice(0, i), next, ...items.slice(i + 1)];
    }
    case "plan": {
      const entries = (u as { entries: PlanEntry[] }).entries ?? [];
      const i = items.map((x) => x.kind).lastIndexOf("plan");
      if (i >= 0) return [...items.slice(0, i), { kind: "plan", entries }, ...items.slice(i + 1)];
      return [...items, { kind: "plan", entries }];
    }
    default:
      return items;
  }
}

/** The plain text of the agent's replies after the last user message (for one-shot helpers). */
export function lastAgentText(items: Item[]): string {
  const start = items.map((x) => x.kind).lastIndexOf("user") + 1;
  return items
    .slice(start)
    .filter((x): x is { kind: "agent"; text: string } => x.kind === "agent")
    .map((x) => x.text)
    .join("")
    .trim();
}

/** The option to pick for an automatic answer: allow-once when allowed, else reject-once (or the closest). */
export function autoAnswer(options: PermissionOption[], allow: boolean): PermissionOutcome {
  const order = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of order) {
    const o = options.find((x) => x.kind === kind);
    if (o) return { outcome: "selected", optionId: o.optionId };
  }
  return { outcome: "cancelled" };
}

/** JSON-RPC error codes ACP agents use for "sign in first". */
export const AUTH_REQUIRED = -32000;

export function isAuthError(e: unknown): boolean {
  const err = e as { code?: number; message?: string } | null;
  return !!err && (err.code === AUTH_REQUIRED || /auth(entication)? required|not (logged|signed) in|please (log|sign) ?in|\/login/i.test(err.message ?? ""));
}
