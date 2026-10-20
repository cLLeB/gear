// The agent engine the AI panel uses, and the live session with it. "gear"
// is Gear's built-in agent (needs an API key or a local model); the others
// run Claude Code, Codex or Gemini CLI on the user's own subscription.

import { create } from "zustand";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { type AgentId, agentDef, type EngineId } from "./agents";
import { AcpClient, sliceLines } from "./client";
import { applyUpdate, type AuthMethod, autoAnswer, isAuthError, type Item, lastAgentText, type PermissionOutcome, type PermissionRequest } from "./protocol";

const ENGINE_KEY = "gear.ai.engine";

function savedEngine(): EngineId {
  try {
    const v = localStorage.getItem(ENGINE_KEY);
    return v === "claude" || v === "codex" || v === "gemini" ? v : "gear";
  } catch {
    return "gear";
  }
}

export type Status = "idle" | "starting" | "working" | "signin" | "error";

interface PendingPermission {
  id: number;
  request: PermissionRequest;
  resolve: (o: PermissionOutcome) => void;
}

interface AcpState {
  engine: EngineId;
  status: Status;
  items: Item[];
  error: string | null;
  authMethods: AuthMethod[];
  permissions: PendingPermission[];
  /** Modes the agent offers (e.g. ask before edits, accept edits, plan). */
  modes: { id: string; name: string }[];
  modeId: string | null;
  setEngine: (e: EngineId) => void;
  send: (text: string, images?: { mimeType: string; data: string }[]) => Promise<void>;
  cancel: () => void;
  answer: (id: number, outcome: PermissionOutcome) => void;
  signIn: (methodId: string) => Promise<void>;
  setMode: (modeId: string) => void;
  reset: () => Promise<void>;
}

// The live connection is kept outside React state: it is not serialisable.
let client: AcpClient | null = null;
let sessionId: string | null = null;
let sessionCwd: string | null = null;
let permissionSeq = 0;

const cwdNow = () => app().workspaceRoot() ?? null;

function abs(path: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(path)) return path;
  const root = sessionCwd ?? cwdNow() ?? "";
  return `${root.replace(/[\\/]+$/, "")}/${path}`;
}

export const useAcpStore = create<AcpState>((set, get) => {
  const handlers = {
    onUpdate: (sid: string, update: Parameters<typeof applyUpdate>[1]) => {
      if (sid !== sessionId) return;
      set((s) => ({ items: applyUpdate(s.items, update) }));
      const u = update as { sessionUpdate: string; currentModeId?: string };
      if (u.sessionUpdate === "current_mode_update" && u.currentModeId) set({ modeId: u.currentModeId });
    },
    onPermission: (request: PermissionRequest) =>
      new Promise<PermissionOutcome>((resolve) => {
        const id = ++permissionSeq;
        set((s) => ({ permissions: [...s.permissions, { id, request, resolve }] }));
      }),
    readTextFile: async (path: string, line?: number | null, limit?: number | null) => {
      const r = await native.readFile(abs(path));
      if (r.kind !== "text") throw new Error(r.kind === "binary" ? `${path} is not a text file` : `${path} is too large to read`);
      return sliceLines(r.content, line, limit);
    },
    writeTextFile: async (path: string, content: string) => {
      await native.writeFile(abs(path), content, "agent");
    },
    onExit: () => {
      // Answer any open questions so nothing waits on a dead process.
      for (const p of get().permissions) p.resolve({ outcome: "cancelled" });
      client = null;
      sessionId = null;
      set((s) => ({ permissions: [], status: s.status === "working" || s.status === "starting" ? "error" : s.status }));
    },
  };

  /** Starts the agent and a session in the current workspace when needed. */
  const ensureSession = async (): Promise<boolean> => {
    const engine = get().engine;
    if (engine === "gear") return false;
    const cwd = cwdNow();
    if (client?.alive && sessionId && sessionCwd === cwd) return true;
    await stopClient();
    set({ status: "starting", error: null });
    const c = new AcpClient(agentDef(engine), handlers);
    client = c;
    try {
      const info = await c.start(cwd);
      try {
        const s = await c.newSession(cwd ?? ".");
        sessionId = s.sessionId;
        sessionCwd = cwd;
        set({ modes: s.modes?.availableModes.map((m) => ({ id: m.id, name: m.name })) ?? [], modeId: s.modes?.currentModeId ?? null, authMethods: [] });
        return true;
      } catch (e) {
        if (isAuthError(e)) {
          set({ status: "signin", authMethods: info.authMethods ?? [], error: null });
          return false;
        }
        throw e;
      }
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      await stopClient();
      return false;
    }
  };

  const stopClient = async () => {
    const c = client;
    client = null;
    sessionId = null;
    sessionCwd = null;
    if (c) await c.stop();
  };

  return {
    engine: savedEngine(),
    status: "idle",
    items: [],
    error: null,
    authMethods: [],
    permissions: [],
    modes: [],
    modeId: null,
    setEngine: (engine) => {
      try {
        localStorage.setItem(ENGINE_KEY, engine);
      } catch {
        /* storage unavailable */
      }
      if (engine === get().engine) return;
      void stopClient();
      set({ engine, status: "idle", items: [], error: null, authMethods: [], permissions: [], modes: [], modeId: null });
    },
    send: async (text, images = []) => {
      if (get().status === "working" || get().status === "starting") return;
      set((s) => ({ items: [...s.items, { kind: "user", text }], error: null }));
      if (!(await ensureSession()) || !client || !sessionId) return;
      set({ status: "working" });
      try {
        const prompt = [{ type: "text", text }, ...(client.info?.agentCapabilities?.promptCapabilities?.image ? images.map((i) => ({ type: "image", ...i })) : [])];
        const stop = await client.prompt(sessionId, prompt);
        set((s) => ({ status: "idle", items: stop === "refusal" ? [...s.items, { kind: "notice", tone: "error", text: "The agent declined to continue." }] : stop === "max_tokens" || stop === "max_turn_requests" ? [...s.items, { kind: "notice", tone: "info", text: "The agent stopped at its limit. Ask it to continue." }] : s.items }));
      } catch (e) {
        if (isAuthError(e)) set({ status: "signin", authMethods: client?.info?.authMethods ?? [] });
        else set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },
    cancel: () => {
      if (client && sessionId) client.cancel(sessionId);
      for (const p of get().permissions) p.resolve({ outcome: "cancelled" });
      set({ permissions: [] });
    },
    answer: (id, outcome) => {
      const p = get().permissions.find((x) => x.id === id);
      if (!p) return;
      p.resolve(outcome);
      set((s) => ({ permissions: s.permissions.filter((x) => x.id !== id) }));
    },
    signIn: async (methodId) => {
      if (!client) return;
      set({ status: "starting" });
      try {
        await client.authenticate(methodId);
        await stopClient();
        set({ status: "idle", authMethods: [] });
      } catch (e) {
        set({ status: "signin", error: e instanceof Error ? e.message : String(e) });
      }
    },
    setMode: (modeId) => {
      if (client && sessionId) void client.setMode(sessionId, modeId).then(() => set({ modeId }));
    },
    reset: async () => {
      await stopClient();
      set({ status: "idle", items: [], error: null, permissions: [], authMethods: [] });
    },
  };
});

/**
 * One question to the selected agent, for small helpers (commit messages,
 * explanations). Runs in its own short-lived session, refuses every tool
 * use, and returns the reply text.
 */
export async function acpOneShot(agent: AgentId, system: string, prompt: string): Promise<string> {
  let items: Item[] = [];
  let sid: string | null = null;
  const c = new AcpClient(agentDef(agent), {
    onUpdate: (s, u) => {
      if (s === sid) items = applyUpdate(items, u);
    },
    onPermission: async (req) => autoAnswer(req.options, false),
    readTextFile: async () => {
      throw new Error("Not available in a quick question");
    },
    writeTextFile: async () => {
      throw new Error("Not available in a quick question");
    },
  });
  try {
    await c.start(cwdNow());
    sid = (await c.newSession(cwdNow() ?? ".")).sessionId;
    await c.prompt(sid, [{ type: "text", text: `${system}\n\n${prompt}\n\nAnswer directly, without using tools.` }]);
    return lastAgentText(items);
  } catch (e) {
    if (isAuthError(e)) throw new Error(`Sign in to ${agentDef(agent).name} first: run \`${agentDef(agent).signIn}\` in a terminal.`);
    throw e;
  } finally {
    await c.stop();
  }
}
