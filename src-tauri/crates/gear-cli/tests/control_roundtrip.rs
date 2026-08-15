//! End-to-end coverage for the packaged CLI: the real `gear-cli` binary is
//! executed against a stub control server speaking the wire protocol, so
//! endpoint discovery, authentication, framing, response validation, and exit
//! codes are exercised together rather than in isolation.

use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, SocketAddr, TcpListener};
use std::process::{Command, Output};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use gear_control_protocol::{ControlRequest, ControlResponse, PROTOCOL_VERSION};
use serde_json::{json, Value};

/// 64 hex characters — `validate_endpoint` rejects anything else.
const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const RECV_TIMEOUT: Duration = Duration::from_secs(20);

/// Serves exactly one request, then hands it back over a channel.
struct StubServer {
    address: SocketAddr,
    requests: Receiver<ControlRequest>,
}

impl StubServer {
    /// Fails fast instead of hanging when the CLI never dials — the usual
    /// cause is the client rejecting the arguments before it connects.
    fn request(&self) -> ControlRequest {
        match self.requests.recv_timeout(RECV_TIMEOUT) {
            Ok(request) => request,
            Err(RecvTimeoutError::Timeout) => {
                panic!("the CLI never sent a request (it exited before connecting)")
            }
            Err(RecvTimeoutError::Disconnected) => panic!("stub server thread died"),
        }
    }
}

fn serve_once(response_for: fn(&ControlRequest) -> ControlResponse) -> StubServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let address = listener.local_addr().expect("local addr");
    let (tx, requests) = mpsc::channel();

    thread::spawn(move || {
        let Ok((stream, _)) = listener.accept() else {
            return;
        };
        let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            return;
        }
        let request: ControlRequest = serde_json::from_str(&line).expect("parse request");

        let response = response_for(&request);
        let mut writer = stream;
        serde_json::to_writer(&mut writer, &response).expect("write response");
        writer.write_all(b"\n").expect("terminate response");
        writer.flush().expect("flush response");
        writer.shutdown(Shutdown::Both).ok();

        tx.send(request).ok();
    });

    StubServer { address, requests }
}

fn cli() -> Command {
    Command::new(env!("CARGO_BIN_EXE_gear-cli"))
}

fn run_cli(address: &SocketAddr, pane_id: Option<&str>, args: &[&str]) -> Output {
    let mut command = cli();
    command
        .args(args)
        .env("GEAR_CONTROL_ADDR", address.to_string())
        .env("GEAR_CONTROL_TOKEN", TOKEN);
    match pane_id {
        Some(id) => command.env("GEAR_PANE_ID", id),
        None => command.env_remove("GEAR_PANE_ID"),
    };
    command.output().expect("run gear-cli")
}

fn json_of(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(bytes)))
}

/// `parse_open` canonicalizes and stats the path *before* connecting, so an
/// open test needs a file that really exists.
fn probe_file(dir: &tempfile::TempDir, name: &str) -> String {
    let path = dir.path().join(name);
    std::fs::write(&path, "one\ntwo\nthree\nfour\n").expect("write probe file");
    path.to_string_lossy().into_owned()
}

#[test]
fn open_sends_an_authenticated_request_and_reports_the_result() {
    let server = serve_once(|request| {
        ControlResponse::success(
            request.id.clone(),
            json!({ "tab_id": 7, "space_id": "space-a", "focused": true }),
        )
    });
    let dir = tempfile::tempdir().expect("temp dir");
    let path = probe_file(&dir, "main.rs");

    let output = run_cli(
        &server.address,
        Some("42"),
        &["open", &path, "--line", "3", "--json"],
    );

    let request = server.request();
    assert_eq!(request.protocol, PROTOCOL_VERSION);
    assert_eq!(request.token, TOKEN, "token must ride every request");
    assert_eq!(request.method, "open");
    assert_eq!(request.params["line"], json!(3));
    assert!(
        request.params["path"]
            .as_str()
            .expect("path is a string")
            .ends_with("main.rs"),
        "sent path was {:?}",
        request.params["path"]
    );
    assert_eq!(
        request.caller.pane_id,
        Some(42),
        "the calling pane must be attributed so the file lands in its space"
    );
    assert!(!request.id.is_empty());

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    // `--json` wraps the payload in an {ok, result} envelope.
    let stdout = json_of(&output.stdout);
    assert_eq!(stdout["ok"], json!(true));
    assert_eq!(stdout["result"]["tab_id"], json!(7));
}

#[test]
fn no_focus_is_forwarded_to_the_app() {
    let server = serve_once(|request| {
        ControlResponse::success(request.id.clone(), json!({ "focused": false }))
    });
    let dir = tempfile::tempdir().expect("temp dir");
    let path = probe_file(&dir, "a.txt");

    let output = run_cli(&server.address, Some("3"), &["open", &path, "--no-focus", "--json"]);

    let request = server.request();
    assert_eq!(request.params["focus"], json!(false));
    assert!(output.status.success());
}

#[test]
fn an_external_caller_sends_no_pane_context() {
    let server =
        serve_once(|request| ControlResponse::success(request.id.clone(), json!({ "pong": true })));

    let output = run_cli(&server.address, None, &["ping", "--json"]);

    let request = server.request();
    assert_eq!(request.method, "ping");
    assert_eq!(
        request.caller.pane_id, None,
        "a shell outside Gear must fall back to the active UI context"
    );
    assert!(output.status.success());
}

#[test]
fn a_rejected_request_exits_with_the_request_code() {
    let server =
        serve_once(|_| ControlResponse::failure("server", "unauthorized", "token mismatch"));

    let output = run_cli(&server.address, Some("1"), &["ping", "--json"]);

    server.request();
    // A server-side rejection answers with the sentinel id, which the CLI must
    // still accept rather than reporting a protocol mismatch.
    assert_eq!(output.status.code(), Some(5));
    assert_eq!(json_of(&output.stderr)["error"]["code"], json!("unauthorized"));
}

#[test]
fn a_mismatched_response_id_is_a_protocol_error() {
    let server = serve_once(|_| ControlResponse::success("not-the-request-id", json!({})));

    let output = run_cli(&server.address, Some("1"), &["ping", "--json"]);

    server.request();
    assert_eq!(output.status.code(), Some(4));
}

#[test]
fn an_oversized_response_is_refused() {
    let server = serve_once(|request| {
        ControlResponse::success(request.id.clone(), json!({ "pad": "x".repeat(70 * 1024) }))
    });

    let output = run_cli(&server.address, Some("1"), &["ping", "--json"]);

    assert_eq!(output.status.code(), Some(4));
}

#[test]
fn a_dead_endpoint_reports_the_app_as_unavailable() {
    // Bind and immediately drop so the port is closed but well-formed.
    let address = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        listener.local_addr().expect("local addr")
    };

    let output = run_cli(&address, Some("1"), &["ping", "--json"]);

    assert_eq!(output.status.code(), Some(3));
    assert_eq!(
        json_of(&output.stderr)["error"]["code"],
        json!("app_unavailable")
    );
}

#[test]
fn a_non_loopback_endpoint_is_refused_before_connecting() {
    let output = cli()
        .args(["ping", "--json"])
        .env("GEAR_CONTROL_ADDR", "10.0.0.1:9999")
        .env("GEAR_CONTROL_TOKEN", TOKEN)
        .output()
        .expect("run gear-cli");

    assert_eq!(output.status.code(), Some(4));
    assert_eq!(
        json_of(&output.stderr)["error"]["code"],
        json!("invalid_endpoint")
    );
}

#[test]
fn a_short_token_is_refused_before_connecting() {
    let output = cli()
        .args(["ping", "--json"])
        .env("GEAR_CONTROL_ADDR", "127.0.0.1:9")
        .env("GEAR_CONTROL_TOKEN", "deadbeef")
        .output()
        .expect("run gear-cli");

    assert_eq!(output.status.code(), Some(4));
}

#[test]
fn half_configured_credentials_are_refused() {
    let output = cli()
        .args(["ping", "--json"])
        .env("GEAR_CONTROL_ADDR", "127.0.0.1:9")
        .env_remove("GEAR_CONTROL_TOKEN")
        .output()
        .expect("run gear-cli");

    assert_eq!(output.status.code(), Some(4));
    assert_eq!(
        json_of(&output.stderr)["error"]["code"],
        json!("invalid_environment")
    );
}

#[test]
fn a_missing_path_is_rejected_locally_without_contacting_the_app() {
    // Point at a closed port: reaching the network at all would surface as
    // app_unavailable, proving the client validated the path first.
    let address = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        listener.local_addr().expect("local addr")
    };
    let dir = tempfile::tempdir().expect("temp dir");
    let missing = dir.path().join("nope.txt");

    let output = run_cli(
        &address,
        Some("1"),
        &["open", &missing.to_string_lossy(), "--json"],
    );

    assert_eq!(output.status.code(), Some(2), "a bad path is a usage error");
    assert_eq!(
        json_of(&output.stderr)["error"]["code"],
        json!("path_not_found")
    );
}

#[test]
fn a_directory_is_rejected_locally() {
    let address = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        listener.local_addr().expect("local addr")
    };
    let dir = tempfile::tempdir().expect("temp dir");

    let output = run_cli(
        &address,
        Some("1"),
        &["open", &dir.path().to_string_lossy(), "--json"],
    );

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(json_of(&output.stderr)["error"]["code"], json!("not_a_file"));
}

#[test]
fn version_needs_no_running_app() {
    let output = cli()
        .arg("--version")
        .env_remove("GEAR_CONTROL_ADDR")
        .env_remove("GEAR_CONTROL_TOKEN")
        .output()
        .expect("run gear-cli");

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("utf8");
    assert!(stdout.starts_with("gear "), "got {stdout:?}");
    assert!(
        !stdout.to_lowercase().contains("terax"),
        "CLI must not carry upstream branding"
    );
}

/// Descriptor discovery reads `dirs::cache_dir()`. On Unix that honours
/// `XDG_CACHE_HOME`/`HOME`, so it can be redirected per-process. On Windows it
/// resolves through the Known Folder API, which ignores `%LOCALAPPDATA%` — a
/// test there would read (and depend on) the developer's real Gear state, so
/// these two run on Unix only. Windows CI still covers the env-var path above.
#[cfg(unix)]
mod descriptor_discovery {
    use super::*;
    use std::path::Path;

    fn write_descriptor(cache_root: &Path, address: &str, pid: u32) {
        let gear_dir = cache_root.join(".cache").join("gear");
        std::fs::create_dir_all(&gear_dir).expect("create cache dir");
        std::fs::write(
            gear_dir.join("control.json"),
            serde_json::to_vec(&json!({
                "protocol": PROTOCOL_VERSION,
                "address": address,
                "token": TOKEN,
                "pid": pid,
                "app_version": "0.1.2"
            }))
            .expect("encode descriptor"),
        )
        .expect("write descriptor");
    }

    fn cli_with_cache(cache_root: &Path) -> Command {
        let mut command = super::cli();
        command
            .env_remove("GEAR_CONTROL_ADDR")
            .env_remove("GEAR_CONTROL_TOKEN")
            .env("XDG_CACHE_HOME", cache_root.join(".cache"))
            .env("HOME", cache_root);
        command
    }

    #[test]
    fn the_cache_descriptor_is_discovered_and_used() {
        let server = serve_once(|request| {
            ControlResponse::success(request.id.clone(), json!({ "pong": true }))
        });
        let dir = tempfile::tempdir().expect("temp dir");
        // Claim this test process so the liveness check passes.
        write_descriptor(dir.path(), &server.address.to_string(), std::process::id());

        let output = cli_with_cache(dir.path())
            .args(["ping", "--json"])
            .output()
            .expect("run gear-cli");

        let request = server.request();
        assert_eq!(request.token, TOKEN);
        assert!(
            output.status.success(),
            "stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn a_descriptor_for_a_dead_process_is_rejected() {
        let dir = tempfile::tempdir().expect("temp dir");
        // pid 0 is never a live process, so a stale file must not be dialled.
        write_descriptor(dir.path(), "127.0.0.1:9", 0);

        let output = cli_with_cache(dir.path())
            .args(["ping", "--json"])
            .output()
            .expect("run gear-cli");

        assert_eq!(output.status.code(), Some(4));
        assert_eq!(
            json_of(&output.stderr)["error"]["code"],
            json!("invalid_endpoint")
        );
    }
}
