// One debug session: runs the DAP startup handshake, tracks run state,
// threads and the stopped stack, and exposes stepping, variables,
// evaluation and breakpoint updates. UI-free — the store subscribes.

import { type DapClient, DapError } from "./dapClient";

export interface SourceBreakpoint {
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  enabled: boolean;
}

export interface StackFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  path: string | null;
  sourceName: string | null;
  /** "subtle" / "deemphasize" frames are library code. */
  presentationHint?: string;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  evaluateName?: string;
}

export interface Scope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}

export type SessionStatus = "starting" | "running" | "stopped" | "ended";

export interface SessionState {
  status: SessionStatus;
  threads: { id: number; name: string }[];
  stoppedThreadId: number | null;
  stopReason: string | null;
  stopDescription: string | null;
  frames: StackFrame[];
  exitCode: number | null;
  /** path → verified flag per enabled breakpoint, in request order. */
  verified: Record<string, { line: number; verified: boolean; message?: string }[]>;
  error: string | null;
}

export interface DebugConfig {
  name: string;
  /** Adapter id sent in `initialize` (e.g. "python", "go", "gdb", "pwa-node"). */
  adapterId: string;
  request: "launch" | "attach";
  /** Everything else from the launch configuration, passed through to the adapter. */
  args: Record<string, unknown>;
}

export interface SessionHooks {
  breakpoints: () => Map<string, SourceBreakpoint[]>;
  exceptionFilters: () => string[];
  onState: (s: SessionState) => void;
  onOutput: (category: string, text: string) => void;
  runInTerminal?: (args: { kind?: string; title?: string; cwd: string; args: string[]; env?: Record<string, string | null> }) => Promise<{ processId?: number }>;
  startChild?: (config: Record<string, unknown>, request: "launch" | "attach") => Promise<void>;
}

export interface Capabilities {
  supportsConfigurationDoneRequest?: boolean;
  supportsConditionalBreakpoints?: boolean;
  supportsHitConditionalBreakpoints?: boolean;
  supportsLogPoints?: boolean;
  supportsTerminateRequest?: boolean;
  supportsRestartRequest?: boolean;
  supportsSetVariable?: boolean;
  supportsEvaluateForHovers?: boolean;
  exceptionBreakpointFilters?: { filter: string; label: string; default?: boolean }[];
}

export class DebugSession {
  caps: Capabilities = {};
  state: SessionState = { status: "starting", threads: [], stoppedThreadId: null, stopReason: null, stopDescription: null, frames: [], exitCode: null, verified: {}, error: null };

  constructor(
    readonly client: DapClient,
    readonly config: DebugConfig,
    private readonly hooks: SessionHooks,
  ) {
    client.on("output", (b) => {
      const cat = String(b.category ?? "console");
      if (cat === "telemetry") return;
      hooks.onOutput(cat, String(b.output ?? ""));
    });
    client.on("stopped", (b) => void this.onStopped(b));
    client.on("continued", (b) => {
      if (b.allThreadsContinued !== false || b.threadId === this.state.stoppedThreadId) this.set({ status: "running", frames: [], stoppedThreadId: null, stopReason: null, stopDescription: null });
    });
    client.on("thread", () => void this.refreshThreads());
    client.on("exited", (b) => this.set({ exitCode: typeof b.exitCode === "number" ? b.exitCode : null }));
    client.on("terminated", () => this.end());
    client.on("breakpoint", (b) => this.onBreakpointEvent(b));
    client.onClose((info) => {
      if (this.state.status !== "ended") {
        if (info.output.trim() && this.state.status === "starting") hooks.onOutput("stderr", `${info.output}\n`);
        this.end();
      }
    });
    client.handle("runInTerminal", async (a) => {
      if (!hooks.runInTerminal) throw new Error("runInTerminal is not supported");
      return hooks.runInTerminal(a as Parameters<NonNullable<SessionHooks["runInTerminal"]>>[0]);
    });
    client.handle("startDebugging", async (a) => {
      const { configuration, request } = a as { configuration: Record<string, unknown>; request: "launch" | "attach" };
      if (!hooks.startChild) throw new Error("startDebugging is not supported");
      await hooks.startChild(configuration, request);
      return {};
    });
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.hooks.onState(this.state);
  }

  private end(): void {
    if (this.state.status === "ended") return;
    this.set({ status: "ended", frames: [], stoppedThreadId: null });
    // Give the adapter a moment to flush, then drop the transport.
    setTimeout(() => this.client.dispose(), 300);
  }

  /** initialize → launch/attach → (initialized) breakpoints → configurationDone. */
  async start(): Promise<void> {
    const initialized = this.client.waitFor("initialized", 30_000);
    initialized.catch(() => {});
    try {
      this.caps = await this.client.request<Capabilities>("initialize", {
        clientID: "gear",
        clientName: "Gear",
        adapterID: this.config.adapterId,
        pathFormat: "path",
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsVariablePaging: false,
        supportsRunInTerminalRequest: !!this.hooks.runInTerminal,
        supportsStartDebuggingRequest: !!this.hooks.startChild,
        supportsInvalidatedEvent: false,
        supportsProgressReporting: false,
        locale: "en",
      });
      this.caps ??= {};
      // Adapters differ: gdb and Delve announce `initialized` right after initialize and
      // expect breakpoints before launch (gdb starts the program on launch); debugpy only
      // sends it after launch and answers launch after configurationDone.
      let early = false;
      await Promise.race([initialized.then(() => (early = true)), new Promise((r) => setTimeout(r, 400))]);
      if (early) {
        const failed = await this.syncAllBreakpoints();
        await this.syncExceptionFilters();
        const launched = this.client.request(this.config.request, { name: this.config.name, ...this.config.args }, 0);
        launched.catch(() => {});
        if (this.caps.supportsConfigurationDoneRequest !== false) {
          // Some adapters want configurationDone before they answer launch, others after.
          const done = this.client.request("configurationDone", {}).catch(() => {});
          await Promise.race([launched, done]);
          await done;
        }
        await launched;
        // Adapters that reject breakpoints before the debuggee exists get them now.
        for (const path of failed) await this.syncBreakpoints(path);
      } else {
        const launched = this.client.request(this.config.request, { name: this.config.name, ...this.config.args }, 0);
        launched.catch(() => {});
        await Promise.race([initialized, launched.then(() => initialized)]);
        await this.syncAllBreakpoints();
        await this.syncExceptionFilters();
        if (this.caps.supportsConfigurationDoneRequest !== false) await this.client.request("configurationDone", {});
        await launched;
      }
      if (this.state.status === "starting") this.set({ status: "running" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.set({ error: msg });
      this.hooks.onOutput("stderr", `${msg}\n`);
      await this.stop().catch(() => {});
      this.end();
      throw e;
    }
  }

  private async onStopped(b: Record<string, unknown>): Promise<void> {
    const threadId = typeof b.threadId === "number" ? b.threadId : this.state.threads[0]?.id ?? null;
    await this.refreshThreads();
    const tid = threadId ?? this.state.threads[0]?.id ?? null;
    const frames = tid !== null ? await this.stackTrace(tid).catch(() => []) : [];
    this.set({ status: "stopped", stoppedThreadId: tid, stopReason: String(b.reason ?? "pause"), stopDescription: (b.text ?? b.description ?? null) as string | null, frames });
  }

  async refreshThreads(): Promise<void> {
    try {
      const r = await this.client.request<{ threads: { id: number; name: string }[] }>("threads", undefined, 10_000);
      this.set({ threads: r.threads ?? [] });
    } catch {
      /* the adapter may be busy running */
    }
  }

  async stackTrace(threadId: number, levels = 200): Promise<StackFrame[]> {
    const r = await this.client.request<{ stackFrames: { id: number; name: string; line: number; column: number; source?: { path?: string; name?: string }; presentationHint?: string }[] }>("stackTrace", { threadId, startFrame: 0, levels });
    return (r.stackFrames ?? []).map((f) => ({ id: f.id, name: f.name, line: f.line, column: f.column, path: f.source?.path ?? null, sourceName: f.source?.name ?? null, presentationHint: f.presentationHint }));
  }

  async selectThread(threadId: number): Promise<void> {
    const frames = await this.stackTrace(threadId).catch(() => []);
    this.set({ stoppedThreadId: threadId, frames });
  }

  async scopes(frameId: number): Promise<Scope[]> {
    const r = await this.client.request<{ scopes: Scope[] }>("scopes", { frameId });
    return r.scopes ?? [];
  }

  async variables(variablesReference: number): Promise<Variable[]> {
    const r = await this.client.request<{ variables: Variable[] }>("variables", { variablesReference });
    return r.variables ?? [];
  }

  async evaluate(expression: string, frameId: number | null, context: "repl" | "watch" | "hover" = "repl"): Promise<{ result: string; type?: string; variablesReference: number }> {
    return this.client.request("evaluate", { expression, frameId: frameId ?? undefined, context });
  }

  async setVariable(variablesReference: number, name: string, value: string): Promise<{ value: string }> {
    if (!this.caps.supportsSetVariable) throw new DapError("This debugger can't change variables", "setVariable");
    return this.client.request("setVariable", { variablesReference, name, value });
  }

  private tid(): number {
    const t = this.state.stoppedThreadId ?? this.state.threads[0]?.id;
    if (t === undefined || t === null) throw new DapError("No thread", "step");
    return t;
  }

  private resumed(): void {
    this.set({ status: "running", frames: [], stopReason: null, stopDescription: null });
  }

  async continue(): Promise<void> {
    await this.client.request("continue", { threadId: this.tid() });
    this.resumed();
  }

  async next(): Promise<void> {
    await this.client.request("next", { threadId: this.tid() });
    this.resumed();
  }

  async stepIn(): Promise<void> {
    await this.client.request("stepIn", { threadId: this.tid() });
    this.resumed();
  }

  async stepOut(): Promise<void> {
    await this.client.request("stepOut", { threadId: this.tid() });
    this.resumed();
  }

  async pause(): Promise<void> {
    await this.client.request("pause", { threadId: this.state.threads[0]?.id ?? 1 });
  }

  async stop(): Promise<void> {
    if (this.client.closed) return;
    try {
      if (this.caps.supportsTerminateRequest && this.config.request === "launch") await this.client.request("terminate", {}, 5_000);
      else await this.client.request("disconnect", { terminateDebuggee: this.config.request === "launch" }, 5_000);
    } catch {
      await this.client.request("disconnect", { terminateDebuggee: true }, 3_000).catch(() => {});
    }
  }

  /** Send the breakpoints of one file (all of them, as DAP requires). */
  async syncBreakpoints(path: string): Promise<boolean> {
    if (this.state.status === "ended") return false;
    const bps = (this.hooks.breakpoints().get(path) ?? []).filter((b) => b.enabled);
    try {
      const r = await this.client.request<{ breakpoints: { verified: boolean; line?: number; message?: string }[] }>("setBreakpoints", {
        source: { path, name: path.replace(/^.*[\\/]/, "") },
        breakpoints: bps.map((b) => ({
          line: b.line,
          ...(b.condition && this.caps.supportsConditionalBreakpoints !== false ? { condition: b.condition } : {}),
          ...(b.hitCondition && this.caps.supportsHitConditionalBreakpoints ? { hitCondition: b.hitCondition } : {}),
          ...(b.logMessage && this.caps.supportsLogPoints ? { logMessage: b.logMessage } : {}),
        })),
        lines: bps.map((b) => b.line),
        sourceModified: false,
      });
      const verified = { ...this.state.verified, [path]: bps.map((b, i) => ({ line: r.breakpoints?.[i]?.line ?? b.line, verified: !!r.breakpoints?.[i]?.verified, message: r.breakpoints?.[i]?.message })) };
      this.set({ verified });
      return true;
    } catch (e) {
      if (this.state.status !== "starting") this.hooks.onOutput("stderr", `Breakpoints for ${path}: ${e instanceof Error ? e.message : e}\n`);
      return false;
    }
  }

  /** Returns the paths whose breakpoints the adapter rejected. */
  private async syncAllBreakpoints(): Promise<string[]> {
    const failed: string[] = [];
    for (const path of this.hooks.breakpoints().keys()) if (!(await this.syncBreakpoints(path))) failed.push(path);
    return failed;
  }

  async syncExceptionFilters(): Promise<void> {
    const available = new Set((this.caps.exceptionBreakpointFilters ?? []).map((f) => f.filter));
    if (!available.size) return;
    const filters = this.hooks.exceptionFilters().filter((f) => available.has(f));
    await this.client.request("setExceptionBreakpoints", { filters }).catch(() => {});
  }

  private onBreakpointEvent(b: Record<string, unknown>): void {
    const bp = b.breakpoint as { verified?: boolean; line?: number; source?: { path?: string } } | undefined;
    const path = bp?.source?.path;
    if (!bp || !path || !this.state.verified[path]) return;
    const list = this.state.verified[path].map((v) => (v.line === bp.line ? { ...v, verified: !!bp.verified } : v));
    this.set({ verified: { ...this.state.verified, [path]: list } });
  }
}
