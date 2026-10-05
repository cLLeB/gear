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
