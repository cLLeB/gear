//! Chronicle — the capture + storage + query engine behind the Rewind
//! session time-travel feature. Modules emit events to [`ChronicleState`];
//! storage and reconstruction live entirely here.

pub mod blobs;
pub mod bus;
pub mod event;
pub mod paths;
pub mod snapshot;
pub mod store;

pub use bus::ChronicleState;

use event::{ChronicleEvent, EventPayload};
use store::EventRow;
use tauri::State;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Record a completed terminal command into the timeline. Called by the
/// frontend OSC-133 handler when a command finishes (it owns the parsed
/// command text, exit code, and cwd).
#[tauri::command]
pub fn chronicle_record_command(
    state: State<'_, ChronicleState>,
    workspace_root: String,
    command: String,
    exit_code: Option<i32>,
    duration_ms: Option<u64>,
    cwd: Option<String>,
) -> Result<(), String> {
    let summary = if command.trim().is_empty() {
        "command".to_string()
    } else {
        command.clone()
    };
    state.emit(ChronicleEvent {
        ts: now_ms(),
        session_id: "session".into(),
        actor: "user".into(),
        cwd,
        workspace_root,
        file_path: None,
        summary,
        payload: EventPayload::Cmd {
            command,
            exit_code,
            duration_ms,
        },
        parent_id: None,
    });
    Ok(())
}

/// Fetch timeline events within a timestamp window for the given workspace.
#[tauri::command]
pub fn chronicle_range(
    state: State<'_, ChronicleState>,
    workspace_root: String,
    from_ts: i64,
    to_ts: i64,
    limit: i64,
) -> Result<Vec<EventRow>, String> {
    state
        .workspace(&workspace_root)
        .store
        .range(from_ts, to_ts, limit)
        .map_err(|e| e.to_string())
}

/// Reconstruct the text content of a file as it existed at-or-before `at_ts`.
/// The caller decides whether to write it back to disk.
#[tauri::command]
pub fn chronicle_restore_file(
    state: State<'_, ChronicleState>,
    workspace_root: String,
    file_path: String,
    at_ts: i64,
) -> Result<String, String> {
    let w = state.workspace(&workspace_root);
    let bytes = snapshot::reconstruct_file(&w.store, &w.blobs, &file_path, at_ts)?
        .ok_or_else(|| "no snapshot at or before timestamp".to_string())?;
    String::from_utf8(bytes).map_err(|_| "binary file".to_string())
}
