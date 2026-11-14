//! In-process event sink. Capture sites call `ChronicleState::emit`; a
//! background thread drains the channel into per-workspace storage so the hot
//! path (PTY, editor) never blocks on disk I/O.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};

use crate::modules::chronicle::{blobs::BlobStore, event::ChronicleEvent, paths, store::Store};

pub struct WorkspaceChronicle {
    pub store: Store,
    pub blobs: BlobStore,
}

type WsMap = Arc<Mutex<HashMap<String, Arc<WorkspaceChronicle>>>>;

pub struct ChronicleState {
    tx: SyncSender<ChronicleEvent>,
    workspaces: WsMap,
}

/// Open (or reuse) a workspace's Chronicle. Fails instead of panicking when the
/// database can't be created, e.g. a workspace at `C:\` or on a read-only share:
/// a panic here poisoned the map and broke file saves for the whole session.
fn open_ws(map: &WsMap, root: &str) -> Result<Arc<WorkspaceChronicle>, String> {
    let mut m = map.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(w) = m.get(root) {
        return Ok(w.clone());
    }
    let rootp = Path::new(root);
    paths::ensure_git_ignored(rootp);
    let store = Store::open(&paths::db_path(rootp))
        .map_err(|e| format!("chronicle unavailable for {root}: {e}"))?;
    let blobs = BlobStore::new(&paths::blobs_dir(rootp));
    let w = Arc::new(WorkspaceChronicle { store, blobs });
    m.insert(root.to_string(), w.clone());
    Ok(w)
}

impl Default for ChronicleState {
    fn default() -> Self {
        let (tx, rx) = sync_channel::<ChronicleEvent>(2048);
        let workspaces: WsMap = Arc::new(Mutex::new(HashMap::new()));
        let drain_ws = workspaces.clone();
        std::thread::spawn(move || {
            while let Ok(ev) = rx.recv() {
                let w = match open_ws(&drain_ws, &ev.workspace_root) {
                    Ok(w) => w,
                    Err(e) => {
                        log::debug!("{e}");
                        continue;
                    }
                };
                if let Err(e) = w.store.insert(&ev) {
                    log::warn!("chronicle insert failed: {e}");
                }
            }
        });
        Self { tx, workspaces }
    }
}

impl ChronicleState {
    /// Fire-and-forget. Structural events (cmd/file/git/agent) get a blocking
    /// send if the channel is momentarily full; low-value events are dropped.
    pub fn emit(&self, ev: ChronicleEvent) {
        let critical = matches!(ev.kind_str(), "cmd" | "file" | "git" | "agent");
        match self.tx.try_send(ev) {
            Ok(()) => {}
            Err(TrySendError::Full(ev)) if critical => {
                let _ = self.tx.send(ev);
            }
            Err(_) => { /* drop low-value event under back-pressure */ }
        }
    }

    pub fn workspace(&self, root: &str) -> Result<Arc<WorkspaceChronicle>, String> {
        open_ws(&self.workspaces, root)
    }

    /// Store a blob for a workspace. Used by capture sites to persist file
    /// content / command output before emitting the referencing event.
    pub fn put_blob(&self, root: &str, content: &[u8]) -> std::io::Result<String> {
        self.workspace(root)
            .map_err(std::io::Error::other)?
            .blobs
            .put(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unusable_workspace_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        // A regular file can't hold `.gear/chronicle/`, like a read-only root.
        let root = dir.path().join("not-a-dir");
        std::fs::write(&root, b"x").unwrap();
        let root = root.to_string_lossy().to_string();

        let state = ChronicleState::default();
        assert!(state.workspace(&root).is_err());
        assert!(state.put_blob(&root, b"data").is_err());
        // The map is still usable for a good workspace afterwards.
        let good = tempfile::tempdir().unwrap();
        assert!(state.workspace(&good.path().to_string_lossy()).is_ok());
    }
}
