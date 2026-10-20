//! The browser pane: a real native webview per browser tab, placed over the
//! pane's area in the main window. Unlike an `<iframe>`, a top-level webview
//! loads sites that refuse to be framed (X-Frame-Options / frame-ancestors)
//! and keeps their cookies and sign-ins.
//!
//! Safety: pages here are remote origins, and Tauri rejects IPC from remote
//! origins unless a capability grants it (none does), so a site cannot reach
//! Gear's commands. Navigation is limited to web schemes, so a page cannot
//! send the webview to `file:` or app-internal URLs.

use std::path::PathBuf;

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, WebviewUrl, Window,
};

const EVENT: &str = "browser:event";

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum BrowserEvent {
    Navigated {
        key: String,
        url: String,
    },
    Loading {
        key: String,
        url: String,
    },
    Loaded {
        key: String,
        url: String,
    },
    Title {
        key: String,
        title: String,
    },
    NewWindow {
        key: String,
        url: String,
    },
    DownloadStarted {
        key: String,
        url: String,
        path: String,
    },
    DownloadFinished {
        key: String,
        url: String,
        path: Option<String>,
        success: bool,
    },
    Blocked {
        key: String,
        url: String,
    },
    /// A Gear shortcut pressed while the page had focus.
    Shortcut {
        key: String,
        combo: String,
    },
}

/// Gear shortcuts the page hands back to Gear (`mod` is Ctrl, or Cmd on
/// macOS). The page's own script could fake these, so only harmless ones
/// that move focus or open views are here — nothing that closes, saves or
/// changes files.
const FORWARDED_SHORTCUTS: &[&str] = &[
    "mod+shift+p",
    "mod+p",
    "mod+,",
    "mod+k",
    "mod+t",
    "mod+e",
    "mod+l",
    "mod+b",
    "mod+i",
    "mod+shift+i",
    "mod+j",
    "mod+]",
    "mod+[",
    "mod+shift+e",
    "mod+shift+f",
    "mod+shift+s",
    "mod+alt+t",
    "ctrl+tab",
    "ctrl+shift+tab",
    "mod+1",
    "mod+2",
    "mod+3",
    "mod+4",
    "mod+5",
    "mod+6",
    "mod+7",
    "mod+8",
    "mod+9",
];

/// Runs in every page: turns a forwarded shortcut into a `gear-key:`
/// navigation, which the backend cancels and reports. No IPC is involved.
fn shortcut_script() -> String {
    format!(
        r#"(() => {{
  const allowed = new Set({allowed});
  const mac = /Mac/.test(navigator.platform);
  addEventListener("keydown", (e) => {{
    if (!e.isTrusted) return;
    const k = e.key.toLowerCase();
    let combo = null;
    if (k === "tab" && e.ctrlKey) combo = "ctrl+" + (e.shiftKey ? "shift+" : "") + "tab";
    else if (mac ? e.metaKey : e.ctrlKey) combo = "mod+" + (e.altKey ? "alt+" : "") + (e.shiftKey ? "shift+" : "") + k;
    if (!combo || !allowed.has(combo)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.href = "gear-key:" + combo;
  }}, true);
}})();"#,
        allowed = serde_json::to_string(FORWARDED_SHORTCUTS).unwrap_or_else(|_| "[]".into())
    )
}

/// The shortcut a `gear-key:` URL carries, if it is one Gear accepts.
pub(crate) fn forwarded_shortcut(url: &Url) -> Option<String> {
    if url.scheme() != "gear-key" {
        return None;
    }
    let combo = url.path().to_ascii_lowercase();
    FORWARDED_SHORTCUTS
        .contains(&combo.as_str())
        .then_some(combo)
}

/// Webview labels are `browser-<key>`; keys come from the frontend, so they
/// are limited to characters a label accepts.
fn label_for(key: &str) -> Result<String, String> {
    if key.is_empty()
        || key.len() > 64
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid browser key: {key}"));
    }
    Ok(format!("browser-{key}"))
}

/// Schemes a page in the browser pane may navigate to.
pub(crate) fn allowed_url(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => true,
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

fn parse_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("invalid URL {url}: {e}"))?;
    if !allowed_url(&parsed) {
        return Err(format!(
            "only http and https pages can be opened here, not {}",
            parsed.scheme()
        ));
    }
    Ok(parsed)
}

/// A free file name in `dir` for `name`: `report.pdf`, then `report (1).pdf`…
pub(crate) fn unique_download_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let clean: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_matches('.').to_string();
    let clean = if clean.is_empty() {
        "download".to_string()
    } else {
        clean
    };
    let candidate = dir.join(&clean);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match clean.rfind('.') {
        Some(i) if i > 0 => (clean[..i].to_string(), clean[i..].to_string()),
        _ => (clean.clone(), String::new()),
    };
    (1..10_000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(candidate)
}

fn file_name_of(url: &Url) -> String {
    url.path_segments()
        .and_then(|mut s| s.next_back().map(str::to_string))
        .filter(|s| !s.is_empty())
        .map(|s| percent_decode(&s))
        .unwrap_or_else(|| "download".to_string())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn emit<R: Runtime>(app: &AppHandle<R>, event: BrowserEvent) {
    let _ = app.emit(EVENT, event);
}

/// Where a view sits in its window, in logical pixels.
#[derive(Clone, Copy, serde::Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn position(self) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x, self.y)
    }
    fn size(self) -> LogicalSize<f64> {
        LogicalSize::new(self.width.max(1.0), self.height.max(1.0))
    }
}

fn place<R: Runtime>(w: &tauri::Webview<R>, bounds: Bounds) -> Result<(), String> {
    w.set_position(bounds.position())
        .map_err(|e| e.to_string())?;
    w.set_size(bounds.size()).map_err(|e| e.to_string())
}

/// Opens a native webview for browser tab `key` at `bounds` in the calling
/// window. Opening an existing key just moves it.
#[tauri::command]
pub async fn browser_open<R: Runtime>(
    window: Window<R>,
    app: AppHandle<R>,
    key: String,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    let label = label_for(&key)?;
    let start = parse_url(&url)?;
    if let Some(existing) = app.get_webview(&label) {
        return place(&existing, bounds);
    }
    let (a1, a2, a3, a4, a5) = (
        app.clone(),
        app.clone(),
        app.clone(),
        app.clone(),
        app.clone(),
    );
    let (k1, k2, k3, k4, k5) = (
        key.clone(),
        key.clone(),
        key.clone(),
        key.clone(),
        key.clone(),
    );
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(start))
        .initialization_script(shortcut_script())
        .on_navigation(move |url| {
            if url.scheme() == "gear-key" {
                if let Some(combo) = forwarded_shortcut(url) {
                    // Hand keyboard focus back to Gear's own UI, then let it act.
                    if let Some(main) = a1.get_webview("main") {
                        let _ = main.set_focus();
                    }
                    emit(
                        &a1,
                        BrowserEvent::Shortcut {
                            key: k1.clone(),
                            combo,
                        },
                    );
                }
                return false;
            }
            if allowed_url(url) {
                emit(
                    &a1,
                    BrowserEvent::Navigated {
                        key: k1.clone(),
                        url: url.to_string(),
                    },
                );
                true
            } else {
                emit(
                    &a1,
                    BrowserEvent::Blocked {
                        key: k1.clone(),
                        url: url.to_string(),
                    },
                );
                false
            }
        })
        .on_page_load(move |_webview, payload| {
            let url = payload.url().to_string();
            let event = match payload.event() {
                PageLoadEvent::Started => BrowserEvent::Loading {
                    key: k2.clone(),
                    url,
                },
                PageLoadEvent::Finished => BrowserEvent::Loaded {
                    key: k2.clone(),
                    url,
                },
            };
            emit(&a2, event);
        })
        .on_document_title_changed(move |_webview, title| {
            emit(
                &a3,
                BrowserEvent::Title {
                    key: k3.clone(),
                    title,
                },
            );
        })
        // target=_blank and window.open: let the UI open a new browser tab.
        .on_new_window(move |url, _features| {
            if allowed_url(&url) {
                emit(
                    &a4,
                    BrowserEvent::NewWindow {
                        key: k4.clone(),
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let dir = dirs::download_dir()
                        .or_else(dirs::home_dir)
                        .unwrap_or_else(std::env::temp_dir);
                    let target = unique_download_path(&dir, &file_name_of(&url));
                    *destination = target.clone();
                    emit(
                        &a5,
                        BrowserEvent::DownloadStarted {
                            key: k5.clone(),
                            url: url.to_string(),
                            path: target.to_string_lossy().into_owned(),
                        },
                    );
                }
                DownloadEvent::Finished { url, path, success } => {
                    emit(
                        &a5,
                        BrowserEvent::DownloadFinished {
                            key: k5.clone(),
                            url: url.to_string(),
                            path: path.map(|p| p.to_string_lossy().into_owned()),
                            success,
                        },
                    );
                }
                _ => {}
            }
            true
        });
    window
        .add_child(builder, bounds.position(), bounds.size())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn webview<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<tauri::Webview<R>, String> {
    let label = label_for(key)?;
    app.get_webview(&label)
        .ok_or_else(|| format!("no browser view {key}"))
}

/// Moves and resizes the view (logical pixels).
#[tauri::command]
pub fn browser_set_bounds<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    bounds: Bounds,
) -> Result<(), String> {
    place(&webview(&app, &key)?, bounds)
}

/// Shows or hides the view; hidden while its tab is in the background or an overlay covers it.
#[tauri::command]
pub fn browser_set_visible<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    visible: bool,
) -> Result<(), String> {
    let w = webview(&app, &key)?;
    if visible { w.show() } else { w.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_navigate<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    url: String,
) -> Result<(), String> {
    webview(&app, &key)?
        .navigate(parse_url(&url)?)
        .map_err(|e| e.to_string())
}

/// back, forward, reload, stop
#[tauri::command]
pub fn browser_command<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    command: String,
) -> Result<(), String> {
    let w = webview(&app, &key)?;
    match command.as_str() {
        "reload" => w.reload().map_err(|e| e.to_string()),
        "back" => w.eval("history.back()").map_err(|e| e.to_string()),
        "forward" => w.eval("history.forward()").map_err(|e| e.to_string()),
        "stop" => w.eval("window.stop()").map_err(|e| e.to_string()),
        "hardReload" => w.eval("location.reload()").map_err(|e| e.to_string()),
        other => Err(format!("unknown browser command {other}")),
    }
}

#[tauri::command]
pub fn browser_set_zoom<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    factor: f64,
) -> Result<(), String> {
    webview(&app, &key)?
        .set_zoom(factor.clamp(0.25, 5.0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_devtools<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    webview(&app, &key)?.open_devtools();
    Ok(())
}

#[tauri::command]
pub fn browser_close<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    match app.get_webview(&label_for(&key)?) {
        Some(w) => w.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_checked_before_they_become_labels() {
        assert_eq!(label_for("tab-12_a").unwrap(), "browser-tab-12_a");
        assert!(label_for("").is_err());
        assert!(label_for("../main").is_err());
        assert!(label_for(&"x".repeat(65)).is_err());
    }

    #[test]
    fn only_harmless_shortcuts_are_forwarded() {
        let s = |u: &str| forwarded_shortcut(&Url::parse(u).unwrap());
        assert_eq!(s("gear-key:mod+shift+p").as_deref(), Some("mod+shift+p"));
        assert_eq!(s("gear-key:ctrl+tab").as_deref(), Some("ctrl+tab"));
        assert_eq!(s("gear-key:MOD+L").as_deref(), Some("mod+l"));
        // A page could fake these: closing, quitting and saving are never accepted.
        for bad in [
            "gear-key:mod+w",
            "gear-key:mod+shift+w",
            "gear-key:mod+q",
            "gear-key:mod+s",
            "gear-key:mod+d",
            "gear-key:anything",
            "https://example.com/gear-key:mod+p",
        ] {
            assert_eq!(s(bad), None, "{bad}");
        }
        let script = shortcut_script();
        assert!(script.contains("\"mod+shift+p\""));
        assert!(script.contains("e.isTrusted"));
    }

    #[test]
    fn only_web_schemes_are_allowed() {
        for ok in [
            "https://github.com/",
            "http://localhost:5173/x",
            "about:blank",
        ] {
            assert!(allowed_url(&Url::parse(ok).unwrap()), "{ok}");
        }
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tauri://localhost/",
            "data:text/html,hi",
            "about:config",
            "asset://localhost/x",
            "ftp://x/y",
        ] {
            assert!(!allowed_url(&Url::parse(bad).unwrap()), "{bad}");
        }
        assert!(parse_url("file:///C:/Windows").is_err());
        assert!(parse_url("not a url").is_err());
    }

    #[test]
    fn download_names_are_safe_and_unique() {
        let dir = std::env::temp_dir().join(format!("gear-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_download_path(&dir, "report.pdf");
        assert_eq!(first.file_name().unwrap(), "report.pdf");
        std::fs::write(&first, b"x").unwrap();
        assert_eq!(
            unique_download_path(&dir, "report.pdf")
                .file_name()
                .unwrap(),
            "report (1).pdf"
        );
        assert_eq!(
            unique_download_path(&dir, "../evil:name?.txt")
                .file_name()
                .unwrap(),
            "_evil_name_.txt"
        );
        assert_eq!(
            unique_download_path(&dir, "...").file_name().unwrap(),
            "download"
        );
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(
            file_name_of(&Url::parse("https://x.com/files/My%20Report.pdf?dl=1").unwrap()),
            "My Report.pdf"
        );
        assert_eq!(
            file_name_of(&Url::parse("https://x.com/").unwrap()),
            "download"
        );
    }
}
