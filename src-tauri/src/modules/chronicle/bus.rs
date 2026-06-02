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

fn open_ws(map: &WsMap, root: &str) -> Arc<WorkspaceChronicle> {
    let mut m = map.lock().unwrap();
    if let Some(w) = m.get(root) {
        return w.clone();
    }
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
        let workspaces: WsMap = Arc::new(Mutex::new(HashMap::new()));
        let drain_ws = workspaces.clone();
        std::thread::spawn(move || {
            while let Ok(ev) = rx.recv() {
                let w = open_ws(&drain_ws, &ev.workspace_root);
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

    pub fn workspace(&self, root: &str) -> Arc<WorkspaceChronicle> {
        open_ws(&self.workspaces, root)
    }

    /// Store a blob for a workspace. Used by capture sites to persist file
    /// content / command output before emitting the referencing event.
    pub fn put_blob(&self, root: &str, content: &[u8]) -> std::io::Result<String> {
        self.workspace(root).blobs.put(content)
    }
}
