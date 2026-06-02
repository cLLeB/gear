pub mod file;
pub mod grep;
pub mod mutate;
pub mod search;
pub mod tree;
pub mod watch;

use std::path::Path;

/// Strip the Windows verbatim prefix `\\?\` so paths are user-readable.
#[cfg(windows)]
fn strip_verbatim(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        s.to_owned()
    }
}

/// Frontend-facing path: forward-slash on every platform, no verbatim prefix.
pub fn to_canon(p: impl AsRef<Path>) -> String {
    let s = p.as_ref().to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        strip_verbatim(&s).replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        s
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{strip_verbatim, to_canon};
    use proptest::prelude::*;

    #[test]
    fn strips_drive_verbatim_prefix() {
        assert_eq!(strip_verbatim(r"\\?\C:\foo"), "C:/foo");
    }

    #[test]
    fn strips_unc_verbatim_prefix() {
        assert_eq!(strip_verbatim(r"\\?\UNC\server\share"), r"UNC\server\share");
    }

    #[test]
    fn leaves_plain_path_unchanged() {
        assert_eq!(strip_verbatim(r"C:\foo\bar"), r"C:\foo\bar");
    }

    #[test]
    fn handles_drive_root() {
        assert_eq!(strip_verbatim(r"\\?\C:\"), "C:/");
    }

    proptest! {
        #[test]
        fn strip_verbatim_never_leaves_backslashes_or_prefix(s in r"[A-Za-z0-9\\/: .]{0,40}") {
            let out = to_canon(&s);
            prop_assert!(!out.contains('\\'));
            prop_assert!(!out.starts_with(r"\\?\"));
        }

        #[test]
        fn strip_verbatim_is_idempotent(s in r"[A-Za-z0-9\\/: .]{0,40}") {
            let once = strip_verbatim(&s);
            prop_assert_eq!(strip_verbatim(&once), once);
        }

        #[test]
        fn strip_verbatim_on_plain_input_equals_slash_swap(s in r"[A-Za-z0-9\\/: .]{0,40}") {
            prop_assume!(!s.starts_with(r"\\?\"));
            prop_assert_eq!(strip_verbatim(&s), s.replace('\\', "/"));
        }

        #[test]
        fn strip_verbatim_drive_root_is_preserved(
            drive in r"[A-Z]",
            tail in r"[A-Za-z0-9\\/ .]{0,40}",
        ) {
            let input = format!(r"\\?\{drive}:\{tail}");
            let out = strip_verbatim(&input);
            let expected = format!("{drive}:/");
            prop_assert!(out.starts_with(&expected));
        }

        #[test]
        fn strip_verbatim_unc_becomes_double_slash(tail in r"[A-Za-z0-9\\/ .]{0,40}") {
            let input = format!(r"\\?\UNC\{tail}");
            let out = strip_verbatim(&input);
            prop_assert!(out.starts_with(r"UNC\") || out.is_empty() || !out.starts_with(r"\\?\"));
        }
    }
}
