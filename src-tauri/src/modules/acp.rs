//! Hosts coding agents that speak the Agent Client Protocol (Claude Code,
//! Codex and Gemini CLI, through their ACP entry points) as child processes.
//! The protocol itself — JSON-RPC over newline-delimited stdio — is handled
//! in the frontend; this module starts the process with the user's PATH,
//! streams each stdout line to the UI, writes replies to stdin, keeps the
//! last stderr lines to explain failures, and stops the whole process tree.
//!
//! The agents sign in with the user's own subscription (Claude Pro/Max,
//! ChatGPT, Google account), so no API key is involved.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use shared_child::SharedChild;
use tauri::ipc::Channel;
use tauri::State;

use crate::modules::lsp::env::{resolve_binary, server_env_overlay};

/// Lines longer than this are dropped rather than buffered without end.
const MAX_LINE: usize = 32 * 1024 * 1024;
const STDERR_TAIL: usize = 60;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentOutput {
    /// One JSON-RPC message from the agent.
    Message { line: String },
    /// A line the agent wrote to stderr (logs, auth prompts, crashes).
    Log { line: String },
    Exit {
        code: Option<i32>,
        stderr: Vec<String>,
    },
}

struct Running {
    child: Arc<SharedChild>,
    stdin: Arc<Mutex<ChildStdin>>,
    #[cfg(windows)]
    _job: Option<crate::modules::proc::job::ProcessJob>,
}

#[derive(Default)]
pub struct AgentProcesses(Mutex<HashMap<String, Running>>);

/// Where each program is installed, or null; lets the UI offer only agents that exist.
#[tauri::command]
pub async fn acp_detect(programs: Vec<String>) -> HashMap<String, Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        programs
            .into_iter()
            .map(|p| {
                let found = resolve_binary(&p).map(|b| b.to_string_lossy().into_owned());
                (p, found)
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Starts `program args…` in `cwd` and streams its output to `on_output`.
#[tauri::command]
pub fn acp_start(
    state: State<'_, AgentProcesses>,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    on_output: Channel<AgentOutput>,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(format!("invalid agent id: {id}"));
    }
    if state.0.lock().map_err(|e| e.to_string())?.contains_key(&id) {
        return Err(format!("agent {id} is already running"));
    }
    let binary =
        resolve_binary(&program).ok_or_else(|| format!("{program} was not found on PATH"))?;
    let mut cmd = Command::new(&binary);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .envs(server_env_overlay())
        .envs(env.unwrap_or_default());
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = Arc::new(
        SharedChild::spawn(&mut cmd).map_err(|e| format!("could not start {program}: {e}"))?,
    );
    let stdin = child.take_stdin().ok_or("no stdin")?;
    let stdout = child.take_stdout().ok_or("no stdout")?;
    let stderr = child.take_stderr().ok_or("no stderr")?;
    #[cfg(windows)]
    let job = crate::modules::proc::job::ProcessJob::create_for(child.id()).ok();

    let tail: Arc<Mutex<VecDeque<String>>> = Arc::default();
    {
        let tail = Arc::clone(&tail);
        let out = on_output.clone();
        std::thread::Builder::new()
            .name(format!("gear-acp-err-{id}"))
            .spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if let Ok(mut t) = tail.lock() {
                        if t.len() == STDERR_TAIL {
                            t.pop_front();
                        }
                        t.push_back(line.clone());
                    }
                    let _ = out.send(AgentOutput::Log { line });
                }
            })
            .map_err(|e| e.to_string())?;
    }
    {
        let child = Arc::clone(&child);
        let out = on_output;
        let id2 = id.clone();
        let tail = Arc::clone(&tail);
        std::thread::Builder::new()
            .name(format!("gear-acp-out-{id}"))
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(_) if buf.len() > MAX_LINE => continue,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&buf).trim_end().to_string();
                            if !line.is_empty() {
                                let _ = out.send(AgentOutput::Message { line });
                            }
                        }
                    }
                }
                let code = child.wait().ok().and_then(|s| s.code());
                // Give the stderr reader a moment to drain the last lines.
                std::thread::sleep(std::time::Duration::from_millis(100));
                let stderr = tail
                    .lock()
                    .map(|t| t.iter().cloned().collect())
                    .unwrap_or_default();
                let _ = out.send(AgentOutput::Exit { code, stderr });
                log::info!("acp agent {id2} exited with {code:?}");
            })
            .map_err(|e| e.to_string())?;
    }
    state.0.lock().map_err(|e| e.to_string())?.insert(
        id,
        Running {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            #[cfg(windows)]
            _job: job,
        },
    );
    Ok(())
}

/// Writes one JSON-RPC message (a single line) to the agent.
#[tauri::command]
pub fn acp_send(state: State<'_, AgentProcesses>, id: String, line: String) -> Result<(), String> {
    if line.contains('\n') {
        return Err("a message must be a single line".into());
    }
    let stdin = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        Arc::clone(
            &map.get(&id)
                .ok_or_else(|| format!("agent {id} is not running"))?
                .stdin,
        )
    };
    let mut w = stdin.lock().map_err(|e| e.to_string())?;
    w.write_all(line.as_bytes())
        .and_then(|_| w.write_all(b"\n"))
        .and_then(|_| w.flush())
        .map_err(|e| format!("agent {id} stopped accepting input: {e}"))
}

/// Stops the agent and everything it started.
#[tauri::command]
pub fn acp_stop(state: State<'_, AgentProcesses>, id: String) -> Result<(), String> {
    let running = state.0.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(r) = running {
        let _ = r.child.kill();
        // Dropping the job (Windows) kills the rest of the tree, e.g. node under npx.
    }
    Ok(())
}

/// Forgets agents whose process has ended, so their ids can be reused.
#[tauri::command]
pub fn acp_reap(state: State<'_, AgentProcesses>) -> Vec<String> {
    let Ok(mut map) = state.0.lock() else {
        return Vec::new();
    };
    let ended: Vec<String> = map
        .iter()
        .filter(|(_, r)| matches!(r.child.try_wait(), Ok(Some(_))))
        .map(|(k, _)| k.clone())
        .collect();
    for k in &ended {
        map.remove(k);
    }
    ended
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_limited_to_safe_characters() {
        assert!(valid_id("claude-1"));
        assert!(valid_id("a_b"));
        assert!(!valid_id(""));
        assert!(!valid_id("a b"));
        assert!(!valid_id(&"x".repeat(65)));
    }
}
