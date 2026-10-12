//! A small local HTTP server that answers from a table of canned routes, so a
//! frontend can be built against an API that does not exist yet. One server at
//! a time, bound to 127.0.0.1; every request is kept in a log the pane reads.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const MAX_BODY: usize = 4 * 1024 * 1024;
const LOG_CAP: usize = 500;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    /// "GET", "POST"… or "*" for any method.
    pub method: String,
    /// "/users/:id" — a `:name` segment matches one segment, a trailing `*` matches the rest.
    pub path: String,
    #[serde(default)]
    pub status: Option<u16>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub delay_ms: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoggedRequest {
    pub seq: u64,
    pub at_ms: u64,
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub status: u16,
    /// Index of the route that answered, or None for a 404.
    pub route: Option<usize>,
}

struct Server {
    port: u16,
    stop: Arc<AtomicBool>,
    routes: Arc<Mutex<Vec<Route>>>,
    log: Arc<Mutex<VecDeque<LoggedRequest>>>,
}

fn slot() -> &'static Mutex<Option<Server>> {
    static SLOT: OnceLock<Mutex<Option<Server>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

static SEQ: AtomicU64 = AtomicU64::new(1);

type Params = Vec<(String, String)>;

/// Captured `:name` values when `pattern` matches `path`, else None.
pub fn match_path(pattern: &str, path: &str) -> Option<Params> {
    let pat: Vec<&str> = pattern.trim_matches('/').split('/').collect();
    let got: Vec<&str> = path.trim_matches('/').split('/').collect();
    let mut params = Vec::new();
    for (i, p) in pat.iter().enumerate() {
        if *p == "*" && i == pat.len() - 1 {
            params.push(("*".to_string(), got.get(i..).unwrap_or(&[]).join("/")));
            return Some(params);
        }
        let g = got.get(i)?;
        if let Some(name) = p.strip_prefix(':') {
            if g.is_empty() {
                return None;
            }
            params.push((name.to_string(), (*g).to_string()));
        } else if p != g {
            return None;
        }
    }
    (pat.len() == got.len()).then_some(params)
}

pub fn find_route<'a>(
    routes: &'a [Route],
    method: &str,
    path: &str,
) -> Option<(usize, &'a Route, Params)> {
    routes.iter().enumerate().find_map(|(i, r)| {
        if r.method != "*" && !r.method.eq_ignore_ascii_case(method) {
            return None;
        }
        match_path(&r.path, path).map(|params| (i, r, params))
    })
}

/// Fills `{{params.id}}`, `{{query.page}}`, `{{body}}`, `{{now}}` and `{{uuid}}` in a canned body.
pub fn render_body(
    template: &str,
    params: &[(String, String)],
    query: &str,
    body: &str,
    now_ms: u64,
) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let key = after[..end].trim();
        let value = if let Some(name) = key.strip_prefix("params.") {
            params
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        } else if let Some(name) = key.strip_prefix("query.") {
            query.split('&').find_map(|kv| {
                let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
                (k == name).then(|| v.to_string())
            })
        } else {
            match key {
                "body" => Some(body.to_string()),
                "now" => Some(now_ms.to_string()),
                "uuid" => Some(pseudo_uuid(now_ms)),
                _ => None,
            }
        };
        match value {
            Some(v) => out.push_str(&v),
            None => out.push_str(&rest[start..start + 2 + end + 2]),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

fn pseudo_uuid(seed: u64) -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        bytes[..8].copy_from_slice(&seed.to_le_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let h: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "",
    }
}

struct Parsed {
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    body: String,
}

fn read_request(stream: &mut TcpStream) -> Option<Parsed> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > 64 * 1024 {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let target = first.next()?.to_string();
    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    let length = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0)
        .min(MAX_BODY);
    while buf.len() < head_end + length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let end = (head_end + length).min(buf.len());
    Some(Parsed {
        method,
        path: path.to_string(),
        query: query.to_string(),
        headers,
        body: String::from_utf8_lossy(&buf[head_end..end]).into_owned(),
    })
}

fn handle(mut stream: TcpStream, routes: &Mutex<Vec<Route>>, log: &Mutex<VecDeque<LoggedRequest>>) {
    let Some(req) = read_request(&mut stream) else {
        return;
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let routes = lock(routes).clone();
    let mut status = 404u16;
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut body = format!(
        "{{\"error\":\"no mock route for {} {}\"}}",
        req.method,
        req.path.replace('"', "")
    );
    let mut matched = None;
    let mut delay = 0u64;
    // A browser's CORS preflight is answered for every path, so a page on another port can call the mock.
    if req.method == "OPTIONS" && find_route(&routes, "OPTIONS", &req.path).is_none() {
        status = 204;
        body = String::new();
    } else if let Some((i, route, params)) = find_route(&routes, &req.method, &req.path) {
        status = route.status.unwrap_or(200);
        headers = route.headers.clone();
        body = render_body(&route.body, &params, &req.query, &req.body, now_ms);
        matched = Some(i);
        delay = route.delay_ms.unwrap_or(0).min(60_000);
    }
    if delay > 0 {
        std::thread::sleep(Duration::from_millis(delay));
    }
    if !headers
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("content-type"))
    {
        let trimmed = body.trim_start();
        let kind = if trimmed.starts_with('{') || trimmed.starts_with('[') {
            "application/json; charset=utf-8"
        } else if trimmed.starts_with('<') {
            "text/html; charset=utf-8"
        } else {
            "text/plain; charset=utf-8"
        };
        headers.push(("Content-Type".to_string(), kind.to_string()));
    }
    let mut out = format!("HTTP/1.1 {status} {}\r\n", reason(status));
    for (k, v) in &headers {
        // A header value must stay on one line.
        out.push_str(&format!("{k}: {}\r\n", v.replace(['\r', '\n'], " ")));
    }
    out.push_str("Access-Control-Allow-Origin: *\r\n");
    out.push_str("Access-Control-Allow-Methods: *\r\n");
    out.push_str("Access-Control-Allow-Headers: *\r\n");
    out.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    ));
    let _ = stream.write_all(out.as_bytes());
    if req.method != "HEAD" {
        let _ = stream.write_all(body.as_bytes());
    }
    let _ = stream.flush();
    let mut log = lock(log);
    if log.len() >= LOG_CAP {
        log.pop_front();
    }
    log.push_back(LoggedRequest {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        at_ms: now_ms,
        method: req.method,
        path: req.path,
        query: req.query,
        headers: req.headers,
        body: req.body.chars().take(20_000).collect(),
        status,
        route: matched,
    });
}

fn stop_current(slot: &mut Option<Server>) {
    if let Some(server) = slot.take() {
        server.stop.store(true, Ordering::SeqCst);
        // Wake the accept loop so it sees the flag.
        let _ = TcpStream::connect(("127.0.0.1", server.port));
    }
}

/// Starts (or restarts) the server; `port` 0 picks a free one. Returns the bound port.
#[tauri::command]
pub fn mock_start(port: u16, routes: Vec<Route>) -> Result<u16, String> {
    let mut slot = lock(slot());
    stop_current(&mut slot);
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("could not listen on port {port}: {e}"))?;
    let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let routes = Arc::new(Mutex::new(routes));
    let log = Arc::new(Mutex::new(VecDeque::new()));
    let (stop2, routes2, log2) = (stop.clone(), routes.clone(), log.clone());
    std::thread::Builder::new()
        .name("gear-mock".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                if stop2.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else {
                    continue;
                };
                let (routes, log) = (routes2.clone(), log2.clone());
                let _ = std::thread::Builder::new()
                    .name("gear-mock-conn".to_string())
                    .spawn(move || handle(stream, &routes, &log));
            }
        })
        .map_err(|e| e.to_string())?;
    *slot = Some(Server {
        port: bound,
        stop,
        routes,
        log,
    });
    Ok(bound)
}

#[tauri::command]
pub fn mock_set_routes(routes: Vec<Route>) -> Result<(), String> {
    match lock(slot()).as_ref() {
        Some(server) => {
            *lock(&server.routes) = routes;
            Ok(())
        }
        None => Err("the mock server is not running".to_string()),
    }
}

#[tauri::command]
pub fn mock_stop() {
    stop_current(&mut lock(slot()));
}

#[derive(Serialize)]
pub struct MockStatus {
    pub port: Option<u16>,
    pub requests: Vec<LoggedRequest>,
}

/// The running port and every logged request with `seq` above `since`.
#[tauri::command]
pub fn mock_status(since: u64) -> MockStatus {
    match lock(slot()).as_ref() {
        Some(server) => MockStatus {
            port: Some(server.port),
            requests: lock(&server.log)
                .iter()
                .filter(|r| r.seq > since)
                .cloned()
                .collect(),
        },
        None => MockStatus {
            port: None,
            requests: Vec::new(),
        },
    }
}

#[tauri::command]
pub fn mock_clear_log() {
    if let Some(server) = lock(slot()).as_ref() {
        lock(&server.log).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(method: &str, path: &str, body: &str) -> Route {
        Route {
            method: method.to_string(),
            path: path.to_string(),
            body: body.to_string(),
            ..Route::default()
        }
    }

    #[test]
    fn path_patterns() {
        assert_eq!(match_path("/users", "/users"), Some(vec![]));
        assert_eq!(match_path("/users/", "/users"), Some(vec![]));
        assert_eq!(
            match_path("/users/:id", "/users/42"),
            Some(vec![("id".to_string(), "42".to_string())])
        );
        assert_eq!(match_path("/users/:id", "/users"), None);
        assert_eq!(match_path("/users/:id", "/users/42/posts"), None);
        assert_eq!(
            match_path("/files/*", "/files/a/b.txt"),
            Some(vec![("*".to_string(), "a/b.txt".to_string())])
        );
        assert_eq!(match_path("/", "/"), Some(vec![]));
        assert_eq!(match_path("/", "/x"), None);
    }

    #[test]
    fn first_matching_route_wins_and_method_is_checked() {
        let routes = vec![
            route("GET", "/users/me", "me"),
            route("GET", "/users/:id", "one"),
            route("*", "/users/:id", "any"),
        ];
        assert_eq!(find_route(&routes, "GET", "/users/me").unwrap().0, 0);
        assert_eq!(find_route(&routes, "get", "/users/7").unwrap().0, 1);
        assert_eq!(find_route(&routes, "DELETE", "/users/7").unwrap().0, 2);
        assert!(find_route(&routes, "GET", "/nope").is_none());
    }

    #[test]
    fn body_templates() {
        let params = vec![("id".to_string(), "42".to_string())];
        let out = render_body(
            r#"{"id":{{params.id}},"page":"{{ query.page }}","echo":{{body}},"t":{{now}},"x":"{{unknown}}"}"#,
            &params,
            "page=3&x=1",
            "[1]",
            1700,
        );
        assert_eq!(
            out,
            r#"{"id":42,"page":"3","echo":[1],"t":1700,"x":"{{unknown}}"}"#
        );
        assert_eq!(render_body("no {{ close", &[], "", "", 0), "no {{ close");
        assert_eq!(render_body("{{uuid}}", &[], "", "", 0).len(), 36);
    }

    #[test]
    fn serves_a_route_over_tcp_and_logs_it() {
        let port = mock_start(
            0,
            vec![Route {
                status: Some(201),
                ..route("POST", "/items/:id", r#"{"id":"{{params.id}}"}"#)
            }],
        )
        .unwrap();
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(b"POST /items/9?x=1 HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi")
            .unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();
        assert!(resp.starts_with("HTTP/1.1 201 Created\r\n"), "{resp}");
        assert!(resp.contains("Content-Type: application/json"));
        assert!(resp.ends_with(r#"{"id":"9"}"#));
        let status = mock_status(0);
        assert_eq!(status.port, Some(port));
        let last = status.requests.last().unwrap();
        assert_eq!(
            (last.method.as_str(), last.path.as_str()),
            ("POST", "/items/9")
        );
        assert_eq!(
            (last.query.as_str(), last.body.as_str(), last.status),
            ("x=1", "hi", 201)
        );
        mock_stop();
        assert_eq!(mock_status(0).port, None);
    }
}
