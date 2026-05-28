pub mod file;
pub mod grep;
pub mod mutate;
pub mod search;
pub mod tree;
pub mod watch;

use std::path::Path;

/// Strip the Windows verbatim prefix `\\?\` so paths are user-readable.
#[cfg(windows)]
fn strip_verbatim(s: String) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        s
    }
}

/// Frontend-facing path: forward-slash on every platform, no verbatim prefix.
pub fn to_canon(p: impl AsRef<Path>) -> String {
    let s = p.as_ref().to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        strip_verbatim(s).replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        s
    }
}
