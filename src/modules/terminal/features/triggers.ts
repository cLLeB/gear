// Triggers, after iTerm2: regex rules applied to terminal output as it
// arrives. One rule per line in the setting:
//
//   <regex> => highlight[:<color>]     colour the match in place
//   <regex> => notify[:<message>]      notification ($0/$1 substitute groups)
//   <regex> => bell                    ring the pane's bell badge
//
// Blank lines and lines starting with # are ignored. Regexes are
// case-sensitive unless written as /…/i.

export type TriggerAction = "highlight" | "notify" | "bell";

export interface TriggerRule {
  re: RegExp;
  action: TriggerAction;
  arg: string | null;
  source: string;
}

export interface TriggerParse {
  rules: TriggerRule[];
  errors: string[];
}

const NAMED_COLORS: Record<string, string> = {
  red: "#ef444466",
  yellow: "#eab30866",
  green: "#22c55e55",
  blue: "#3b82f655",
  purple: "#a855f755",
  orange: "#f9731666",
};

export function triggerColor(arg: string | null): string {
  if (!arg) return NAMED_COLORS.yellow;
  if (NAMED_COLORS[arg.toLowerCase()]) return NAMED_COLORS[arg.toLowerCase()];
  return /^#[0-9a-f]{3,8}$/i.test(arg) ? arg : NAMED_COLORS.yellow;
}

export function parseTriggers(spec: string): TriggerParse {
  const rules: TriggerRule[] = [];
  const errors: string[] = [];
  spec.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sep = line.lastIndexOf("=>");
    if (sep === -1) {
      errors.push(`Line ${i + 1}: expected "regex => action"`);
      return;
    }
    let pattern = line.slice(0, sep).trim();
    const [actionRaw, ...argParts] = line.slice(sep + 2).trim().split(":");
    const action = actionRaw.trim().toLowerCase() as TriggerAction;
    if (!["highlight", "notify", "bell"].includes(action)) {
      errors.push(`Line ${i + 1}: unknown action "${actionRaw.trim()}"`);
      return;
    }
    let flags = "g";
    const slashed = /^\/(.+)\/([imsu]*)$/.exec(pattern);
    if (slashed) {
      pattern = slashed[1];
      flags += slashed[2].replace(/g/g, "");
    }
    try {
      const re = new RegExp(pattern, flags);
      if (re.test("")) {
        errors.push(`Line ${i + 1}: the pattern matches empty text`);
        return;
      }
      re.lastIndex = 0;
      rules.push({ re, action, arg: argParts.length ? argParts.join(":").trim() || null : null, source: line });
    } catch (e) {
      errors.push(`Line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { rules, errors };
}

export interface TriggerHit {
  rule: TriggerRule;
  start: number;
  end: number;
  groups: string[];
}

export function matchTriggers(line: string, rules: readonly TriggerRule[]): TriggerHit[] {
  const hits: TriggerHit[] = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (const m of line.matchAll(rule.re)) {
      hits.push({ rule, start: m.index!, end: m.index! + m[0].length, groups: [...m] });
      if (rule.action !== "highlight") break; // one notification per line per rule
    }
  }
  return hits;
}

export function substituteGroups(template: string, groups: readonly string[]): string {
  return template.replace(/\$(\d)/g, (_, n: string) => groups[Number(n)] ?? "");
}

// ------------------------------------------------------------- install

import { osNotify } from "@/modules/agents/lib/notify";
import { getFeature } from "@/modules/settings/useFeature";
import type { IDecoration } from "@xterm/xterm";
import { toast } from "sonner";
import { registerTerminalExtension } from "../lib/useTerminalSession";
import { createThrottle } from "./oscNotify";
import { usePaneStatusStore } from "./paneStatus";

let cachedSpec = "";
let cachedRules: TriggerRule[] = [];
function currentRules(): TriggerRule[] {
  const spec = getFeature("terminal.triggers");
  if (spec !== cachedSpec) {
    cachedSpec = spec;
    cachedRules = parseTriggers(spec).rules;
  }
  return cachedRules;
}

const MAX_DECORATIONS = 2000;
const notifyThrottle = createThrottle(5000);

export function installTriggers(): () => void {
  return registerTerminalExtension((leafId, term) => {
    let nextLine = term.buffer.active.baseY + term.buffer.active.cursorY;
    const decorations: IDecoration[] = [];
    const sub = term.onWriteParsed(() => {
      const rules = currentRules();
      const buf = term.buffer.active;
      const cursorAbs = buf.baseY + buf.cursorY;
      if (rules.length === 0 || buf.type === "alternate") {
        nextLine = cursorAbs;
        return;
      }
      // Only complete lines (above the cursor) are scanned, once each.
      const from = Math.max(nextLine, cursorAbs - 500);
      for (let y = from; y < cursorAbs; y++) {
        const text = buf.getLine(y)?.translateToString(true) ?? "";
        if (!text) continue;
        for (const hit of matchTriggers(text, rules)) {
          if (hit.rule.action === "highlight") {
            const marker = term.registerMarker(y - cursorAbs);
            if (!marker) continue;
            const deco = term.registerDecoration({
              marker,
              x: hit.start,
              width: Math.max(1, hit.end - hit.start),
              backgroundColor: triggerColor(hit.rule.arg),
              layer: "bottom",
            });
            if (deco) {
              decorations.push(deco);
              if (decorations.length > MAX_DECORATIONS) decorations.shift()?.dispose();
            }
          } else if (hit.rule.action === "bell") {
            usePaneStatusStore.getState().setAttention(leafId, true);
          } else if (notifyThrottle(`${leafId}:${hit.rule.source}`)) {
            const body = hit.rule.arg ? substituteGroups(hit.rule.arg, hit.groups) : hit.groups[0];
            if (document.hasFocus()) toast.message("Trigger", { description: body });
            else void osNotify("Trigger", body);
          }
        }
      }
      nextLine = cursorAbs;
    });
    return () => {
      sub.dispose();
      for (const d of decorations) d.dispose();
    };
  });
}
