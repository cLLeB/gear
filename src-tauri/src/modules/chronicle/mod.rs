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

/// Emit a git transition into the timeline. Best-effort: looks up
/// [`ChronicleState`] from the app handle and never fails the caller.
pub fn record_git(
    app: &tauri::AppHandle,
    repo_root: &str,
    op: &str,
    reference: Option<String>,
) {
    use tauri::Manager;
    let state = app.state::<ChronicleState>();
    let summary = match &reference {
        Some(r) => format!("git {op} {r}"),
        None => format!("git {op}"),
    };
    state.emit(ChronicleEvent {
        ts: now_ms(),
        session_id: "session".into(),
        actor: "user".into(),
        cwd: Some(repo_root.to_string()),
        workspace_root: repo_root.to_string(),
        file_path: None,
        summary,
        payload: EventPayload::Git {
            op: op.to_string(),
            reference,
            sha: None,
        },
        parent_id: None,
    });
}

/// Emit an agent step into the timeline. Called by `chronicle_record_agent`.
fn record_agent_event(
    state: &ChronicleState,
    workspace_root: String,
    agent_id: String,
    step: String,
    tool: Option<String>,
    outcome: Option<String>,
) {
    let summary = match &tool {
        Some(t) => format!("{agent_id}: {step} ({t})"),
        None => format!("{agent_id}: {step}"),
    };
    state.emit(ChronicleEvent {
        ts: now_ms(),
        session_id: "session".into(),
        actor: agent_id.clone(),
        cwd: None,
        workspace_root,
        file_path: None,
        summary,
        payload: EventPayload::Agent {
            agent_id,
            step,
            tool,
            outcome,
        },
        parent_id: None,
    });
}

/// Record an AI-agent step (tool call / decision) into the timeline. Called by
/// the frontend agent runner so manual and agent actions share one timeline.
#[tauri::command]
pub fn chronicle_record_agent(
    state: State<'_, ChronicleState>,
    workspace_root: String,
    agent_id: String,
    step: String,
    tool: Option<String>,
    outcome: Option<String>,
) -> Result<(), String> {
    record_agent_event(&state, workspace_root, agent_id, step, tool, outcome);
    Ok(())
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

/// Full history of `file_path` (every recorded edit), most-recent-first —
/// powers the blame-across-time gutter.
#[tauri::command]
pub fn chronicle_file_history(
    state: State<'_, ChronicleState>,
    workspace_root: String,
    file_path: String,
    limit: i64,
) -> Result<Vec<EventRow>, String> {
    state
        .workspace(&workspace_root)
        .store
        .file_history(&file_path, limit)
        .map_err(|e| e.to_string())
}

/// Reconstruct the entire tracked file tree as it existed at-or-before `at_ts`
/// into an isolated sandbox directory. Returns the sandbox path. The live
/// workspace is never touched.
#[tauri::command]
pub fn chronicle_checkout_sandbox(
    state: State<'_, ChronicleState>,
    workspace_root: String,
    at_ts: i64,
) -> Result<String, String> {
    let w = state.workspace(&workspace_root);
    let dest = paths::sandbox_dir(std::path::Path::new(&workspace_root), &at_ts.to_string());
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let count = snapshot::reconstruct_tree_into(&w.store, &w.blobs, at_ts, &dest)?;
    log::info!("chronicle sandbox: reconstructed {count} files into {dest:?}");
    Ok(dest.to_string_lossy().to_string())
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
