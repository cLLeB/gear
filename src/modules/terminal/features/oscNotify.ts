// Desktop notifications requested by programs through escape sequences:
//   OSC 9 ; <body>                    iTerm2 / ConEmu / Windows Terminal
//   OSC 777 ; notify ; <title> ; <body>   rxvt-unicode / WezTerm / foot
//   OSC 99 ; <metadata> ; <payload>   Kitty's protocol (title/body, chunked)
// OSC 9;4 is progress (handled separately) and numeric ConEmu subcommands
// are ignored. Gear's own agent-hook markers (777;notify;Gear;…) are skipped
// because the agent notifier already handles them.

export interface ProgramNotification {
  title: string | null;
  body: string;
}

const MAX_LEN = 500;
const clip = (s: string) => (s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s);

export function parseOsc9(data: string): ProgramNotification | null {
  if (/^\d+(;|$)/.test(data)) return null; // ConEmu subcommands, incl. 4 (progress)
  const body = data.trim();
  return body ? { title: null, body: clip(body) } : null;
}

export function parseOsc777(data: string): ProgramNotification | null {
  const parts = data.split(";");
  if (parts[0] !== "notify" || parts.length < 2) return null;
  const title = parts[1] ?? "";
  if (/^gear$/i.test(title)) return null; // Gear agent-hook marker
  const body = parts.slice(2).join(";").trim();
  if (!title.trim() && !body) return null;
  return body ? { title: clip(title.trim()) || null, body: clip(body) } : { title: null, body: clip(title.trim()) };
}

interface PendingKitty {
  title: string;
  body: string;
}

/** Assembles Kitty OSC 99 chunks (d=0 means "more to come") per identifier. */
export class Osc99Assembler {
  private pending = new Map<string, PendingKitty>();

  push(data: string): ProgramNotification | null {
    const semi = data.indexOf(";");
    if (semi === -1) return null;
    const meta = new Map(
      data
        .slice(0, semi)
        .split(":")
        .filter(Boolean)
        .map((kv) => {
          const eq = kv.indexOf("=");
          return [kv.slice(0, eq), kv.slice(eq + 1)] as [string, string];
        }),
    );
    let payload = data.slice(semi + 1);
    if (meta.get("e") === "1") {
      try {
        payload = new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)));
      } catch {
        return null;
      }
    }
    const kind = meta.get("p") ?? "title";
    if (kind !== "title" && kind !== "body") return null; // icons, buttons, queries
    const id = meta.get("i") ?? "";
    const cur = this.pending.get(id) ?? { title: "", body: "" };
    cur[kind] += payload;
    if (meta.get("d") === "0") {
      this.pending.set(id, cur);
      if (this.pending.size > 32) this.pending.delete(this.pending.keys().next().value!);
      return null;
    }
    this.pending.delete(id);
    if (!cur.title && !cur.body) return null;
    return cur.body ? { title: clip(cur.title) || null, body: clip(cur.body) } : { title: null, body: clip(cur.title) };
  }
}

/** Simple per-key rate limiter: true when allowed. */
export function createThrottle(intervalMs: number): (key: string, now?: number) => boolean {
  const last = new Map<string, number>();
  return (key, now = Date.now()) => {
    const prev = last.get(key);
    if (prev !== undefined && now - prev < intervalMs) return false;
    last.set(key, now);
    return true;
  };
}

// ------------------------------------------------------------- install

import { app } from "@/app/appBridge";
import { osNotify } from "@/modules/agents/lib/notify";
import { getFeature } from "@/modules/settings/useFeature";
import { toast } from "sonner";
import { registerTerminalExtension } from "../lib/useTerminalSession";

const throttle = createThrottle(3000);

function deliver(leafId: number, n: ProgramNotification): void {
  if (!getFeature("terminal.programNotifications") || !throttle(String(leafId))) return;
  const visible = app().activeTerminalLeaf() === leafId && document.hasFocus();
  const title = n.title ?? "Terminal";
  if (visible) toast.message(title, { description: n.body });
  else void osNotify(title, n.body);
}

export function installOscNotifications(): () => void {
  return registerTerminalExtension((leafId, term) => {
    const kitty = new Osc99Assembler();
    const handlers = [
      term.parser.registerOscHandler(9, (data) => {
        const n = parseOsc9(data);
        if (n) deliver(leafId, n);
        return n !== null; // let progress (9;4) reach its own handler
      }),
      term.parser.registerOscHandler(777, (data) => {
        const n = parseOsc777(data);
        if (n) deliver(leafId, n);
        return false;
      }),
      term.parser.registerOscHandler(99, (data) => {
        const n = kitty.push(data);
        if (n) deliver(leafId, n);
        return true;
      }),
    ];
    return () => handlers.forEach((h) => h.dispose());
  });
}
