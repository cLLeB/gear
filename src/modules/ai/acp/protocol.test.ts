import { describe, expect, it } from "vitest";
import { applyUpdate, autoAnswer, isAuthError, type Item, lastAgentText, type SessionUpdate } from "./protocol";

const fold = (updates: SessionUpdate[], start: Item[] = []) => updates.reduce(applyUpdate, start);

describe("ACP conversation reducer", () => {
  it("joins streamed message and thought chunks", () => {
    const items = fold([
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Looking " } },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "around." } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: ", world" } },
    ]);
    expect(items).toEqual([
      { kind: "thought", text: "Looking around." },
      { kind: "agent", text: "Hello, world" },
    ]);
  });

  it("tracks a tool call through its updates, keeping diffs and output", () => {
    const items = fold([
      { sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit src/a.ts", kind: "edit", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", content: [{ type: "diff", path: "src/a.ts", oldText: "a", newText: "b" }], locations: [{ path: "src/a.ts", line: 3 }] },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
      { sessionUpdate: "tool_call", toolCallId: "t2", title: "Run tests", kind: "execute" },
      { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "failed", content: [{ type: "content", content: { type: "text", text: "1 failed" } }] },
    ]);
    expect(items).toEqual([
      { kind: "tool", id: "t1", title: "Edit src/a.ts", toolKind: "edit", status: "completed", diffs: [{ type: "diff", path: "src/a.ts", oldText: "a", newText: "b" }], text: "", locations: [{ path: "src/a.ts", line: 3 }] },
      { kind: "tool", id: "t2", title: "Run tests", toolKind: "execute", status: "failed", diffs: [], text: "1 failed", locations: [] },
    ]);
  });

  it("replaces the plan in place and ignores updates it does not render", () => {
    const items = fold([
      { sessionUpdate: "plan", entries: [{ content: "Read", priority: "high", status: "in_progress" }] },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
      { sessionUpdate: "plan", entries: [{ content: "Read", priority: "high", status: "completed" }] },
      { sessionUpdate: "available_commands_update", availableCommands: [] },
    ]);
    expect(items).toEqual([
      { kind: "plan", entries: [{ content: "Read", priority: "high", status: "completed" }] },
      { kind: "agent", text: "ok" },
    ]);
  });

  it("reads the latest answer for one-shot helpers", () => {
    const items: Item[] = [
      { kind: "user", text: "q1" },
      { kind: "agent", text: "a1" },
      { kind: "user", text: "q2" },
      { kind: "thought", text: "hmm" },
      { kind: "agent", text: " a2 " },
    ];
    expect(lastAgentText(items)).toBe("a2");
  });

  it("answers permission requests automatically", () => {
    const options = [
      { optionId: "a", name: "Allow", kind: "allow_once" as const },
      { optionId: "r", name: "Reject", kind: "reject_once" as const },
    ];
    expect(autoAnswer(options, true)).toEqual({ outcome: "selected", optionId: "a" });
    expect(autoAnswer(options, false)).toEqual({ outcome: "selected", optionId: "r" });
    expect(autoAnswer([{ optionId: "x", name: "Always", kind: "allow_always" }], false)).toEqual({ outcome: "cancelled" });
  });

  it("recognises sign-in errors", () => {
    expect(isAuthError({ code: -32000, message: "Authentication required" })).toBe(true);
    expect(isAuthError({ code: -32603, message: "Invalid API key · Please run /login" })).toBe(true);
    expect(isAuthError({ code: -32603, message: "boom" })).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe("ACP file reads", () => {
  it("slices by 1-based line and count", async () => {
    const { sliceLines } = await import("./client");
    const text = "a\nb\nc\nd";
    expect(sliceLines(text)).toBe(text);
    expect(sliceLines(text, 2, 2)).toBe("b\nc");
    expect(sliceLines(text, 3)).toBe("c\nd");
    expect(sliceLines(text, null, 1)).toBe("a");
  });
});
