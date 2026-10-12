//! Backing commands for three tool panes: the hex editor (write raw bytes),
//! disk usage (a size tree of a folder) and folder compare.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Largest file the hex editor may write back.
const WRITE_CAP: usize = 64 * 1024 * 1024;
/// Children kept per folder in the disk usage tree; the rest are folded into one node.
const MAX_CHILDREN: usize = 80;
const MAX_COMPARE_ENTRIES: usize = 50_000;

pub fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some(u32::from(c - b'A')),
            b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let clean: Vec<u8> = text
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        if chunk.len() == 1 {
            return Err("truncated base64".to_string());
        }
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            let v = val(c).ok_or_else(|| format!("not base64: {:?}", c as char))?;
            n |= v << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn fs_write_bytes(
    path: String,
    data: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<u64, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = base64_decode(&data)?;
        if bytes.len() > WRITE_CAP {
            return Err("file is too large to write from the hex editor".to_string());
        }
        std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
        Ok(bytes.len() as u64)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug, PartialEq)]
pub struct UsageNode {
    pub name: String,
    pub size: u64,
    /// Number of files below this node (1 for a file).
    pub files: u64,
    pub dir: bool,
    pub children: Vec<UsageNode>,
}

fn usage_of(path: &Path, name: String, budget: &mut usize) -> UsageNode {
    let mut node = UsageNode {
        name,
        size: 0,
        files: 0,
        dir: true,
        children: Vec::new(),
    };
    let Ok(entries) = std::fs::read_dir(path) else {
        return node;
    };
    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        // file_type() does not follow links, so a link to a folder is never walked.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let child_name = entry.file_name().to_string_lossy().into_owned();
        if kind.is_dir() {
            let child = usage_of(&entry.path(), child_name, budget);
            node.size += child.size;
            node.files += child.files;
            node.children.push(child);
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            node.size += size;
            node.files += 1;
            node.children.push(UsageNode {
                name: child_name,
                size,
                files: 1,
                dir: false,
                children: Vec::new(),
            });
        }
    }
    node.children
        .sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
    if node.children.len() > MAX_CHILDREN {
        let rest = node.children.split_off(MAX_CHILDREN);
        node.children.push(UsageNode {
            name: format!("({} smaller items)", rest.len()),
            size: rest.iter().map(|c| c.size).sum(),
            files: rest.iter().map(|c| c.files).sum(),
            dir: false,
            children: Vec::new(),
        });
    }
    node
}

/// Drops nodes too small to draw, so the tree sent to the frontend stays small.
fn prune(node: &mut UsageNode, floor: u64) {
    let (keep, small): (Vec<UsageNode>, Vec<UsageNode>) = std::mem::take(&mut node.children)
        .into_iter()
        .partition(|c| c.size >= floor);
    node.children = keep;
    if !small.is_empty() {
        node.children.push(UsageNode {
            name: format!("({} smaller items)", small.len()),
            size: small.iter().map(|c| c.size).sum(),
            files: small.iter().map(|c| c.files).sum(),
            dir: false,
            children: Vec::new(),
        });
    }
    for child in &mut node.children {
        prune(child, floor);
    }
}

pub fn disk_usage(root: &Path) -> UsageNode {
    let mut budget = 2_000_000usize;
    let name = root.to_string_lossy().into_owned();
    let mut tree = usage_of(root, name, &mut budget);
    let floor = tree.size / 20_000;
    prune(&mut tree, floor);
    tree
}

#[tauri::command]
pub async fn fs_disk_usage(
    root: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<UsageNode, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    tauri::async_runtime::spawn_blocking(move || disk_usage(&root_path))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct CompareEntry {
    /// Path relative to both roots, with forward slashes.
    pub rel: String,
    /// "left", "right", "different" or "same".
    pub status: &'static str,
    pub dir: bool,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
}

#[derive(Serialize)]
pub struct CompareResult {
    pub entries: Vec<CompareEntry>,
    pub truncated: bool,
}

/// rel path -> (is dir, size)
fn listing(
    root: &Path,
    skip: &[String],
    out: &mut BTreeMap<String, (bool, u64)>,
    truncated: &mut bool,
) {
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if skip.iter().any(|s| s == &name) {
                continue;
            }
            if out.len() >= MAX_COMPARE_ENTRIES {
                *truncated = true;
                return;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let rel = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            if kind.is_dir() {
                out.insert(rel.clone(), (true, 0));
                stack.push((entry.path(), rel));
            } else {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.insert(rel, (false, size));
            }
        }
    }
}

fn same_content(a: &Path, b: &Path) -> bool {
    fn hash(p: &Path) -> Option<blake3::Hash> {
        let mut hasher = blake3::Hasher::new();
        let mut file = std::fs::File::open(p).ok()?;
        std::io::copy(&mut file, &mut hasher).ok()?;
        Some(hasher.finalize())
    }
    match (hash(a), hash(b)) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

pub fn compare_dirs(left: &Path, right: &Path, skip: &[String]) -> CompareResult {
    let mut truncated = false;
    let mut l = BTreeMap::new();
    let mut r = BTreeMap::new();
    listing(left, skip, &mut l, &mut truncated);
    listing(right, skip, &mut r, &mut truncated);
    let mut entries = Vec::new();
    for (rel, (dir, size)) in &l {
        let entry = match r.get(rel) {
            None => CompareEntry {
                rel: rel.clone(),
                status: "left",
                dir: *dir,
                left_size: Some(*size),
                right_size: None,
            },
            Some((rdir, rsize)) => {
                let same = if *dir || *rdir {
                    dir == rdir
                } else {
                    size == rsize && same_content(&left.join(rel), &right.join(rel))
                };
                CompareEntry {
                    rel: rel.clone(),
                    status: if same { "same" } else { "different" },
                    dir: *dir && *rdir,
                    left_size: Some(*size),
                    right_size: Some(*rsize),
                }
            }
        };
        entries.push(entry);
    }
    for (rel, (dir, size)) in &r {
        if !l.contains_key(rel) {
            entries.push(CompareEntry {
                rel: rel.clone(),
                status: "right",
                dir: *dir,
                left_size: None,
                right_size: Some(*size),
            });
        }
    }
    entries.sort_by(|a, b| a.rel.cmp(&b.rel));
    CompareResult { entries, truncated }
}

#[tauri::command]
pub async fn fs_compare_dirs(
    left: String,
    right: String,
    skip: Option<Vec<String>>,
    workspace: Option<WorkspaceEnv>,
) -> Result<CompareResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let l = resolve_path(&left, &workspace);
    let r = resolve_path(&right, &workspace);
    for (p, name) in [(&l, &left), (&r, &right)] {
        if !p.is_dir() {
            return Err(format!("not a directory: {name}"));
        }
    }
    let skip = skip.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || compare_dirs(&l, &r, &skip))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::fs::bytes::base64_encode;

    #[test]
    fn base64_round_trips() {
        for sample in [
            &b""[..],
            b"f",
            b"fo",
            b"foo",
            b"foobar",
            &[0xff, 0xfe, 0x00, 0x80],
        ] {
            assert_eq!(base64_decode(&base64_encode(sample)).unwrap(), sample);
        }
        assert!(base64_decode("Zm9v!").is_err());
        assert!(base64_decode("Z").is_err());
    }

    #[test]
    fn disk_usage_sums_sizes_and_sorts_by_size() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("big")).unwrap();
        std::fs::write(dir.path().join("big/a.bin"), vec![0u8; 3000]).unwrap();
        std::fs::write(dir.path().join("big/b.bin"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.path().join("small.txt"), vec![0u8; 500]).unwrap();
        let tree = disk_usage(dir.path());
        assert_eq!(tree.size, 4500);
        assert_eq!(tree.files, 3);
        assert_eq!(tree.children[0].name, "big");
        assert_eq!(tree.children[0].size, 4000);
        assert_eq!(tree.children[0].children[0].name, "a.bin");
        assert_eq!(tree.children[1].name, "small.txt");
    }

    #[test]
    fn compare_reports_each_kind_of_difference() {
        let l = tempfile::tempdir().unwrap();
        let r = tempfile::tempdir().unwrap();
        for root in [l.path(), r.path()] {
            std::fs::create_dir(root.join("sub")).unwrap();
            std::fs::write(root.join("sub/same.txt"), "same").unwrap();
            std::fs::create_dir(root.join("node_modules")).unwrap();
        }
        std::fs::write(l.path().join("node_modules/x"), "1").unwrap();
        std::fs::write(l.path().join("changed.txt"), "left").unwrap();
        std::fs::write(r.path().join("changed.txt"), "rite").unwrap();
        std::fs::write(l.path().join("only-left.txt"), "x").unwrap();
        std::fs::write(r.path().join("sub/only-right.txt"), "y").unwrap();
        let res = compare_dirs(l.path(), r.path(), &["node_modules".to_string()]);
        let got: Vec<(&str, &str)> = res
            .entries
            .iter()
            .map(|e| (e.rel.as_str(), e.status))
            .collect();
        assert_eq!(
            got,
            vec![
                ("changed.txt", "different"),
                ("only-left.txt", "left"),
                ("sub", "same"),
                ("sub/only-right.txt", "right"),
                ("sub/same.txt", "same"),
            ]
        );
        assert!(!res.truncated);
    }
}
