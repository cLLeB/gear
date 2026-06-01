# Rewind — Session Time-Travel for gear

**Date:** 2026-06-01
**Status:** Design approved, pending implementation plan
**Feature name:** Rewind (user-facing) / Chronicle (engine)

---

## 1. Problem & Goal

gear is a capable Tauri 2 + React 19 AI terminal, but it currently presents as a
conventional "terminal with a chat sidebar," which makes it feel basic next to
other IDEs. The goal is to give gear **one signature, deeply-built capability that
no other IDE/terminal does well**: a **flight recorder for the entire dev session**.

Every command, file edit, AI-agent action, git transition, and diagnostic is
captured into a queryable, reversible timeline. The user can:

- **Scrub** backward/forward through the session visually.
- **Ask in natural language** ("why did the build break after 14:02?", "what changed
  in `auth.rs` since tests passed?") and get answers **grounded in real recorded
  events**, never hallucinated.
- **Blame across time** from any line of code.
- **Restore** a single file or **checkout an entire past moment into an isolated git
  worktree sandbox**, promoting it to live only when explicitly chosen.

Success criteria:

- Recording never blocks or noticeably slows the terminal or editor.
- Any past file state at time *T* can be reconstructed exactly and restored.
- NL answers cite specific, clickable timeline events.
- 100% local; nothing leaves the machine except a user-initiated, redacted query slice.

---

## 2. Reversibility Model (decided)

**Hybrid:** read-only by default, full rewind on demand.

- Scrubbing/inspecting the past **never** mutates the live workspace.
- Per-file restore writes a single reconstructed file (after auto-snapshotting current
  state, so the restore is itself reversible).
- Full rewind reconstructs the tree at *T* into a **git worktree sandbox**; the live
  workspace is untouched until the user explicitly **promotes** the sandbox.

---

## 3. Architecture & Module Layout

Chronicle is write-mostly and append-only on the hot path. Existing modules emit
events to an in-process bus and know nothing about storage (one-way dependency, low
coupling). All reads/queries are served lazily.

### Rust backend — `src-tauri/src/modules/chronicle/`

| File | Responsibility |
|------|----------------|
| `mod.rs` | Public API + Tauri commands: `chronicle_query`, `chronicle_range`, `chronicle_restore_file`, `chronicle_checkout_sandbox`, `chronicle_promote_sandbox`, `chronicle_blame` |
| `bus.rs` | In-process event sink. Modules emit `ChronicleEvent`; bounded channel + background drain task |
| `store.rs` | SQLite event log (`.gear/chronicle/timeline.db`) + FTS index |
| `blobs.rs` | Content-addressed zstd blob store (`.gear/chronicle/blobs/`), dedup + GC |
| `snapshot.rs` | Reconstruct virtual file tree at time *T*; drive per-file restore + sandbox checkout (delegates worktree creation to existing `git` module) |
| `query.rs` | Structured + FTS query builder; assembles grounded context slices for NL layer |
| `retention.rs` | Size/age caps, compaction, blob GC; runs on idle |

### Frontend — `src/modules/rewind/`

Mirrors existing module convention (`components/`, `lib/`, `store/`, `index.ts`).

| Path | Responsibility |
|------|----------------|
| `store/rewindStore.ts` | Zustand: timeline state, scrub position, selected range, sandbox sessions |
| `components/TimelineScrubber.tsx` | Slim horizontal scrubber, kind-colored markers |
| `components/TimelinePanel.tsx` | Expandable detail list for current range, filters |
| `components/RestoreQueue.tsx` | Actionable recovery list |
| `components/BlameGutter.tsx` | Editor gutter integration for blame-across-time |
| `components/TimelineQuery.tsx` | NL ask box |
| `lib/api.ts` | Tauri bridge |
| `lib/query.ts` | Query helpers |
| `lib/format.ts` | Event formatting for display |

AI integration: a new `timeline` tool in `src/modules/ai/tools/` so the existing
agent/chat answers timeline questions through the same grounded query path.

**Key principle:** capture must never block the PTY or editor. Each module's only
obligation is to fire an event at the bus — a few lines per integration point.

---

## 4. Data Model

### Event log (SQLite `timeline.db`, WAL mode)

```sql
events(
  id          INTEGER PRIMARY KEY,   -- monotonic, = timeline order
  ts          INTEGER,               -- unix millis
  session_id  TEXT,                  -- groups events per app launch
  kind        TEXT,                  -- 'cmd'|'cmd_output'|'file'|'agent'|'git'|'diag'|'proc'|'nav'
  actor       TEXT,                  -- 'user' | agent id
  cwd         TEXT,
  file_path   TEXT,                  -- extracted for file events (indexed); NULL otherwise
  summary     TEXT,                  -- short human label for the scrubber
  payload     TEXT,                  -- JSON, kind-specific, validated by Rust enum
  parent_id   INTEGER                -- causal link (output->cmd, agent step->run)
)
```

Kind-specific `payload` shapes (validated by a Rust enum so malformed events are never
written):

- `cmd` → `{command, exit_code, duration_ms, env_delta}`
- `cmd_output` → `{blob, bytes, truncated}` (output stored as blob, FTS-indexed)
- `file` → `{path, op: created|modified|deleted, before_blob, after_blob, added, removed}`
- `agent` → `{agent_id, step, tool, tool_args_digest, outcome}`
- `git` → `{op: commit|checkout|merge|stash, ref, sha}`
- `diag` → `{path, severity, count}`
- `proc` → `{name, op: start|stop, pid, port}`
- `nav` → `{target, url}`

Indexes: `(ts)`, `(kind, ts)`, `(session_id)`, `(file_path)`. FTS5 virtual table
`events_fts` over `summary` + captured output text.

### Blob store (`blobs/`)

Content-addressed: `blake3(content)` → `blobs/ab/cdef….zst`. Snapshots reference blobs
by hash → re-saving unchanged content costs nothing; a small edit stores small blobs,
not whole files. A `blob_refs` table tracks reachability for GC.

### Snapshot strategy

No per-keystroke snapshots. A `file` event (with `after_blob`) is written at meaningful
boundaries: file save, agent edit committed, pre-command, and a 1.5s idle debounce.
Reconstruct tree at *T*: for each path take the latest `after_blob` at-or-before *T*
(single grouped query) → fast checkout/restore, bounded storage.

### Output capture

Per-command stdout/stderr captured into a capped buffer (default 256 KB/command;
head+tail beyond that), stored as a blob and FTS-indexed.

---

## 5. Capture Layer

Each existing module gains a one-line emit at its boundary; the bus drains on a
background task.

- **PTY** (`pty/`): command start/exit → `cmd` + `cmd_output`. Output streamed into the
  capped buffer.
- **fs** (`fs/`): agent-edit and editor-save paths call `chronicle::record_file(path,
  before, after)`. Debounced watcher covers external edits.
- **git** (`git/`): wrap branch/commit/checkout/stash to emit `git` events.
- **agent** (`agent.rs` + `src/modules/ai`): subagent runner emits an `agent` event per
  step, linked by `parent_id` to its run. Enables "branch from before the bad run."
- **diagnostics / proc / nav**: lint results, dev-server lifecycle (`proc.rs`), preview
  navigations. Configurable; noisiest off by default.

**Back-pressure rule:** bounded channel. If it fills, drop low-value events (nav/diag)
before structural ones (cmd/file/agent/git), and surface a quiet "recording degraded"
indicator rather than stalling the UI.

---

## 6. Query & NL Layer

**Tier 1 — structured queries (instant, deterministic):** range fetch, by-kind filter,
file history, FTS text search. Power scrubber, blame gutter, and restore queue directly.

**Tier 2 — grounded NL query (signature):** the `timeline` AI tool. Flow:

1. User asks a question.
2. Tool runs structured/FTS queries to gather the **relevant slice** (time window,
   file history, error events).
3. The compact, event-id-cited slice is handed to the model (existing multi-provider
   AI SDK).
4. Answer **cites real events**; each citation click-jumps to that scrubber point.

The model reasons only over retrieved events — it never free-guesses file state.

---

## 7. Rewind / Restore

- **Read-only default:** scrubbing/inspecting never mutates the workspace.
- **Per-file restore:** reconstruct one blob to disk, after auto-snapshotting current
  state + confirm.
- **Sandbox checkout:** reconstruct full tree at *T* into a fresh git worktree under
  `.gear/chronicle/sandboxes/<id>`, open as a workspace; live workspace untouched.
- **Promote:** explicit action to make a sandbox live (guarded: dirty-state check +
  confirm).

---

## 8. UI Surfaces

- **TimelineScrubber** — slim horizontal bar (toggle from statusbar / `Cmd/Ctrl+Shift+T`),
  kind-colored markers, hover preview, drag range, right-click fork/checkout.
- **TimelinePanel** — expandable detail list for current range; filter by kind/actor;
  rows link to diff/output.
- **BlameGutter** — editor gutter: click a line → state-over-time, who/what changed it,
  test/build result at each point.
- **RestoreQueue** — diff-against-now, restore file, checkout-to-sandbox.
- **TimelineQuery** — NL ask box; also in command palette and AI chat.

---

## 9. Cross-Cutting Concerns

**Privacy:** 100% local. Only a user-initiated NL query slice leaves the machine (to the
already-configured AI provider), with existing `redact.ts` / secrets scrubbing applied.
Per-workspace `chronicle.enabled` + "pause recording" toggle. Env-delta secrets redacted
at capture.

**Retention:** configurable caps (default 7 days or 1 GB, whichever first). Compaction
collapses old fine-grained file events to daily keyframes. Blob GC reclaims unreferenced
content. All in `retention.rs`, runs on idle.

**Performance:** capture is fire-and-forget on a background task; bounded channel + drop
policy; WAL-mode SQLite; queries paginated/virtualized in the UI (`@tanstack/react-virtual`).

**Testing (TDD, 80%+ target):**
- Rust unit: blob dedup/GC, snapshot reconstruction at arbitrary *T*, retention/compaction,
  redaction.
- Rust integration: full record → query → restore → sandbox roundtrip.
- Frontend (vitest): store reducers, query formatting.

---

## 10. Phasing

1. **P1 — Engine + terminal/file capture + scrubber + per-file restore.** The spine;
   immediately useful.
2. **P2 — Git + agent capture, blame gutter, restore queue, sandbox checkout + promote.**
3. **P3 — Grounded NL query (signature) + diagnostics/proc/nav streams + retention/
   compaction polish.**

Each phase ships something usable; the "wow" (NL query) lands once the data it reasons
over is rich.

---

## 11. Out of Scope

- Remote/cloud sync of timelines (local-only by design).
- Real-time multi-user collaboration (explicitly excluded by gear's philosophy).
- Cross-session timeline merging beyond per-workspace retention.
