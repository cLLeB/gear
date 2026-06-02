//! Retention: prune events older than a cutoff and garbage-collect blobs that
//! no surviving event references. Keeps the timeline bounded for long sessions.

use crate::modules::chronicle::bus::WorkspaceChronicle;

/// Default retention window: 7 days.
pub const DEFAULT_MAX_AGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Debug, Default, serde::Serialize)]
pub struct RetentionReport {
    pub events_removed: usize,
    pub blobs_removed: usize,
}

/// Prune events older than `now - max_age_ms`, then GC orphaned blobs.
pub fn run(
    ws: &WorkspaceChronicle,
    now_ms: i64,
    max_age_ms: i64,
) -> Result<RetentionReport, String> {
    let cutoff = now_ms - max_age_ms;
    let events_removed = ws.store.delete_before(cutoff).map_err(|e| e.to_string())?;
    let keep = ws.store.referenced_blobs().map_err(|e| e.to_string())?;
    let blobs_removed = ws.blobs.gc(&keep).map_err(|e| e.to_string())?;
    Ok(RetentionReport {
        events_removed,
        blobs_removed,
    })
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
        let report = run(&ws, 2_000_000, 500_000).unwrap();
        assert_eq!(report.events_removed, 1);
        assert_eq!(report.blobs_removed, 1);
        // Fresh blob survives; old blob is gone.
        assert!(ws.blobs.get(&fresh).is_ok());
        assert!(ws.blobs.get(&old).is_err());
    }
}
