//! Persisted terminal scrollback: each pane's serialized buffer (ANSI) is
//! stored zstd-compressed under the app data dir, keyed by a stable pane key,
//! so a restored session shows what was on screen before Gear closed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
pub struct ScrollbackEntry {
    pub key: String,
    pub data: String,
    /// Small JSON blob (cwd, the command that was running…).
    pub meta: Option<String>,
}

#[derive(Serialize)]
pub struct LoadedScrollback {
    pub data: String,
    pub meta: Option<String>,
    /// Unix millis of the save.
    pub saved_at: u64,
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 64 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let d = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("scrollback");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

pub fn save_entries(dir: &Path, entries: &[ScrollbackEntry]) -> Result<usize, String> {
    let mut n = 0;
    for e in entries {
        if !valid_key(&e.key) || e.data.len() > MAX_ENTRY_BYTES {
            continue;
        }
        let packed = zstd::encode_all(e.data.as_bytes(), 3).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!("{}.zst.tmp", e.key));
        std::fs::write(&tmp, packed).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dir.join(format!("{}.zst", e.key))).map_err(|e| e.to_string())?;
        let meta = dir.join(format!("{}.json", e.key));
        match &e.meta {
            Some(m) => std::fs::write(meta, m).map_err(|e| e.to_string())?,
            None => {
                let _ = std::fs::remove_file(meta);
            }
        }
        n += 1;
    }
    Ok(n)
}

pub fn load_entries(dir: &Path, keys: &[String]) -> HashMap<String, LoadedScrollback> {
    let mut out = HashMap::new();
    for k in keys.iter().filter(|k| valid_key(k)) {
        let path = dir.join(format!("{k}.zst"));
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(raw) = zstd::decode_all(bytes.as_slice()) else {
            continue;
        };
        let saved_at = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let meta = std::fs::read_to_string(dir.join(format!("{k}.json"))).ok();
        out.insert(
            k.clone(),
            LoadedScrollback {
                data: String::from_utf8_lossy(&raw).into_owned(),
                meta,
                saved_at,
            },
        );
    }
    out
}

/// Delete stored panes whose keys aren't in `keep`.
pub fn prune_entries(dir: &Path, keep: &[String]) -> usize {
    let keep: std::collections::HashSet<&str> = keep.iter().map(String::as_str).collect();
    let mut removed = 0;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let key = name.split('.').next().unwrap_or("");
            if !keep.contains(key) && std::fs::remove_file(e.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

#[tauri::command]
pub async fn scrollback_save(
    app: tauri::AppHandle,
    entries: Vec<ScrollbackEntry>,
) -> Result<usize, String> {
    let d = dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_entries(&d, &entries))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scrollback_load(
    app: tauri::AppHandle,
    keys: Vec<String>,
) -> Result<HashMap<String, LoadedScrollback>, String> {
    let d = dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_entries(&d, &keys))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scrollback_prune(app: tauri::AppHandle, keep: Vec<String>) -> Result<usize, String> {
    let d = dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || prune_entries(&d, &keep))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_prunes() {
        let d = tempfile::tempdir().unwrap();
        let entries = vec![
            ScrollbackEntry {
                key: "a-1".into(),
                data: "\x1b[32mhello\x1b[0m\r\n".repeat(1000),
                meta: Some(r#"{"cwd":"/x"}"#.into()),
            },
            ScrollbackEntry {
                key: "../evil".into(),
                data: "x".into(),
                meta: None,
            },
            ScrollbackEntry {
                key: "b-2".into(),
                data: "bye".into(),
                meta: None,
            },
        ];
        assert_eq!(save_entries(d.path(), &entries).unwrap(), 2);
        let loaded = load_entries(d.path(), &["a-1".into(), "b-2".into(), "missing".into()]);
        assert_eq!(loaded["a-1"].data, entries[0].data);
        assert_eq!(loaded["a-1"].meta.as_deref(), Some(r#"{"cwd":"/x"}"#));
        assert_eq!(loaded["b-2"].data, "bye");
        assert!(!loaded.contains_key("missing"));
        assert_eq!(prune_entries(d.path(), &["b-2".into()]), 2);
        assert!(load_entries(d.path(), &["a-1".into()]).is_empty());
        assert_eq!(load_entries(d.path(), &["b-2".into()]).len(), 1);
    }
}
