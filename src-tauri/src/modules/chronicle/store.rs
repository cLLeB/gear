//! SQLite-backed append-only event log. WAL mode keeps writes from blocking
//! reads. The `events` table is the timeline spine; reconstruction queries pull
//! the latest file blob at-or-before a timestamp.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::modules::chronicle::event::{ChronicleEvent, EventPayload};

pub struct Store {
    conn: Mutex<Connection>,
}

#[derive(Debug, serde::Serialize)]
pub struct EventRow {
    pub id: i64,
    pub ts: i64,
    pub kind: String,
    pub actor: String,
    pub file_path: Option<String>,
    pub summary: String,
    pub payload: serde_json::Value,
    pub parent_id: Option<i64>,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(p) = path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                actor TEXT NOT NULL,
                cwd TEXT,
                file_path TEXT,
                summary TEXT NOT NULL,
                payload TEXT NOT NULL,
                parent_id INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
            CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts);
            CREATE INDEX IF NOT EXISTS idx_events_file ON events(file_path);
            -- FTS index keyed by events.id (rowid). Populated on insert so
            -- full-text search over summaries/commands/paths is fast. A plain
            -- (non-contentless) table so retention can DELETE rows by rowid.
            CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
                body, tokenize='unicode61'
            );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert(&self, e: &ChronicleEvent) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let payload = serde_json::to_string(&e.payload).unwrap();
        conn.execute(
            "INSERT INTO events (ts,session_id,kind,actor,cwd,file_path,summary,payload,parent_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                e.ts,
                e.session_id,
                e.kind_str(),
                e.actor,
                e.cwd,
                e.file_path,
                e.summary,
                payload,
                e.parent_id
            ],
        )?;
        let id = conn.last_insert_rowid();
        // Index searchable text: summary + the command (for cmd events) + path.
        let mut body = e.summary.clone();
        if let EventPayload::Cmd { command, .. } = &e.payload {
            body.push(' ');
            body.push_str(command);
        }
        if let Some(fp) = &e.file_path {
            body.push(' ');
            body.push_str(fp);
        }
        conn.execute(
            "INSERT INTO events_fts (rowid, body) VALUES (?1, ?2)",
            params![id, body],
        )?;
        Ok(id)
    }

    /// Delete events strictly older than `cutoff_ts`, keeping the FTS index in
    /// sync. Returns the number of events removed.
    pub fn delete_before(&self, cutoff_ts: i64) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM events_fts WHERE rowid IN (SELECT id FROM events WHERE ts < ?1)",
            params![cutoff_ts],
        )?;
        let n = conn.execute("DELETE FROM events WHERE ts < ?1", params![cutoff_ts])?;
        Ok(n)
    }

    /// Every blob hash still referenced by a surviving `file` event — the GC
    /// keep-set for the blob store.
    pub fn referenced_blobs(&self) -> rusqlite::Result<std::collections::HashSet<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT payload FROM events WHERE kind='file'")?;
        let mut set = std::collections::HashSet::new();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for payload in rows {
            if let Ok(EventPayload::File {
                before_blob,
                after_blob,
                ..
            }) = serde_json::from_str(&payload?)
            {
                if let Some(b) = before_blob {
                    set.insert(b);
                }
                if let Some(a) = after_blob {
                    set.insert(a);
                }
            }
        }
        Ok(set)
    }

    /// Full-text search over event summaries/commands/paths. Returns matching
    /// rows newest-first. The query is an FTS5 MATCH expression.
    pub fn search(&self, query: &str, limit: i64) -> rusqlite::Result<Vec<EventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT e.id,e.ts,e.kind,e.actor,e.file_path,e.summary,e.payload,e.parent_id
             FROM events e JOIN events_fts f ON e.id = f.rowid
             WHERE events_fts MATCH ?1 ORDER BY e.id DESC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![query, limit], |r| {
                let payload: String = r.get(6)?;
                Ok(EventRow {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    kind: r.get(2)?,
                    actor: r.get(3)?,
                    file_path: r.get(4)?,
                    summary: r.get(5)?,
                    payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
                    parent_id: r.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn range(&self, from_ts: i64, to_ts: i64, limit: i64) -> rusqlite::Result<Vec<EventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,ts,kind,actor,file_path,summary,payload,parent_id FROM events
             WHERE ts BETWEEN ?1 AND ?2 ORDER BY id ASC LIMIT ?3",
        )?;
        let rows = stmt
            .query_map(params![from_ts, to_ts, limit], |r| {
                let payload: String = r.get(6)?;
                Ok(EventRow {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    kind: r.get(2)?,
                    actor: r.get(3)?,
                    file_path: r.get(4)?,
                    summary: r.get(5)?,
                    payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
                    parent_id: r.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// All `file` events for a path, most-recent-first — powers blame-across-time.
    pub fn file_history(&self, file_path: &str, limit: i64) -> rusqlite::Result<Vec<EventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,ts,kind,actor,file_path,summary,payload,parent_id FROM events
             WHERE kind='file' AND file_path=?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![file_path, limit], |r| {
                let payload: String = r.get(6)?;
                Ok(EventRow {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    kind: r.get(2)?,
                    actor: r.get(3)?,
                    file_path: r.get(4)?,
                    summary: r.get(5)?,
                    payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
                    parent_id: r.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Distinct file paths that have at least one `file` event at-or-before
    /// `at_ts` — the set of files to reconstruct for a sandbox checkout.
    pub fn file_paths_until(&self, at_ts: i64) -> rusqlite::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT file_path FROM events
             WHERE kind='file' AND file_path IS NOT NULL AND ts<=?1",
        )?;
        let rows = stmt
            .query_map(params![at_ts], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Latest stored blob hash for a path at-or-before `at_ts`. The backbone of
    /// file reconstruction.
    pub fn latest_file_blob(
        &self,
        file_path: &str,
        at_ts: i64,
    ) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT payload FROM events WHERE kind='file' AND file_path=?1 AND ts<=?2
             ORDER BY id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query(params![file_path, at_ts])?;
        if let Some(r) = rows.next()? {
            let payload: String = r.get(0)?;
            if let Ok(EventPayload::File { after_blob, .. }) = serde_json::from_str(&payload) {
                return Ok(after_blob);
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::chronicle::event::*;

    fn cmd_ev(ts: i64, summary: &str) -> ChronicleEvent {
        ChronicleEvent {
            ts,
            session_id: "s".into(),
            actor: "user".into(),
            cwd: None,
            workspace_root: "/w".into(),
            file_path: None,
            summary: summary.into(),
            payload: EventPayload::Cmd {
                command: summary.into(),
                exit_code: Some(0),
                duration_ms: Some(1),
            },
            parent_id: None,
        }
    }

    #[test]
    fn insert_and_range() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let id1 = store.insert(&cmd_ev(100, "a")).unwrap();
        store.insert(&cmd_ev(200, "b")).unwrap();
        assert!(id1 >= 1);
        let rows = store.range(0, 1000, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].summary, "a");
        assert_eq!(rows[1].summary, "b");
    }

    #[test]
    fn latest_file_blob_respects_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let mk = |ts: i64, blob: &str| ChronicleEvent {
            ts,
            session_id: "s".into(),
            actor: "user".into(),
            cwd: None,
            workspace_root: "/w".into(),
            file_path: Some("a.txt".into()),
            summary: "edit".into(),
            payload: EventPayload::File {
                path: "a.txt".into(),
                op: "modified".into(),
                before_blob: None,
                after_blob: Some(blob.into()),
                added: 1,
                removed: 0,
            },
            parent_id: None,
        };
        store.insert(&mk(100, "hashA")).unwrap();
        store.insert(&mk(200, "hashB")).unwrap();
        assert_eq!(
            store.latest_file_blob("a.txt", 150).unwrap(),
            Some("hashA".into())
        );
        assert_eq!(
            store.latest_file_blob("a.txt", 250).unwrap(),
            Some("hashB".into())
        );
        assert_eq!(store.latest_file_blob("a.txt", 50).unwrap(), None);
    }

    #[test]
    fn fts_search_matches_commands() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        store
            .insert(&ChronicleEvent {
                ts: 100,
                session_id: "s".into(),
                actor: "user".into(),
                cwd: None,
                workspace_root: "/w".into(),
                file_path: None,
                summary: "cargo build".into(),
                payload: EventPayload::Cmd {
                    command: "cargo build --release".into(),
                    exit_code: Some(101),
                    duration_ms: Some(10),
                },
                parent_id: None,
            })
            .unwrap();
        store.insert(&cmd_ev(200, "git status")).unwrap();

        let hits = store.search("cargo", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].summary.contains("cargo"));
        assert_eq!(store.search("nonexistent", 10).unwrap().len(), 0);
    }
}
