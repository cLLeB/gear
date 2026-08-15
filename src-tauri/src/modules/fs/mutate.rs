use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Splits a file name into the stem and the extension suffix (including the
/// leading dot). A leading dot is part of the stem, so ".gitignore" is not
/// treated as an empty name with a "gitignore" extension.
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// A free path in `dir` for `name`, suffixing " (copy)", " (copy 2)", … when
/// taken. Pasting into a folder that already holds the file is the common case,
/// not an error worth stopping the user for.
pub fn unique_target(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let direct = dir.join(name);
    if !direct.exists() {
        return direct;
    }
    let (stem, ext) = split_name(name);
    for n in 1..10_000 {
        let candidate = if n == 1 {
            format!("{stem} (copy){ext}")
        } else {
            format!("{stem} (copy {n}){ext}")
        };
        let path = dir.join(&candidate);
        if !path.exists() {
            return path;
        }
    }
    // Pathological: ten thousand copies. Fall back to a timestamp.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    dir.join(format!("{stem} (copy {stamp}){ext}"))
}

/// True when `dir` is `src` itself or sits inside it. Copying or moving a
/// directory into its own subtree would recurse until the disk fills.
fn is_self_or_descendant(dir: &std::path::Path, src: &std::path::Path) -> bool {
    dir == src || dir.starts_with(src)
}

/// Copies files/dirs (from an OS drag-drop or a paste) into `dest_dir`. Sources
/// are absolute OS paths; only the destination is workspace-resolved. Returns
/// the paths actually written, which may be renamed to avoid a collision.
#[tauri::command]
pub fn fs_copy(
    sources: Vec<String>,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let dest = resolve_path(&dest_dir, &workspace);
    let mut written = Vec::with_capacity(sources.len());
    for source in &sources {
        let src = std::path::PathBuf::from(source);
        let name = src
            .file_name()
            .ok_or_else(|| format!("invalid source: {source}"))?;
        if src.is_dir() && is_self_or_descendant(&dest, &src) {
            return Err(format!(
                "cannot copy {} into itself",
                src.display()
            ));
        }
        let target = unique_target(&dest, &name.to_string_lossy());
        copy_recursive(&src, &target).map_err(|e| {
            log::warn!(
                "fs_copy({} -> {}) failed: {e}",
                src.display(),
                target.display()
            );
            e.to_string()
        })?;
        written.push(target.to_string_lossy().replace('\\', "/"));
    }
    Ok(written)
}

/// Moves files/dirs into `dest_dir` — the cut half of cut/paste, and the
/// drag-with-modifier gesture. Falls back to copy-then-delete when the source
/// and destination are on different volumes, where `rename` cannot work.
#[tauri::command]
pub fn fs_move(
    sources: Vec<String>,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let dest = resolve_path(&dest_dir, &workspace);
    let mut written = Vec::with_capacity(sources.len());
    for source in &sources {
        let src = std::path::PathBuf::from(source);
        let name = src
            .file_name()
            .ok_or_else(|| format!("invalid source: {source}"))?;
        if src.is_dir() && is_self_or_descendant(&dest, &src) {
            return Err(format!("cannot move {} into itself", src.display()));
        }
        let target = unique_target(&dest, &name.to_string_lossy());
        // Already where it was asked to go — nothing to do, and renaming onto
        // itself would produce a pointless " (copy)".
        if src == target {
            written.push(target.to_string_lossy().replace('\\', "/"));
            continue;
        }
        if std::fs::rename(&src, &target).is_err() {
            copy_recursive(&src, &target).map_err(|e| {
                log::warn!(
                    "fs_move({} -> {}) copy failed: {e}",
                    src.display(),
                    target.display()
                );
                e.to_string()
            })?;
            let removed = if src.is_dir() {
                std::fs::remove_dir_all(&src)
            } else {
                std::fs::remove_file(&src)
            };
            removed.map_err(|e| {
                log::warn!("fs_move cleanup({}) failed: {e}", src.display());
                // The copy landed, so the user's data is safe; say what is left.
                format!("copied, but could not remove {}: {e}", src.display())
            })?;
        }
        written.push(target.to_string_lossy().replace('\\', "/"));
    }
    Ok(written)
}

/// Writes `content` as a new file in `dest_dir`, picking a free name. Used when
/// the clipboard holds text or an image rather than file paths.
#[tauri::command]
pub fn fs_write_new(
    dest_dir: String,
    name: String,
    content: Vec<u8>,
    workspace: Option<WorkspaceEnv>,
) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let dest = resolve_path(&dest_dir, &workspace);
    let target = unique_target(&dest, &name);
    std::fs::write(&target, &content).map_err(|e| {
        log::warn!("fs_write_new({}) failed: {e}", target.display());
        e.to_string()
    })?;
    Ok(target.to_string_lossy().replace('\\', "/"))
}

fn copy_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(&p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub fn fs_create_dir(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn fs_rename(from: String, to: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::rename(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let result = if meta.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };

    result.map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_a_name_into_stem_and_extension() {
        assert_eq!(split_name("a.txt"), ("a", ".txt"));
        assert_eq!(split_name("archive.tar.gz"), ("archive.tar", ".gz"));
        assert_eq!(split_name("README"), ("README", ""));
    }

    #[test]
    fn treats_a_leading_dot_as_part_of_the_name() {
        assert_eq!(split_name(".gitignore"), (".gitignore", ""));
        assert_eq!(split_name(".env.local"), (".env", ".local"));
    }

    #[test]
    fn uses_the_plain_name_when_nothing_is_in_the_way() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(unique_target(dir.path(), "a.txt"), dir.path().join("a.txt"));
    }

    #[test]
    fn suffixes_copy_then_numbers_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "").unwrap();
        assert_eq!(
            unique_target(dir.path(), "a.txt"),
            dir.path().join("a (copy).txt")
        );

        std::fs::write(dir.path().join("a (copy).txt"), "").unwrap();
        assert_eq!(
            unique_target(dir.path(), "a.txt"),
            dir.path().join("a (copy 2).txt")
        );
    }

    #[test]
    fn keeps_the_extension_when_renaming_a_collision() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("archive.tar.gz"), "").unwrap();
        assert_eq!(
            unique_target(dir.path(), "archive.tar.gz"),
            dir.path().join("archive.tar (copy).gz")
        );
    }

    #[test]
    fn renames_a_colliding_extensionless_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("README"), "").unwrap();
        assert_eq!(
            unique_target(dir.path(), "README"),
            dir.path().join("README (copy)")
        );
    }

    #[test]
    fn collides_with_a_directory_of_the_same_name_too() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        assert_eq!(
            unique_target(dir.path(), "src"),
            dir.path().join("src (copy)")
        );
    }

    #[test]
    fn recognizes_a_destination_inside_the_source() {
        let src = std::path::Path::new("/a/b");
        assert!(is_self_or_descendant(std::path::Path::new("/a/b"), src));
        assert!(is_self_or_descendant(std::path::Path::new("/a/b/c"), src));
        assert!(!is_self_or_descendant(std::path::Path::new("/a"), src));
        assert!(!is_self_or_descendant(std::path::Path::new("/a/bb"), src));
    }

    #[test]
    fn copies_a_directory_tree_recursively() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("src");
        std::fs::create_dir_all(src.join("nested")).unwrap();
        std::fs::write(src.join("nested/x.txt"), "hello").unwrap();

        let dst = root.path().join("dst");
        copy_recursive(&src, &dst).unwrap();
        assert_eq!(
            std::fs::read_to_string(dst.join("nested/x.txt")).unwrap(),
            "hello"
        );
    }
}
