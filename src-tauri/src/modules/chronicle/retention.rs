//! Retention: prune events older than a cutoff and garbage-collect blobs that
//! no surviving event references. Keeps the timeline bounded for long sessions.

use std::path::Path;

use crate::modules::chronicle::bus::WorkspaceChronicle;

/// Default retention window: 7 days.
pub const DEFAULT_MAX_AGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Debug, Default, serde::Serialize)]
pub struct RetentionReport {
    pub events_removed: usize,
    pub blobs_removed: usize,
    pub sandboxes_removed: usize,
}

/// Prune events older than `now - max_age_ms`, GC orphaned blobs, and remove
/// stale sandbox checkouts. `sandboxes_dir`, when present, is the directory whose
/// per-checkout subdirectories are GC'd by modification time.
pub fn run(
    ws: &WorkspaceChronicle,
    sandboxes_dir: Option<&Path>,
    now_ms: i64,
    max_age_ms: i64,
) -> Result<RetentionReport, String> {
    let cutoff = now_ms - max_age_ms;
    let events_removed = ws.store.delete_before(cutoff).map_err(|e| e.to_string())?;
    let keep = ws.store.referenced_blobs().map_err(|e| e.to_string())?;
    let blobs_removed = ws.blobs.gc(&keep).map_err(|e| e.to_string())?;
    let sandboxes_removed = match sandboxes_dir {
        Some(dir) => gc_sandboxes(dir, cutoff),
        None => 0,
    };
    Ok(RetentionReport {
        events_removed,
        blobs_removed,
        sandboxes_removed,
    })
}

/// Remove sandbox subdirectories last modified before `cutoff_ms`. Best-effort:
/// directories that can't be inspected or removed are skipped. Returns the count
/// removed.
fn gc_sandboxes(sandboxes_dir: &Path, cutoff_ms: i64) -> usize {
    let entries = match std::fs::read_dir(sandboxes_dir) {
        Ok(e) => e,
        Err(_) => return 0, // no sandboxes created yet
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let modified_ms = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);
        if let Some(ms) = modified_ms {
            if ms < cutoff_ms && std::fs::remove_dir_all(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::chronicle::{blobs::BlobStore, event::*, store::Store};

    #[test]
    fn prunes_old_events_and_orphan_blobs() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let blobs = BlobStore::new(&dir.path().join("blobs"));
        let old = blobs.put(b"old-content").unwrap();
        let fresh = blobs.put(b"fresh-content").unwrap();

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
        store.insert(&mk(1_000, &old)).unwrap();
        store.insert(&mk(1_800_000, &fresh)).unwrap();

        let ws = WorkspaceChronicle { store, blobs };
        // now = 2_000_000, max_age = 500_000 → cutoff 1_500_000: prunes the old
        // event (ts 1_000) but keeps the fresh one (ts 1_800_000).
        let report = run(&ws, None, 2_000_000, 500_000).unwrap();
        assert_eq!(report.events_removed, 1);
        assert_eq!(report.blobs_removed, 1);
        assert_eq!(report.sandboxes_removed, 0);
        // Fresh blob survives; old blob is gone.
        assert!(ws.blobs.get(&fresh).is_ok());
        assert!(ws.blobs.get(&old).is_err());
    }

    #[test]
    fn gc_removes_sandboxes_older_than_cutoff() {
        let dir = tempfile::tempdir().unwrap();
        let sandboxes = dir.path().join("sandboxes");
        let sb = sandboxes.join("checkout-1");
        std::fs::create_dir_all(&sb).unwrap();

        // A cutoff in the distant past keeps the just-created sandbox.
        assert_eq!(gc_sandboxes(&sandboxes, 1), 0);
        assert!(sb.exists());

        // A cutoff in the future treats it as stale and removes it.
        let future = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
            + 60_000;
        assert_eq!(gc_sandboxes(&sandboxes, future), 1);
        assert!(!sb.exists());
    }

    #[test]
    fn gc_sandboxes_missing_dir_is_zero() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(gc_sandboxes(&dir.path().join("nope"), i64::MAX), 0);
    }
}
