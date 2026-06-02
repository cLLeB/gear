//! Reconstruct file state at an arbitrary point in time by pulling the latest
//! recorded blob at-or-before the requested timestamp.

use crate::modules::chronicle::{blobs::BlobStore, store::Store};

pub fn reconstruct_file(
    store: &Store,
    blobs: &BlobStore,
    file_path: &str,
    at_ts: i64,
) -> Result<Option<Vec<u8>>, String> {
    match store
        .latest_file_blob(file_path, at_ts)
        .map_err(|e| e.to_string())?
    {
        Some(hash) => Ok(Some(blobs.get(&hash).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::chronicle::event::*;

    #[test]
    fn reconstructs_latest_blob_before_ts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let blobs = BlobStore::new(&dir.path().join("blobs"));
        let b1 = blobs.put(b"v1").unwrap();
        let b2 = blobs.put(b"v2").unwrap();
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
        store.insert(&mk(100, &b1)).unwrap();
        store.insert(&mk(200, &b2)).unwrap();
        assert_eq!(
            reconstruct_file(&store, &blobs, "a.txt", 150).unwrap().unwrap(),
            b"v1"
        );
        assert_eq!(
            reconstruct_file(&store, &blobs, "a.txt", 250).unwrap().unwrap(),
            b"v2"
        );
        assert!(reconstruct_file(&store, &blobs, "a.txt", 50).unwrap().is_none());
    }
}
