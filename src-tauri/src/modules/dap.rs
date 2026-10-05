//! Transport for Debug Adapter Protocol servers that only listen on TCP
//! (Delve's `dlv dap`, vscode-js-debug's dapDebugServer, CodeLLDB `--port`).
//! The adapter is spawned as a child process, we connect to its port, and
//! messages are framed exactly like LSP (Content-Length headers) — so the
//! frontend uses the same message channel as the stdio adapters that run
//! through `lsp_spawn`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use shared_child::SharedChild;
use tauri::ipc::{Channel, Response};

use crate::modules::lsp::framing::{encode_frame, FrameDecoder};
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const OUTPUT_TAIL: usize = 40;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapExit {
    pub code: Option<i32>,
    pub output_tail: String,
    pub reason: Option<String>,
}

pub struct DapSession {
    child: Option<Arc<SharedChild>>,
    stream: Mutex<Option<TcpStream>>,
}

impl DapSession {
    fn write_message(&self, payload: &str) -> Result<(), String> {
        let mut guard = self.stream.lock().unwrap();
        let s = guard.as_mut().ok_or("dap connection closed")?;
        s.write_all(&encode_frame(payload))
            .and_then(|_| s.flush())
            .map_err(|e| format!("dap write failed: {e}"))
    }

    fn kill(&self) {
        if let Some(s) = self.stream.lock().unwrap().take() {
            let _ = s.shutdown(std::net::Shutdown::Both);
        }
        if let Some(child) = &self.child {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
            }
            let _ = child.kill();
        }
    }
}

impl Drop for DapSession {
    fn drop(&mut self) {
        self.kill();
    }
}

#[derive(Default)]
pub struct DapState {
    sessions: RwLock<HashMap<u32, Arc<DapSession>>>,
    next_id: AtomicU32,
}

impl DapState {
    pub fn kill_all(&self) {
        for (_, s) in self.sessions.write().unwrap().drain() {
            s.kill();
        }
    }
}

/// A currently free loopback port for an adapter to listen on.
#[tauri::command]
pub fn dap_free_port() -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

/// Connect with retries until the adapter starts listening (or gives up).
pub fn connect_with_retry(
    port: u16,
    timeout: Duration,
    alive: impl Fn() -> bool,
) -> Result<TcpStream, String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let start = Instant::now();
    loop {
        match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Err(e) => {
                if !alive() {
                    return Err("the debug adapter exited before it accepted a connection".into());
                }
                if start.elapsed() > timeout {
                    return Err(format!(
                        "couldn't connect to the debug adapter on port {port}: {e}"
                    ));
                }
                thread::sleep(Duration::from_millis(150));
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_reader(
    id: u32,
    mut stream: TcpStream,
    session: Arc<DapSession>,
    state_sessions: Arc<dyn Fn() + Send + Sync>,
    tail: Arc<Mutex<std::collections::VecDeque<String>>>,
    child: Option<Arc<SharedChild>>,
    on_message: Channel<Response>,
    on_exit: Channel<DapExit>,
) {
    let _ = thread::Builder::new()
        .name(format!("gear-dap-reader-{id}"))
        .spawn(move || {
            let mut decoder = FrameDecoder::default();
            let mut buf = [0u8; 32 * 1024];
            let mut reason: Option<String> = None;
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => match decoder.push(&buf[..n]) {
                        Ok(msgs) => {
                            for m in msgs {
                                if on_message.send(Response::new(m.into_bytes())).is_err() {
                                    session.kill();
                                    return;
                                }
                            }
                        }
                        Err(e) => {
                            reason = Some(e.to_string());
                            break;
                        }
                    },
                    Err(e) => {
                        reason = Some(e.to_string());
                        break;
                    }
                }
            }
            session.kill();
            let code = child.and_then(|c| c.wait().ok()).and_then(|s| s.code());
            let output_tail = tail
                .lock()
                .unwrap()
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            let _ = on_exit.send(DapExit {
                code,
                output_tail,
                reason,
            });
            state_sessions();
        });
}

fn remover(app: tauri::AppHandle, id: u32) -> Arc<dyn Fn() + Send + Sync> {
    Arc::new(move || {
        use tauri::Manager;
        if let Some(s) = app.try_state::<DapState>() {
            s.sessions.write().unwrap().remove(&id);
        }
    })
}

/// Spawn `command` (which must start a DAP server on `port`) and connect to it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn dap_spawn_tcp(
    state: tauri::State<'_, DapState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    app: tauri::AppHandle,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    cwd: String,
    port: u16,
    workspace: Option<WorkspaceEnv>,
    on_message: Channel<Response>,
    on_exit: Channel<DapExit>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        return Err("debugging in WSL workspaces is not supported yet".into());
    }
    let cwd = authorize_spawn_cwd(&registry, Some(cwd.as_str()), &workspace)?
        .ok_or("dap: a working directory is required")?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let tail: Arc<Mutex<std::collections::VecDeque<String>>> = Arc::default();

    // An empty command connects to an adapter that is already listening
    // (js-debug opens one connection per child session on the same port).
    if command.is_empty() {
        let stream = tauri::async_runtime::spawn_blocking(move || {
            connect_with_retry(port, Duration::from_secs(5), || true)
        })
        .await
        .map_err(|e| e.to_string())??;
        let reader = stream.try_clone().map_err(|e| e.to_string())?;
        let session = Arc::new(DapSession {
            child: None,
            stream: Mutex::new(Some(stream)),
        });
        state.sessions.write().unwrap().insert(id, session.clone());
        let remove = remover(app.clone(), id);
        spawn_reader(id, reader, session, remove, tail, None, on_message, on_exit);
        return Ok(id);
    }

    let (child, stream) = tauri::async_runtime::spawn_blocking({
        let tail = tail.clone();
        move || -> Result<(Arc<SharedChild>, TcpStream), String> {
            let binary = crate::modules::lsp::env::resolve_binary(&command)
                .ok_or_else(|| format!("debug adapter not found: {command}"))?;
            let mut cmd = Command::new(&binary);
            cmd.args(&args)
                .current_dir(&cwd)
                .envs(env.unwrap_or_default())
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            crate::modules::proc::hide_console(&mut cmd);
            #[cfg(unix)]
            unsafe {
                use std::os::unix::process::CommandExt;
                cmd.pre_exec(|| {
                    libc::setpgid(0, 0);
                    Ok(())
                });
            }
            let child = Arc::new(
                SharedChild::spawn(&mut cmd)
                    .map_err(|e| format!("couldn't start {}: {e}", binary.display()))?,
            );
            // Keep the adapter's own output (it often explains why it failed).
            for pipe in [
                child
                    .take_stdout()
                    .map(|p| Box::new(p) as Box<dyn Read + Send>),
                child
                    .take_stderr()
                    .map(|p| Box::new(p) as Box<dyn Read + Send>),
            ]
            .into_iter()
            .flatten()
            {
                let tail = tail.clone();
                let _ = thread::Builder::new()
                    .name(format!("gear-dap-out-{id}"))
                    .spawn(move || {
                        let mut pipe = pipe;
                        let mut buf = [0u8; 4096];
                        let mut line = Vec::new();
                        while let Ok(n) = pipe.read(&mut buf) {
                            if n == 0 {
                                break;
                            }
                            for &b in &buf[..n] {
                                if b == b'\n' {
                                    let mut t = tail.lock().unwrap();
                                    if t.len() >= OUTPUT_TAIL {
                                        t.pop_front();
                                    }
                                    t.push_back(String::from_utf8_lossy(&line).into_owned());
                                    line.clear();
                                } else if line.len() < 1024 {
                                    line.push(b);
                                }
                            }
                        }
                    });
            }
            let probe = child.clone();
            match connect_with_retry(port, CONNECT_TIMEOUT, move || {
                matches!(probe.try_wait(), Ok(None))
            }) {
                Ok(stream) => Ok((child, stream)),
                Err(e) => {
                    let _ = child.kill();
                    let out = tail
                        .lock()
                        .unwrap()
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join("\n");
                    Err(if out.trim().is_empty() {
                        e
                    } else {
                        format!("{e}\n{out}")
                    })
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    let reader = stream.try_clone().map_err(|e| e.to_string())?;
    let session = Arc::new(DapSession {
        child: Some(child.clone()),
        stream: Mutex::new(Some(stream)),
    });
    state.sessions.write().unwrap().insert(id, session.clone());
    let remove = remover(app.clone(), id);
    spawn_reader(
        id,
        reader,
        session,
        remove,
        tail,
        Some(child),
        on_message,
        on_exit,
    );
    log::info!("dap tcp session id={id} port={port}");
    Ok(id)
}

#[tauri::command]
pub async fn dap_send(
    state: tauri::State<'_, DapState>,
    id: u32,
    message: String,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("dap_send: unknown id={id}"))?;
    tauri::async_runtime::spawn_blocking(move || session.write_message(&message))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dap_kill(state: tauri::State<'_, DapState>, id: u32) {
    if let Some(s) = state.sessions.write().unwrap().remove(&id) {
        s.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connects_once_the_server_listens() {
        let port = dap_free_port().unwrap();
        let server = thread::spawn(move || {
            thread::sleep(Duration::from_millis(400));
            let l = TcpListener::bind(("127.0.0.1", port)).unwrap();
            let (mut s, _) = l.accept().unwrap();
            s.write_all(&encode_frame(
                r#"{"seq":1,"type":"event","event":"initialized"}"#,
            ))
            .unwrap();
        });
        let mut stream = connect_with_retry(port, Duration::from_secs(5), || true).unwrap();
        let mut decoder = FrameDecoder::default();
        let mut buf = [0u8; 256];
        let n = stream.read(&mut buf).unwrap();
        let msgs = decoder.push(&buf[..n]).unwrap();
        assert_eq!(
            msgs,
            vec![r#"{"seq":1,"type":"event","event":"initialized"}"#.to_string()]
        );
        server.join().unwrap();
    }

    #[test]
    fn gives_up_when_the_adapter_dies() {
        let port = dap_free_port().unwrap();
        let err = connect_with_retry(port, Duration::from_secs(5), || false).unwrap_err();
        assert!(err.contains("exited"));
    }
}
