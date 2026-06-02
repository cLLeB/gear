//! Content-addressed, zstd-compressed blob store.
//!
//! Identical content hashes to the same path, so re-saving an unchanged file
//! costs nothing (git's object-store trick). Layout: `root/ab/cdef…` where the
//! full blake3 hex hash is `abcdef…`.

use std::path::{Path, PathBuf};

pub struct BlobStore {
    root: PathBuf,
}

impl BlobStore {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
        }
    }

    /// Store `content`, returning its hex blake3 hash. Idempotent: storing the
    /// same bytes twice writes once.
    pub fn put(&self, content: &[u8]) -> std::io::Result<String> {
        let hash = blake3::hash(content).to_hex().to_string();
        let dir = self.root.join(&hash[..2]);
        let file = dir.join(&hash[2..]);
        if file.exists() {
            return Ok(hash);
        }
        std::fs::create_dir_all(&dir)?;
        let compressed = zstd::encode_all(content, 3).map_err(std::io::Error::other)?;
        // Write to a temp sibling then rename so a concurrent reader never sees
        // a half-written blob.
        let tmp = dir.join(format!("{}.tmp", &hash[2..]));
        std::fs::write(&tmp, &compressed)?;
        std::fs::rename(&tmp, &file)?;
        Ok(hash)
    }

    pub fn get(&self, hash: &str) -> std::io::Result<Vec<u8>> {
        let file = self.root.join(&hash[..2]).join(&hash[2..]);
        let compressed = std::fs::read(&file)?;
        zstd::decode_all(&compressed[..]).map_err(std::io::Error::other)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_then_get_roundtrips_and_dedups() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path());
        let h1 = store.put(b"hello world").unwrap();
        let h2 = store.put(b"hello world").unwrap();
        assert_eq!(h1, h2, "same content => same hash");
        assert_eq!(store.get(&h1).unwrap(), b"hello world");
        // dedup: only one file on disk in the shard dir
        let count = std::fs::read_dir(dir.path().join(&h1[..2])).unwrap().count();
        assert_eq!(count, 1);
    }

    #[test]
    fn distinct_content_distinct_hash() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path());
        let a = store.put(b"v1").unwrap();
        let b = store.put(b"v2").unwrap();
        assert_ne!(a, b);
        assert_eq!(store.get(&a).unwrap(), b"v1");
        assert_eq!(store.get(&b).unwrap(), b"v2");
    }
}
