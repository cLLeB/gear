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

/// Reconstruct every tracked file as it existed at-or-before `at_ts`, writing
/// the result into `dest`. Returns the number of files written. The latest
/// recorded op per path decides whether it's written or skipped (deleted).
pub fn reconstruct_tree_into(
    store: &Store,
    blobs: &BlobStore,
    at_ts: i64,
    dest: &std::path::Path,
) -> Result<usize, String> {
    let paths = store.file_paths_until(at_ts).map_err(|e| e.to_string())?;
    let mut written = 0usize;
    for rel in paths {
        // Skip absolute / parent-escaping paths defensively — sandbox writes
        // must stay inside `dest`.
        let relp = std::path::Path::new(&rel);
        if relp.is_absolute() || rel.contains("..") {
            continue;
        }
        // None means no blob at/before T (e.g. only a delete event) — leave absent.
        if let Some(bytes) = reconstruct_file(store, blobs, &rel, at_ts)? {
            let target = dest.join(relp);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
            written += 1;
        }
    }
    Ok(written)
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

    #[test]
    fn reconstructs_whole_tree_at_ts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let blobs = BlobStore::new(&dir.path().join("blobs"));
        let mk = |ts: i64, path: &str, content: &[u8]| {
            let blob = blobs.put(content).unwrap();
            store
                .insert(&ChronicleEvent {
                    ts,
                    session_id: "s".into(),
                    actor: "user".into(),
                    cwd: None,
                    workspace_root: "/w".into(),
                    file_path: Some(path.into()),
                    summary: "edit".into(),
                    payload: EventPayload::File {
                        path: path.into(),
                        op: "modified".into(),
                        before_blob: None,
                        after_blob: Some(blob),
                        added: 1,
                        removed: 0,
                    },
                    parent_id: None,
                })
                .unwrap();
        };
        mk(100, "a.txt", b"a-v1");
        mk(150, "sub/b.txt", b"b-v1");
        mk(200, "a.txt", b"a-v2");
        mk(300, "a.txt", b"a-v3-after-cutoff");

        let dest = dir.path().join("sandbox");
        let count = reconstruct_tree_into(&store, &blobs, 250, &dest).unwrap();
        assert_eq!(count, 2);
        assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"a-v2");
        assert_eq!(std::fs::read(dest.join("sub/b.txt")).unwrap(), b"b-v1");
    }
}
