//! Windows notify transport for agent hooks.
//!
//! The hook re-invokes `Gear.exe __gear_notify <agent> <event>`, and Claude Code
//! (like Codex and Gemini) spawns hooks through Node with `windowsHide: true` —
//! that is `CREATE_NO_WINDOW`, which *creates a new hidden console* rather than
//! suppressing one. `AttachConsole(ATTACH_PARENT_PROCESS)` therefore lands on
//! that throwaway console, so writing the OSC 777 marker to `CONOUT$` reports
//! success at every step and the bytes die with the console when the hook exits.
//!
//! Console inheritance is not a transport we can rely on for a process we do not
//! spawn, so the shim instead connects to this pipe, served by the running Gear
//! process, and the marker never touches the terminal at all. The pane is
//! identified by `GEAR_PTY_ID`, set alongside `GEAR_TERMINAL` when the shell is
//! spawned and inherited down the whole process tree.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;
use std::{ptr, thread};

use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_PIPE_CONNECTED, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{ReadFile, PIPE_ACCESS_INBOUND};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_MESSAGE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_MESSAGE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
};

use super::agent_detect::AgentDetector;
use super::session::AGENT_EVENT;

/// Env var carrying the pane id into the shell and every process it spawns.
pub const PTY_ID_ENV: &str = "GEAR_PTY_ID";

const BUF: usize = 4096;
/// The shim may race a server that is between accepts, or find every instance
/// briefly busy. Both are transient, so retry before falling back.
const CONNECT_ATTEMPTS: u32 = 6;
const CONNECT_BACKOFF: Duration = Duration::from_millis(40);

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Weak so a closed pane drops its detector without needing an explicit
/// unregister on every teardown path.
static DETECTORS: Mutex<Option<HashMap<u32, Weak<Mutex<AgentDetector>>>>> = Mutex::new(None);

/// Per-user so two accounts on one machine cannot reach each other's panes.
fn pipe_name() -> String {
    let user: String = std::env::var("USERNAME")
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    format!(r"\\.\pipe\gear-notify-{user}")
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// `HANDLE` is a raw pointer and so not `Send`; the pipe instance is owned by
/// exactly one thread at a time, which is what the auto-trait cannot see.
struct PipeHandle(HANDLE);
unsafe impl Send for PipeHandle {}

impl Drop for PipeHandle {
    fn drop(&mut self) {
        unsafe {
            DisconnectNamedPipe(self.0);
            CloseHandle(self.0);
        }
    }
}

pub fn register(id: u32, detector: &Arc<Mutex<AgentDetector>>) {
    let mut guard = DETECTORS.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    map.retain(|_, weak| weak.strong_count() > 0);
    map.insert(id, Arc::downgrade(detector));
}

/// Start the pipe server. Failures are logged and retried rather than fatal:
/// without the pipe, agent notifications stop working, but the terminal itself
/// must keep running.
pub fn serve(app: AppHandle) {
    if APP.set(app).is_err() {
        return; // already serving
    }
    let _ = thread::Builder::new()
        .name("Gear-notify-pipe".into())
        .spawn(|| {
            let name = wide(&pipe_name());
            loop {
                let handle = unsafe {
                    CreateNamedPipeW(
                        name.as_ptr(),
                        PIPE_ACCESS_INBOUND,
                        PIPE_TYPE_MESSAGE
                            | PIPE_READMODE_MESSAGE
                            | PIPE_WAIT
                            | PIPE_REJECT_REMOTE_CLIENTS,
                        PIPE_UNLIMITED_INSTANCES,
                        0,
                        BUF as u32,
                        0,
                        ptr::null(),
                    )
                };
                if handle == INVALID_HANDLE_VALUE {
                    log::warn!(
                        "notify pipe: CreateNamedPipeW failed ({}); retrying",
                        unsafe { GetLastError() }
                    );
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }
                let pipe = PipeHandle(handle);
                let connected = unsafe { ConnectNamedPipe(handle, ptr::null_mut()) } != 0
                    || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
                if !connected {
                    continue; // pipe dropped by Drop
                }
                // Serve on a worker so the next instance is listening immediately.
                thread::spawn(move || {
                    let pipe = pipe;
                    serve_one(pipe.0);
                });
            }
        });
}

fn serve_one(handle: HANDLE) {
    let mut buf = [0u8; BUF];
    let mut read: u32 = 0;
    let ok = unsafe {
        ReadFile(
            handle,
            buf.as_mut_ptr(),
            BUF as u32,
            &mut read,
            ptr::null_mut(),
        )
    };
    if ok == 0 || read == 0 {
        return;
    }
    let Ok(text) = std::str::from_utf8(&buf[..read as usize]) else {
        log::warn!("notify pipe: non-utf8 message");
        return;
    };
    match parse(text) {
        Some((id, agent, event)) => dispatch(id, &agent, &event),
        None => log::warn!("notify pipe: unparseable message {text:?}"),
    }
}

/// `<ptyId>\t<agent>\t<event>` — deliberately not JSON: the shim must not pull a
/// parser into a path that has to stay fast and dependency-light.
fn parse(text: &str) -> Option<(u32, String, String)> {
    let mut parts = text.trim_end_matches(['\r', '\n']).splitn(3, '\t');
    let id: u32 = parts.next()?.parse().ok()?;
    let agent = parts.next()?;
    let event = parts.next()?;
    if agent.is_empty() || event.is_empty() {
        return None;
    }
    Some((id, agent.to_string(), event.to_string()))
}

fn dispatch(pty_id: u32, agent: &str, event: &str) {
    let Some(app) = APP.get() else { return };
    let detector = DETECTORS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|m| m.get(&pty_id))
        .and_then(Weak::upgrade);
    let Some(detector) = detector else {
        log::warn!("notify pipe: no live pane for {PTY_ID_ENV}={pty_id} ({agent}/{event})");
        return;
    };
    let mut detector = detector.lock().unwrap();
    detector.apply_marker(agent, event, &mut |t| {
        let _ = app.emit(AGENT_EVENT, t.into_signal(pty_id));
    });
}

/// Client side, called from the `__gear_notify` shim. Returns the error so the
/// caller can record *why* it fell back — a silent failure here is what made
/// the original bug invisible for so long.
pub fn send(pty_id: u32, agent: &str, event: &str) -> Result<(), String> {
    let name = pipe_name();
    let msg = format!("{pty_id}\t{agent}\t{event}");
    let mut last = String::new();
    for attempt in 0..CONNECT_ATTEMPTS {
        match std::fs::OpenOptions::new().write(true).open(&name) {
            Ok(mut pipe) => {
                return pipe
                    .write_all(msg.as_bytes())
                    .and_then(|()| pipe.flush())
                    .map_err(|e| format!("write: {e}"));
            }
            Err(e) => {
                last = e.to_string();
                if attempt + 1 < CONNECT_ATTEMPTS {
                    thread::sleep(CONNECT_BACKOFF);
                }
            }
        }
    }
    Err(format!("connect {name}: {last}"))
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_a_well_formed_message() {
        assert_eq!(
            parse("7\tclaude\tfinished"),
            Some((7, "claude".to_string(), "finished".to_string()))
        );
    }

    #[test]
    fn tolerates_a_trailing_newline() {
        assert_eq!(
            parse("7\tclaude\tfinished\r\n"),
            Some((7, "claude".to_string(), "finished".to_string()))
        );
    }

    #[test]
    fn rejects_malformed_messages() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("7\tclaude"), None);
        assert_eq!(parse("notanid\tclaude\tfinished"), None);
        assert_eq!(parse("7\t\tfinished"), None);
        assert_eq!(parse("7\tclaude\t"), None);
    }
}
