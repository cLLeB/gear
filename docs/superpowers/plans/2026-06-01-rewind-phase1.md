# Rewind — Phase 1 Implementation Plan (Engine Spine)

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up the Chronicle engine (SQLite event log + content-addressed zstd blob store), capture terminal commands and file edits, and expose a timeline scrubber + per-file restore in the UI.

**Architecture:** A new isolated Rust module `chronicle` owns storage. Existing modules emit `ChronicleEvent`s to an in-process bus (bounded channel, background drain) — they never touch storage directly. Snapshots are content-addressed blobs; reconstructing state at time *T* takes the latest blob per path at-or-before *T*. Frontend mirrors gear's module convention under `src/modules/rewind/`.

**Tech Stack:** Rust (rusqlite bundled, zstd, blake3), Tauri 2 commands, React 19 + Zustand + Tailwind, vitest.

---

## File Structure

Rust (`src-tauri/src/modules/chronicle/`):
- `mod.rs` — module exports, `ChronicleState`, Tauri commands
- `event.rs` — `ChronicleEvent`, `EventKind`, payload enums (serde)
- `bus.rs` — bounded channel sink + background drain task + drop policy
- `store.rs` — SQLite schema, insert, range/query reads
- `blobs.rs` — blake3 + zstd content-addressed blob store
- `snapshot.rs` — reconstruct file content at time T; per-file restore
- `paths.rs` — resolve `.gear/chronicle/` dirs per workspace

Frontend (`src/modules/rewind/`):
- `lib/api.ts` — Tauri bridge + types
- `lib/format.ts` — event → display label
- `store/rewindStore.ts` — Zustand store
- `components/TimelineScrubber.tsx`
- `components/RestoreQueue.tsx`
- `index.ts`

---

## Task 1: Add Rust dependencies

**Files:** Modify `src-tauri/Cargo.toml`

- [ ] **Step 1:** Add under `[dependencies]`:
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
zstd = "0.13"
blake3 = "1"
```
- [ ] **Step 2:** Build to fetch: `cargo build --manifest-path src-tauri/Cargo.toml`
  Expected: compiles (no usage yet).
- [ ] **Step 3:** Commit: `git add src-tauri/Cargo.toml src-tauri/Cargo.lock && git commit -m "build: add rusqlite, zstd, blake3 for chronicle"`

---

## Task 2: Blob store (content-addressed, TDD)

**Files:** Create `src-tauri/src/modules/chronicle/blobs.rs`, `paths.rs`, `mod.rs`; modify `src-tauri/src/modules/mod.rs`

- [ ] **Step 1: Failing test** — in `blobs.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn put_then_get_roundtrips_and_dedups() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path());
        let h1 = store.put(b"hello world").unwrap();
        let h2 = store.put(b"hello world").unwrap();
        assert_eq!(h1, h2, "same content => same hash");
        assert_eq!(store.get(&h1).unwrap(), b"hello world");
        // dedup: only one file on disk
        let count = std::fs::read_dir(dir.path().join(&h1[..2])).unwrap().count();
        assert_eq!(count, 1);
    }
}
```
- [ ] **Step 2:** `paths.rs`:
```rust
use std::path::{Path, PathBuf};
pub fn chronicle_dir(workspace_root: &Path) -> PathBuf { workspace_root.join(".gear").join("chronicle") }
pub fn blobs_dir(workspace_root: &Path) -> PathBuf { chronicle_dir(workspace_root).join("blobs") }
pub fn db_path(workspace_root: &Path) -> PathBuf { chronicle_dir(workspace_root).join("timeline.db") }
```
- [ ] **Step 3:** `blobs.rs` impl:
```rust
use std::path::{Path, PathBuf};

pub struct BlobStore { root: PathBuf }

impl BlobStore {
    pub fn new(root: &Path) -> Self { Self { root: root.to_path_buf() } }

    /// Returns hex blake3 hash. Stored zstd-compressed at root/ab/cdef...
    pub fn put(&self, content: &[u8]) -> std::io::Result<String> {
        let hash = blake3::hash(content).to_hex().to_string();
        let (dir, file) = (self.root.join(&hash[..2]), self.root.join(&hash[..2]).join(&hash[2..]));
        if file.exists() { return Ok(hash); }
        std::fs::create_dir_all(&dir)?;
        let compressed = zstd::encode_all(content, 3).map_err(std::io::Error::other)?;
        // atomic-ish: write tmp then rename
        let tmp = dir.join(format!("{}.tmp", &hash[2..]));
        std::fs::write(&tmp, &compressed)?;
        std::fs::rename(&tmp, &file)?;
        Ok(hash)
    }

    pub fn get(&self, hash: &str) -> std::io::Result<Vec<u8>> {
        let file = self.root.join(&hash[..2]).join(&hash[2..]);
        let compressed = std::fs::read(&file)?;
        zstd::decode_all(&compressed[..]).map_err(std::io::Error::other)
    }
}
```
- [ ] **Step 4:** `mod.rs` add `pub mod blobs; pub mod paths;`; add `pub mod chronicle;` to `modules/mod.rs`.
- [ ] **Step 5:** Test: `cargo test --manifest-path src-tauri/Cargo.toml blobs::` → PASS
- [ ] **Step 6:** Commit: `git commit -am "feat(chronicle): content-addressed zstd blob store"`

---

## Task 3: Event types

**Files:** Create `src-tauri/src/modules/chronicle/event.rs`

- [ ] **Step 1:** Define types:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventPayload {
    Cmd { command: String, exit_code: Option<i32>, duration_ms: Option<u64> },
    CmdOutput { blob: String, bytes: u64, truncated: bool },
    File { path: String, op: String, before_blob: Option<String>, after_blob: Option<String>, added: u32, removed: u32 },
    Git { op: String, reference: Option<String>, sha: Option<String> },
    Agent { agent_id: String, step: String, tool: Option<String>, outcome: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChronicleEvent {
    pub ts: i64,
    pub session_id: String,
    pub actor: String,
    pub cwd: Option<String>,
    pub workspace_root: String,
    pub file_path: Option<String>,
    pub summary: String,
    pub payload: EventPayload,
    pub parent_id: Option<i64>,
}

impl ChronicleEvent {
    pub fn kind_str(&self) -> &'static str {
        match self.payload {
            EventPayload::Cmd { .. } => "cmd",
            EventPayload::CmdOutput { .. } => "cmd_output",
            EventPayload::File { .. } => "file",
            EventPayload::Git { .. } => "git",
            EventPayload::Agent { .. } => "agent",
        }
    }
}
```
- [ ] **Step 2:** Add `pub mod event;` to `chronicle/mod.rs`.
- [ ] **Step 3:** `cargo build --manifest-path src-tauri/Cargo.toml` → compiles.
- [ ] **Step 4:** Commit: `git commit -am "feat(chronicle): event model"`

---

## Task 4: SQLite store (TDD)

**Files:** Create `src-tauri/src/modules/chronicle/store.rs`

- [ ] **Step 1: Failing test:**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::chronicle::event::*;
    fn ev(ts: i64, summary: &str) -> ChronicleEvent {
        ChronicleEvent { ts, session_id: "s".into(), actor: "user".into(), cwd: None,
            workspace_root: "/w".into(), file_path: None, summary: summary.into(),
            payload: EventPayload::Cmd { command: summary.into(), exit_code: Some(0), duration_ms: Some(1) },
            parent_id: None }
    }
    #[test]
    fn insert_and_range() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let id1 = store.insert(&ev(100, "a")).unwrap();
        let _id2 = store.insert(&ev(200, "b")).unwrap();
        assert!(id1 >= 1);
        let rows = store.range(0, 1000, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].summary, "a");
    }
}
```
- [ ] **Step 2:** Implement:
```rust
use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::Mutex;
use crate::modules::chronicle::event::{ChronicleEvent, EventPayload};

pub struct Store { conn: Mutex<Connection> }

#[derive(serde::Serialize)]
pub struct EventRow {
    pub id: i64, pub ts: i64, pub kind: String, pub actor: String,
    pub file_path: Option<String>, pub summary: String, pub payload: serde_json::Value,
    pub parent_id: Option<i64>,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(p) = path.parent() { let _ = std::fs::create_dir_all(p); }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL,
                actor TEXT NOT NULL, cwd TEXT, file_path TEXT, summary TEXT NOT NULL,
                payload TEXT NOT NULL, parent_id INTEGER);
             CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
             CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts);
             CREATE INDEX IF NOT EXISTS idx_events_file ON events(file_path);",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn insert(&self, e: &ChronicleEvent) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let payload = serde_json::to_string(&e.payload).unwrap();
        conn.execute(
            "INSERT INTO events (ts,session_id,kind,actor,cwd,file_path,summary,payload,parent_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![e.ts, e.session_id, e.kind_str(), e.actor, e.cwd, e.file_path, e.summary, payload, e.parent_id],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn range(&self, from_ts: i64, to_ts: i64, limit: i64) -> rusqlite::Result<Vec<EventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,ts,kind,actor,file_path,summary,payload,parent_id FROM events
             WHERE ts BETWEEN ?1 AND ?2 ORDER BY id ASC LIMIT ?3")?;
        let rows = stmt.query_map(params![from_ts, to_ts, limit], |r| {
            let payload: String = r.get(6)?;
            Ok(EventRow {
                id: r.get(0)?, ts: r.get(1)?, kind: r.get(2)?, actor: r.get(3)?,
                file_path: r.get(4)?, summary: r.get(5)?,
                payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
                parent_id: r.get(7)?,
            })
        })?.collect::<Result<Vec<_>,_>>()?;
        Ok(rows)
    }

    /// Latest blob hash for a path at-or-before ts (file reconstruction).
    pub fn latest_file_blob(&self, file_path: &str, at_ts: i64) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT payload FROM events WHERE kind='file' AND file_path=?1 AND ts<=?2
             ORDER BY id DESC LIMIT 1")?;
        let mut rows = stmt.query(params![file_path, at_ts])?;
        if let Some(r) = rows.next()? {
            let payload: String = r.get(0)?;
            let v: EventPayload = serde_json::from_str(&payload).unwrap();
            if let EventPayload::File { after_blob, .. } = v { return Ok(after_blob); }
        }
        Ok(None)
    }
}
```
- [ ] **Step 3:** Add `pub mod store;`. Test: `cargo test --manifest-path src-tauri/Cargo.toml store::` → PASS
- [ ] **Step 4:** Commit: `git commit -am "feat(chronicle): sqlite event store"`

---

## Task 5: Event bus + ChronicleState

**Files:** Create `src-tauri/src/modules/chronicle/bus.rs`; edit `mod.rs`

- [ ] **Step 1:** `bus.rs` — bounded std mpsc + background thread drain. Per-workspace `Store`+`BlobStore` lazily opened and cached in a `Mutex<HashMap<String, Arc<WorkspaceChronicle>>>`. Drop policy: if `try_send` fails (full), drop the event unless kind is cmd/file/git/agent — for those, block-send with a short timeout; otherwise drop.
```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::path::Path;
use crate::modules::chronicle::{event::ChronicleEvent, store::Store, blobs::BlobStore, paths};

pub struct WorkspaceChronicle { pub store: Store, pub blobs: BlobStore }

pub struct ChronicleState {
    tx: SyncSender<ChronicleEvent>,
    workspaces: Arc<Mutex<HashMap<String, Arc<WorkspaceChronicle>>>>,
}

fn open_ws(map: &Arc<Mutex<HashMap<String, Arc<WorkspaceChronicle>>>>, root: &str) -> Arc<WorkspaceChronicle> {
    let mut m = map.lock().unwrap();
    if let Some(w) = m.get(root) { return w.clone(); }
    let rootp = Path::new(root);
    let store = Store::open(&paths::db_path(rootp)).expect("open chronicle db");
    let blobs = BlobStore::new(&paths::blobs_dir(rootp));
    let w = Arc::new(WorkspaceChronicle { store, blobs });
    m.insert(root.to_string(), w.clone());
    w
}

impl Default for ChronicleState {
    fn default() -> Self {
        let (tx, rx) = sync_channel::<ChronicleEvent>(2048);
        let workspaces: Arc<Mutex<HashMap<String, Arc<WorkspaceChronicle>>>> = Arc::new(Mutex::new(HashMap::new()));
        let drain_ws = workspaces.clone();
        std::thread::spawn(move || {
            while let Ok(ev) = rx.recv() {
                let w = open_ws(&drain_ws, &ev.workspace_root);
                if let Err(e) = w.store.insert(&ev) { log::warn!("chronicle insert: {e}"); }
            }
        });
        Self { tx, workspaces }
    }
}

impl ChronicleState {
    pub fn emit(&self, ev: ChronicleEvent) {
        let critical = matches!(ev.kind_str(), "cmd" | "file" | "git" | "agent");
        match self.tx.try_send(ev) {
            Ok(()) => {}
            Err(TrySendError::Full(ev)) if critical => { let _ = self.tx.send(ev); }
            Err(_) => { /* drop low-value */ }
        }
    }
    pub fn workspace(&self, root: &str) -> Arc<WorkspaceChronicle> { open_ws(&self.workspaces, root) }
    /// Store a blob for a workspace (used by capture before emitting file/output events).
    pub fn put_blob(&self, root: &str, content: &[u8]) -> std::io::Result<String> {
        self.workspace(root).blobs.put(content)
    }
}
```
- [ ] **Step 2:** `mod.rs`: `pub mod bus; pub use bus::ChronicleState;`
- [ ] **Step 3:** `cargo build` → compiles.
- [ ] **Step 4:** Commit: `git commit -am "feat(chronicle): event bus + per-workspace state"`

---

## Task 6: Snapshot reconstruction + restore (TDD)

**Files:** Create `src-tauri/src/modules/chronicle/snapshot.rs`

- [ ] **Step 1: Failing test** (uses Store + BlobStore to reconstruct a file at T):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::chronicle::{store::Store, blobs::BlobStore, event::*};
    #[test]
    fn reconstructs_latest_blob_before_ts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let blobs = BlobStore::new(&dir.path().join("blobs"));
        let b1 = blobs.put(b"v1").unwrap();
        let b2 = blobs.put(b"v2").unwrap();
        let mk = |ts, blob: &str| ChronicleEvent { ts, session_id:"s".into(), actor:"user".into(),
            cwd:None, workspace_root:"/w".into(), file_path: Some("a.txt".into()), summary:"edit".into(),
            payload: EventPayload::File { path:"a.txt".into(), op:"modified".into(), before_blob:None,
                after_blob: Some(blob.into()), added:1, removed:0 }, parent_id:None };
        store.insert(&mk(100, &b1)).unwrap();
        store.insert(&mk(200, &b2)).unwrap();
        assert_eq!(reconstruct_file(&store, &blobs, "a.txt", 150).unwrap().unwrap(), b"v1");
        assert_eq!(reconstruct_file(&store, &blobs, "a.txt", 250).unwrap().unwrap(), b"v2");
    }
}
```
- [ ] **Step 2:** Implement:
```rust
use crate::modules::chronicle::{store::Store, blobs::BlobStore};

pub fn reconstruct_file(store: &Store, blobs: &BlobStore, file_path: &str, at_ts: i64)
    -> Result<Option<Vec<u8>>, String> {
    match store.latest_file_blob(file_path, at_ts).map_err(|e| e.to_string())? {
        Some(hash) => Ok(Some(blobs.get(&hash).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}
```
- [ ] **Step 3:** Test → PASS. Commit: `git commit -am "feat(chronicle): file reconstruction at timestamp"`

---

## Task 7: Tauri commands + register state

**Files:** Edit `chronicle/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1:** In `mod.rs` add commands:
```rust
use tauri::State;
use crate::modules::chronicle::{ChronicleState, store::EventRow, snapshot};

#[tauri::command]
pub fn chronicle_range(state: State<'_, ChronicleState>, workspace_root: String, from_ts: i64, to_ts: i64, limit: i64) -> Result<Vec<EventRow>, String> {
    state.workspace(&workspace_root).store.range(from_ts, to_ts, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chronicle_restore_file(state: State<'_, ChronicleState>, workspace_root: String, file_path: String, at_ts: i64) -> Result<String, String> {
    let w = state.workspace(&workspace_root);
    let bytes = snapshot::reconstruct_file(&w.store, &w.blobs, &file_path, at_ts)?
        .ok_or_else(|| "no snapshot at or before timestamp".to_string())?;
    String::from_utf8(bytes).map_err(|_| "binary file".to_string())
}
```
- [ ] **Step 2:** In `lib.rs`: add `chronicle` to the `use modules::{...}` list, `.manage(chronicle::ChronicleState::default())`, and register `chronicle::chronicle_range, chronicle::chronicle_restore_file` in `invoke_handler`.
- [ ] **Step 3:** `cargo build` → compiles. Commit: `git commit -am "feat(chronicle): tauri commands + state registration"`

---

## Task 8: Capture hook — file edits

**Files:** Edit `src-tauri/src/modules/fs/file.rs`

- [ ] **Step 1:** Extend `fs_write_file` to emit a chronicle file event. Read the previous content (best-effort) before writing, store before/after blobs, emit:
```rust
// add params: state: tauri::State<'_, crate::modules::chronicle::ChronicleState>,
//             workspace_root: Option<String>
// after successful write_atomic(...):
if let Some(root) = workspace_root.as_deref() {
    let before = std::fs::read(&target).ok(); // pre-read happens BEFORE write — see note
    let after_blob = state.put_blob(root, content.as_bytes()).ok();
    let before_blob = before.and_then(|b| state.put_blob(root, &b).ok());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    state.emit(crate::modules::chronicle::event::ChronicleEvent {
        ts: now, session_id: "session".into(), actor: source.clone().unwrap_or_else(|| "user".into()),
        cwd: None, workspace_root: root.to_string(), file_path: Some(path.clone()),
        summary: format!("edit {}", path),
        payload: crate::modules::chronicle::event::EventPayload::File {
            path: path.clone(), op: "modified".into(), before_blob, after_blob, added: 0, removed: 0 },
        parent_id: None,
    });
}
```
  **Note:** capture `before` by reading the target BEFORE `write_atomic`. Adjust ordering: read existing bytes into a local before the write call.
- [ ] **Step 2:** Update the `fs_write_file` signature in `lib.rs` handler is unchanged (same name). Frontend `fs_write_file` callers pass `workspaceRoot`; default `None` keeps back-compat.
- [ ] **Step 3:** `cargo build` → compiles. Commit: `git commit -am "feat(chronicle): capture file edits on write"`

---

## Task 9: Capture hook — terminal commands

**Files:** Edit `src-tauri/src/modules/pty/session.rs` (command lifecycle)

- [ ] **Step 1:** Locate where command start/exit + cwd are known (prompt/OSC tracking). Emit a `cmd` event on command completion with command text, exit code, duration, cwd, and emit a linked `cmd_output` event whose blob is the captured output buffer (capped 256 KB, head+tail beyond). If lifecycle tracking is not yet exposed, add a minimal capture in the read loop keyed off shell-integration markers already used for blocks.
- [ ] **Step 2:** `cargo build` → compiles. Commit: `git commit -am "feat(chronicle): capture terminal commands + output"`

(If pty lifecycle proves involved, ship file-capture first; this task may split.)

---

## Task 10: Frontend — api + store

**Files:** Create `src/modules/rewind/lib/api.ts`, `store/rewindStore.ts`, `lib/format.ts`, `index.ts`

- [ ] **Step 1:** `api.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
export interface TimelineEvent {
  id: number; ts: number; kind: string; actor: string;
  file_path: string | null; summary: string; payload: unknown; parent_id: number | null;
}
export const chronicleRange = (workspaceRoot: string, fromTs: number, toTs: number, limit = 500) =>
  invoke<TimelineEvent[]>("chronicle_range", { workspaceRoot, fromTs, toTs, limit });
export const chronicleRestoreFile = (workspaceRoot: string, filePath: string, atTs: number) =>
  invoke<string>("chronicle_restore_file", { workspaceRoot, filePath, atTs });
```
- [ ] **Step 2:** `rewindStore.ts` (Zustand): state `{ events, rangeFrom, rangeTo, scrubTs, loading }`, actions `load(workspaceRoot)`, `setScrub(ts)`. Immutable updates only.
- [ ] **Step 3:** `format.ts`: `eventLabel(e: TimelineEvent): string` mapping kind → icon+label.
- [ ] **Step 4:** vitest `store/rewindStore.test.ts`: loading sets events; setScrub updates scrubTs immutably. Run: `pnpm test rewindStore` → PASS.
- [ ] **Step 5:** Commit: `git commit -am "feat(rewind): frontend api + store"`

---

## Task 11: Frontend — TimelineScrubber + RestoreQueue

**Files:** Create `src/modules/rewind/components/TimelineScrubber.tsx`, `RestoreQueue.tsx`; wire a toggle into the statusbar.

- [ ] **Step 1:** `TimelineScrubber.tsx`: horizontal bar; map events to markers positioned by `(ts - from)/(to - from)`; color by kind; click sets scrub position; uses `@tanstack/react-virtual` only if list view needed. Tailwind classes matching existing components.
- [ ] **Step 2:** `RestoreQueue.tsx`: list file events at/before scrubTs; "Restore" calls `chronicleRestoreFile` then writes via existing `fs_write_file` (with confirm).
- [ ] **Step 3:** Wire `Cmd/Ctrl+Shift+T` toggle + a statusbar button (follow `src/modules/statusbar` patterns).
- [ ] **Step 4:** Manual check: `pnpm tauri dev`, edit a file, see marker appear, restore works.
- [ ] **Step 5:** Commit: `git commit -am "feat(rewind): timeline scrubber + restore queue UI"`

---

## Self-Review Notes

- Spec §3 module layout: covered (Tasks 2–7 backend, 10–11 frontend). `query.rs`/`retention.rs` deferred to P3 per phasing.
- Spec §4 data model: events table + indexes (Task 4), blobs (Task 2). FTS deferred to P3 (NL query).
- Spec §5 capture: file (Task 8) + terminal (Task 9); git/agent/diag = P2/P3.
- Spec §7 restore: per-file restore (Tasks 6–7, 11); sandbox checkout/promote = P2.
- Types consistent: `ChronicleEvent`/`EventPayload`/`EventRow`/`TimelineEvent` used uniformly.
- TDD applied to pure logic (blobs, store, snapshot); UI/integration verified manually + vitest store tests.
