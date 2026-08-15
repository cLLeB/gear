//! Reading a file list off the OS clipboard, so files copied in Explorer /
//! Finder / a Linux file manager can be pasted into Gear's sidebar.
//!
//! Each platform names this differently — CF_HDROP on Windows, `NSFilenamesPboardType`
//! on macOS, `text/uri-list` on X11/Wayland — so each gets its own reader and
//! they all return the same thing: absolute paths, forward-slash normalized to
//! match the rest of the tree. An empty vec means "nothing file-shaped on the
//! clipboard", which is a normal answer, not an error; the caller falls back to
//! pasting clipboard text or an image.

/// Absolute paths of files/dirs currently on the OS clipboard.
#[tauri::command]
pub fn clipboard_read_files() -> Result<Vec<String>, String> {
    read_files()
}

fn normalize(path: String) -> String {
    path.replace('\\', "/")
}

// ── Windows ────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn read_files() -> Result<Vec<String>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    // Guards the global clipboard lock: every early return has to close it, or
    // no other process can read the clipboard until Gear exits.
    struct ClipboardLock;
    impl Drop for ClipboardLock {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP as u32) == 0 {
            return Ok(Vec::new());
        }
        // Another process can hold the clipboard open; a few quick retries cover
        // the usual case of the source app not having released it yet.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !opened {
            return Err("clipboard is busy".into());
        }
        let _lock = ClipboardLock;

        let handle = GetClipboardData(CF_HDROP as u32);
        if handle.is_null() {
            return Ok(Vec::new());
        }

        // 0xFFFFFFFF asks DragQueryFileW for the count rather than a path.
        let count = DragQueryFileW(handle as _, 0xFFFF_FFFF, std::ptr::null_mut(), 0);
        let mut out = Vec::with_capacity(count as usize);
        for i in 0..count {
            let len = DragQueryFileW(handle as _, i, std::ptr::null_mut(), 0);
            if len == 0 {
                continue;
            }
            // +1 for the terminating NUL that DragQueryFileW writes.
            let mut buf = vec![0u16; len as usize + 1];
            let written = DragQueryFileW(handle as _, i, buf.as_mut_ptr(), buf.len() as u32);
            if written == 0 {
                continue;
            }
            let os = std::ffi::OsString::from_wide(&buf[..written as usize]);
            if let Some(s) = os.to_str() {
                out.push(normalize(s.to_string()));
            }
        }
        Ok(out)
    }
}

// ── macOS ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn read_files() -> Result<Vec<String>, String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSArray, NSString};

    unsafe {
        let pasteboard: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
        if pasteboard.is_null() {
            return Ok(Vec::new());
        }
        // The legacy NSFilenamesPboardType is still what Finder writes, and it
        // hands back plain paths rather than file:// URLs needing decoding.
        let kind = NSString::from_str("NSFilenamesPboardType");
        let list: *mut AnyObject = msg_send![pasteboard, propertyListForType: &*kind];
        if list.is_null() {
            return Ok(Vec::new());
        }
        let array: Retained<NSArray<NSString>> = Retained::retain(list.cast()).ok_or_else(|| {
            "clipboard file list could not be retained".to_string()
        })?;
        Ok(array.iter().map(|s| normalize(s.to_string())).collect())
    }
}

// ── Linux / BSD ────────────────────────────────────────────────────────────

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn read_files() -> Result<Vec<String>, String> {
    // No portable API here: read the freedesktop `text/uri-list` target through
    // whichever helper is installed. Missing helpers are not an error — the
    // caller just falls back to pasting text.
    const CANDIDATES: [(&str, &[&str]); 2] = [
        ("wl-paste", &["--no-newline", "--type", "text/uri-list"]),
        ("xclip", &["-selection", "clipboard", "-t", "text/uri-list", "-o"]),
    ];

    for (bin, args) in CANDIDATES {
        let Ok(out) = std::process::Command::new(bin).args(args).output() else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let paths = parse_uri_list(&text);
        if !paths.is_empty() {
            return Ok(paths);
        }
    }
    Ok(Vec::new())
}

/// Parses a freedesktop `text/uri-list` body into local absolute paths.
/// Comment lines, blank lines and non-`file://` URIs are skipped.
#[cfg(any(test, not(any(target_os = "windows", target_os = "macos"))))]
pub fn parse_uri_list(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(rest) = line.strip_prefix("file://") else {
            continue;
        };
        // "file://host/path" — an empty or localhost authority means this machine.
        let path = match rest.find('/') {
            Some(0) => rest,
            Some(i) if &rest[..i] == "localhost" => &rest[i..],
            _ => continue,
        };
        out.push(percent_decode(path));
    }
    out
}

#[cfg(any(test, not(any(target_os = "windows", target_os = "macos"))))]
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_file_uris() {
        assert_eq!(
            parse_uri_list("file:///home/a/x.txt\nfile:///home/a/y.txt"),
            vec!["/home/a/x.txt", "/home/a/y.txt"]
        );
    }

    #[test]
    fn skips_comments_blanks_and_foreign_schemes() {
        let text = "# comment\n\nfile:///a\nhttp://example.com/b\n";
        assert_eq!(parse_uri_list(text), vec!["/a"]);
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(
            parse_uri_list("file:///home/a/my%20file%231.txt"),
            vec!["/home/a/my file#1.txt"]
        );
    }

    #[test]
    fn accepts_a_localhost_authority_and_rejects_a_remote_host() {
        assert_eq!(parse_uri_list("file://localhost/a"), vec!["/a"]);
        assert!(parse_uri_list("file://otherbox/a").is_empty());
    }

    #[test]
    fn leaves_a_malformed_escape_alone() {
        assert_eq!(parse_uri_list("file:///a%zz"), vec!["/a%zz"]);
    }

    #[test]
    fn returns_nothing_for_empty_input() {
        assert!(parse_uri_list("").is_empty());
    }
}
