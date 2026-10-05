//! Saving an image on the OS clipboard (a screenshot, an image copied from a
//! browser) to a PNG file, so the terminal can paste its path.
//!
//! Terminal apps that accept images — Claude Code, Codex, aider — take a pasted
//! image *path* and attach the file. A terminal can only send text to the PTY,
//! so when a paste finds no text but an image, the frontend asks for this file
//! and bracketed-pastes its path instead of silently doing nothing.

use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Files older than this are swept the next time an image is saved.
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Absolute path of a PNG holding the clipboard image, or `None` when the
/// clipboard holds no image. Async so it runs off the main thread — arboard
/// can deadlock there on Linux.
#[tauri::command]
pub async fn clipboard_save_image(app: AppHandle) -> Result<Option<String>, String> {
    let dir = std::env::temp_dir().join("gear-clipboard");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    sweep_old(&dir);

    if let Ok(image) = app.clipboard().read_image() {
        let (w, h) = (image.width(), image.height());
        let rgba = image.rgba();
        if w > 0 && h > 0 && rgba.len() == (w as usize) * (h as usize) * 4 {
            let path = dir.join(file_name(rgba));
            if !path.exists() {
                write_png(&path, w, h, rgba)?;
            }
            return Ok(Some(path.to_string_lossy().into_owned()));
        }
    }

    // Some Wayland compositors don't speak the data-control protocol arboard
    // relies on; the CLI helpers still read the clipboard there.
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    if let Some(bytes) = read_png_via_cli() {
        let path = dir.join(file_name(&bytes));
        if !path.exists() {
            fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        }
        return Ok(Some(path.to_string_lossy().into_owned()));
    }

    Ok(None)
}

/// Content-addressed, so pasting the same screenshot twice reuses one file.
fn file_name(bytes: &[u8]) -> String {
    let hash = blake3::hash(bytes).to_hex();
    format!("clipboard-{}.png", &hash[..16])
}

fn write_png(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let tmp: PathBuf = path.with_extension("png.part");
    let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let result = encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(rgba))
        .map_err(|e| e.to_string());
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    // Rename last so a reader never sees a half-written image.
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn sweep_old(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > MAX_AGE);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn read_png_via_cli() -> Option<Vec<u8>> {
    const CANDIDATES: [(&str, &[&str]); 2] = [
        ("wl-paste", &["--no-newline", "--type", "image/png"]),
        ("xclip", &["-selection", "clipboard", "-t", "image/png", "-o"]),
    ];
    const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";
    for (bin, args) in CANDIDATES {
        let Ok(out) = std::process::Command::new(bin).args(args).output() else {
            continue;
        };
        if out.status.success() && out.stdout.starts_with(PNG_MAGIC) {
            return Some(out.stdout);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_stable_per_content() {
        assert_eq!(file_name(b"abc"), file_name(b"abc"));
        assert_ne!(file_name(b"abc"), file_name(b"abd"));
        assert!(file_name(b"abc").starts_with("clipboard-"));
    }

    #[test]
    fn writes_a_decodable_png() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.png");
        let rgba = vec![255u8, 0, 0, 255, 0, 255, 0, 255];
        write_png(&path, 2, 1, &rgba).unwrap();
        let decoder = png::Decoder::new(fs::File::open(&path).unwrap());
        let reader = decoder.read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (2, 1));
        assert!(!path.with_extension("png.part").exists());
    }
}
