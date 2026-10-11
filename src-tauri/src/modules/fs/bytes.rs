//! Raw file bytes for the frontend (base64): data URIs, checksums and the hex
//! viewer. Capped so a stray click on a huge file can't flood the IPC bridge.

use std::io::Read;

use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const HARD_CAP: u64 = 64 * 1024 * 1024;

#[derive(Serialize)]
pub struct FileBytes {
    /// Base64 (standard alphabet, padded).
    pub data: String,
    /// Full size of the file on disk.
    pub size: u64,
    /// True when only the first `max_bytes` were read.
    pub truncated: bool,
}

pub fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[tauri::command]
pub async fn fs_read_bytes(
    path: String,
    max_bytes: Option<u64>,
    workspace: Option<WorkspaceEnv>,
) -> Result<FileBytes, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    let cap = max_bytes.unwrap_or(HARD_CAP).min(HARD_CAP);
    tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&target).map_err(|e| e.to_string())?;
        let size = file.metadata().map_err(|e| e.to_string())?.len();
        let mut buf = Vec::with_capacity(size.min(cap) as usize);
        file.take(cap)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        Ok(FileBytes {
            data: base64_encode(&buf),
            size,
            truncated: size > cap,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_rfc4648() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(&[0xff, 0xfe, 0x00]), "//4A");
    }
}
