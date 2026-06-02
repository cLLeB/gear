//! Filesystem layout for Chronicle data, kept per-workspace under `.gear/chronicle/`.

use std::path::{Path, PathBuf};

pub fn chronicle_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".gear").join("chronicle")
}

pub fn blobs_dir(workspace_root: &Path) -> PathBuf {
    chronicle_dir(workspace_root).join("blobs")
}

pub fn db_path(workspace_root: &Path) -> PathBuf {
    chronicle_dir(workspace_root).join("timeline.db")
}

pub fn sandboxes_root(workspace_root: &Path) -> PathBuf {
    chronicle_dir(workspace_root).join("sandboxes")
}

pub fn sandbox_dir(workspace_root: &Path, id: &str) -> PathBuf {
    sandboxes_root(workspace_root).join(id)
}
