//! Workspace statistics for the palette: the largest files and a cloc-style
//! breakdown of files / lines per language, honouring .gitignore like grep.

use std::collections::HashMap;
use std::io::Read;

use ignore::WalkBuilder;
use serde::Serialize;

use super::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Files above this are sized but not line-counted.
const LINE_COUNT_CAP: u64 = 4 * 1024 * 1024;
const MAX_FILES: usize = 200_000;

#[derive(Serialize)]
pub struct SizedFile {
    pub path: String,
    pub rel: String,
    pub size: u64,
}

#[derive(Serialize, Default, Clone)]
pub struct LangStats {
    pub files: u64,
    pub lines: u64,
    pub blank: u64,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct WorkspaceStats {
    pub largest: Vec<SizedFile>,
    pub by_extension: HashMap<String, LangStats>,
    pub files: u64,
    pub bytes: u64,
    pub truncated: bool,
}

/// Lines and blank lines of a text file; None for binary content.
pub fn count_lines(bytes: &[u8]) -> Option<(u64, u64)> {
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return None;
    }
    if bytes.is_empty() {
        return Some((0, 0));
    }
    let mut lines = 0u64;
    let mut blank = 0u64;
    for line in bytes.split(|&b| b == b'\n') {
        lines += 1;
        if line.iter().all(|b| b.is_ascii_whitespace()) {
            blank += 1;
        }
    }
    // A trailing newline doesn't start another line.
    if bytes.ends_with(b"\n") {
        lines -= 1;
        blank -= 1;
    }
    Some((lines, blank))
}

fn extension_key(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "dockerfile" | "makefile" | "justfile" | "rakefile" | "gemfile" | "procfile" => {
            return lower
        }
        _ => {}
    }
    match lower.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => ext.to_string(),
        _ => "(none)".to_string(),
    }
}

#[tauri::command]
pub async fn fs_workspace_stats(
    root: String,
    top: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<WorkspaceStats, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let top = top.unwrap_or(50).clamp(1, 500);
    tauri::async_runtime::spawn_blocking(move || collect_stats(&root_path, top))
        .await
        .map_err(|e| e.to_string())
}

pub fn collect_stats(root_path: &std::path::Path, top: usize) -> WorkspaceStats {
    let mut all: Vec<SizedFile> = Vec::new();
    let mut by_extension: HashMap<String, LangStats> = HashMap::new();
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut truncated = false;
    let walker = WalkBuilder::new(root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if files as usize >= MAX_FILES {
            truncated = true;
            break;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let size = meta.len();
        files += 1;
        bytes += size;
        let path = entry.path();
        let rel = path
            .strip_prefix(root_path)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stats = by_extension.entry(extension_key(&name)).or_default();
        stats.files += 1;
        stats.bytes += size;
        if size <= LINE_COUNT_CAP {
            let mut buf = Vec::with_capacity(size as usize);
            if std::fs::File::open(path)
                .and_then(|mut f| f.read_to_end(&mut buf))
                .is_ok()
            {
                if let Some((l, b)) = count_lines(&buf) {
                    stats.lines += l;
                    stats.blank += b;
                }
            }
        }
        all.push(SizedFile {
            path: to_canon(path),
            rel,
            size,
        });
    }
    all.sort_by_key(|f| std::cmp::Reverse(f.size));
    all.truncate(top);
    WorkspaceStats {
        largest: all,
        by_extension,
        files,
        bytes,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_lines_and_blanks() {
        assert_eq!(count_lines(b"a\n\nb\n"), Some((3, 1)));
        assert_eq!(count_lines(b"a\nb"), Some((2, 0)));
        assert_eq!(count_lines(b""), Some((0, 0)));
        assert_eq!(count_lines(b"\x00\x01"), None);
    }

    #[test]
    fn keys_extensions() {
        assert_eq!(extension_key("App.TSX"), "tsx");
        assert_eq!(extension_key("Dockerfile"), "dockerfile");
        assert_eq!(extension_key(".gitignore"), "(none)");
        assert_eq!(extension_key("README"), "(none)");
    }

    #[test]
    fn walks_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), "fn main() {}\n\n").unwrap();
        std::fs::write(dir.path().join("big.txt"), "x".repeat(1000)).unwrap();
        let s = collect_stats(dir.path(), 1);
        assert_eq!(s.files, 2);
        assert_eq!(s.largest.len(), 1);
        assert_eq!(s.largest[0].rel, "big.txt");
        assert_eq!(s.by_extension["rs"].lines, 2);
        assert_eq!(s.by_extension["rs"].blank, 1);
    }
}

#[derive(Serialize)]
pub struct DuplicateGroup {
    pub size: u64,
    pub files: Vec<String>,
}

/// Files with identical content (same size, then same BLAKE3 hash), biggest
/// waste first. Empty files are ignored.
pub fn find_duplicates(root_path: &std::path::Path, limit: usize) -> Vec<DuplicateGroup> {
    let mut by_size: HashMap<u64, Vec<std::path::PathBuf>> = HashMap::new();
    let walker = WalkBuilder::new(root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build();
    for entry in walker.flatten().take(MAX_FILES) {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() == 0 {
            continue;
        }
        by_size
            .entry(meta.len())
            .or_default()
            .push(entry.into_path());
    }
    let mut groups: Vec<DuplicateGroup> = Vec::new();
    for (size, paths) in by_size.into_iter().filter(|(_, p)| p.len() > 1) {
        let mut by_hash: HashMap<[u8; 32], Vec<String>> = HashMap::new();
        for p in paths {
            let Ok(bytes) = std::fs::read(&p) else {
                continue;
            };
            by_hash
                .entry(*blake3::hash(&bytes).as_bytes())
                .or_default()
                .push(to_canon(&p));
        }
        for (_, mut files) in by_hash.into_iter().filter(|(_, f)| f.len() > 1) {
            files.sort();
            groups.push(DuplicateGroup { size, files });
        }
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.size * (g.files.len() as u64 - 1)));
    groups.truncate(limit);
    groups
}

#[tauri::command]
pub async fn fs_duplicate_files(
    root: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DuplicateGroup>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    tauri::async_runtime::spawn_blocking(move || find_duplicates(&root_path, 200))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod duplicate_tests {
    use super::*;

    #[test]
    fn groups_identical_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "same").unwrap();
        std::fs::write(dir.path().join("b.txt"), "same").unwrap();
        std::fs::write(dir.path().join("c.txt"), "diff").unwrap();
        std::fs::write(dir.path().join("e1"), "").unwrap();
        std::fs::write(dir.path().join("e2"), "").unwrap();
        let g = find_duplicates(dir.path(), 10);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].files.len(), 2);
        assert!(g[0].files[0].ends_with("a.txt"));
    }
}
