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

/// Keep Chronicle's database and blobs out of the user's git status. A
/// `.gitignore` of `*` inside the folder hides the folder itself (the way pytest
/// and mypy hide their caches) while leaving the rest of `.gear/`, such as
/// `settings.json`, free to commit. Best effort: a read-only workspace is fine.
pub fn ensure_git_ignored(workspace_root: &Path) {
    let dir = chronicle_dir(workspace_root);
    let ignore = dir.join(".gitignore");
    if ignore.exists() {
        return;
    }
    if std::fs::create_dir_all(&dir).is_ok() {
        let _ = std::fs::write(
            &ignore,
            "# Created by Gear: Chronicle history for this workspace, not for git.\n*\n",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_git_ignored_writes_once_and_keeps_user_edits() {
        let root = tempfile::tempdir().unwrap();
        ensure_git_ignored(root.path());
        let ignore = chronicle_dir(root.path()).join(".gitignore");
        let text = std::fs::read_to_string(&ignore).unwrap();
        assert!(text.lines().any(|l| l == "*"));

        std::fs::write(&ignore, "custom\n").unwrap();
        ensure_git_ignored(root.path());
        assert_eq!(std::fs::read_to_string(&ignore).unwrap(), "custom\n");
    }
}
