//! Secret scanning: provider-specific token formats (AWS, GitHub, GitLab,
//! Slack, Stripe, Google, OpenAI, Anthropic, npm, SendGrid, Twilio, private
//! keys, JWTs, credentials in URLs) plus generic `password = "…"` assignments
//! gated by entropy. Scans the working tree (respecting .gitignore) and,
//! optionally, every line ever added in git history.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

pub struct Rule {
    pub id: &'static str,
    pub title: &'static str,
    /// Rust regex; capture group 1 (if any) is the secret itself.
    pub pattern: &'static str,
    /// POSIX ERE for the pre-commit hook (None: not checked there).
    pub ere: Option<&'static str>,
    /// Minimum Shannon entropy of the secret (bits per char).
    pub entropy: f64,
}

pub const RULES: &[Rule] = &[
    Rule {
        id: "private-key",
        title: "Private key",
        pattern: r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----",
        ere: Some("-----BEGIN ([A-Z]+ )?PRIVATE KEY"),
        entropy: 0.0,
    },
    Rule {
        id: "aws-access-key",
        title: "AWS access key ID",
        pattern: r"\b((?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16})\b",
        ere: Some("(AKIA|ASIA)[0-9A-Z]{16}"),
        entropy: 3.0,
    },
    Rule {
        id: "aws-secret-key",
        title: "AWS secret access key",
        pattern: r#"(?i)aws.{0,20}?secret.{0,20}?['"=:\s]\s*['"]?([A-Za-z0-9/+=]{40})\b"#,
        ere: None,
        entropy: 4.0,
    },
    Rule {
        id: "github-token",
        title: "GitHub token",
        pattern: r"\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255})\b",
        ere: Some("gh[pousr]_[A-Za-z0-9]{36}"),
        entropy: 3.0,
    },
    Rule {
        id: "github-pat",
        title: "GitHub fine-grained token",
        pattern: r"\b(github_pat_[A-Za-z0-9_]{82})\b",
        ere: Some("github_pat_[A-Za-z0-9_]{82}"),
        entropy: 3.0,
    },
    Rule {
        id: "gitlab-token",
        title: "GitLab token",
        pattern: r"\b(glpat-[A-Za-z0-9_-]{20,})\b",
        ere: Some("glpat-[A-Za-z0-9_-]{20}"),
        entropy: 3.0,
    },
    Rule {
        id: "slack-token",
        title: "Slack token",
        pattern: r"\b(xox[baprs]-[A-Za-z0-9-]{10,})\b",
        ere: Some("xox[baprs]-[A-Za-z0-9-]{10,}"),
        entropy: 3.0,
    },
    Rule {
        id: "slack-webhook",
        title: "Slack webhook",
        pattern: r"(https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+)",
        ere: Some("hooks\\.slack\\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/"),
        entropy: 0.0,
    },
    Rule {
        id: "stripe-key",
        title: "Stripe live key",
        pattern: r"\b((?:sk|rk)_live_[0-9A-Za-z]{24,})\b",
        ere: Some("(sk|rk)_live_[0-9A-Za-z]{24}"),
        entropy: 3.0,
    },
    Rule {
        id: "google-api-key",
        title: "Google API key",
        pattern: r"\b(AIza[0-9A-Za-z_-]{35})\b",
        ere: Some("AIza[0-9A-Za-z_-]{35}"),
        entropy: 3.0,
    },
    Rule {
        id: "openai-key",
        title: "OpenAI API key",
        pattern: r"\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,})\b",
        ere: Some("sk-[A-Za-z0-9_-]{20,}T3BlbkFJ"),
        entropy: 3.0,
    },
    Rule {
        id: "anthropic-key",
        title: "Anthropic API key",
        pattern: r"\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,})",
        ere: Some("sk-ant-(api|admin)[0-9]{2}-"),
        entropy: 3.0,
    },
    Rule {
        id: "npm-token",
        title: "npm token",
        pattern: r"\b(npm_[A-Za-z0-9]{36})\b",
        ere: Some("npm_[A-Za-z0-9]{36}"),
        entropy: 3.0,
    },
    Rule {
        id: "sendgrid-key",
        title: "SendGrid API key",
        pattern: r"\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b",
        ere: Some("SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}"),
        entropy: 3.0,
    },
    Rule {
        id: "twilio-key",
        title: "Twilio API key",
        pattern: r"\b(SK[0-9a-f]{32})\b",
        ere: None,
        entropy: 3.0,
    },
    Rule {
        id: "jwt",
        title: "JSON Web Token",
        pattern: r"\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b",
        ere: None,
        entropy: 3.0,
    },
    Rule {
        id: "url-credentials",
        title: "Password in a URL",
        pattern: r"\b[a-z][a-z0-9+.-]{1,20}://[^\s:@/]{1,64}:([^\s@/]{3,128})@[A-Za-z0-9.-]+",
        ere: None,
        entropy: 2.5,
    },
    Rule {
        id: "generic-secret",
        title: "Hard-coded secret",
        pattern: r#"(?i)\b[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key)[\w.-]*['"]?\s*(?::=|=>|[:=])\s*['"`]([^'"`\s]{8,})['"`]"#,
        ere: None,
        entropy: 3.3,
    },
];

fn compiled() -> &'static Vec<Regex> {
    static C: OnceLock<Vec<Regex>> = OnceLock::new();
    C.get_or_init(|| {
        RULES
            .iter()
            .map(|r| Regex::new(r.pattern).expect("rule regex"))
            .collect()
    })
}

pub fn entropy(s: &str) -> f64 {
    let mut counts = [0u32; 256];
    let bytes = s.as_bytes();
    for b in bytes {
        counts[*b as usize] += 1;
    }
    let n = bytes.len() as f64;
    counts
        .iter()
        .filter(|c| **c > 0)
        .map(|c| {
            let p = *c as f64 / n;
            -p * p.log2()
        })
        .sum()
}

/// Obvious placeholders and references, not secrets.
fn is_placeholder(rule: &str, s: &str) -> bool {
    // Templates, non-ASCII text (translations), and env-var names ("HOMEBREW_TAP_TOKEN").
    if s.contains("${") || s.contains("{{") || !s.is_ascii() {
        return true;
    }
    if (rule == "generic-secret" || rule == "url-credentials")
        && s.len() > 3
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
    {
        return true;
    }
    let l = s.to_ascii_lowercase();
    l.contains("example")
        || l.contains("changeme")
        || l.contains("placeholder")
        || l.contains("your")
        || l.contains("xxxx")
        || l.contains("****")
        || l.contains("dummy")
        || l.contains("redacted")
        || s.starts_with("${")
        || s.starts_with("{{")
        || s.starts_with('<')
        || s.starts_with('%')
        || s.starts_with("process.env")
        || s.starts_with("os.environ")
        || s.starts_with("env(")
        || s.chars().all(|c| c == s.chars().next().unwrap_or(' '))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub rule: String,
    pub title: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    /// The secret with its middle hidden.
    pub masked: String,
    /// Stable id for ignoring: rule + file + secret hash.
    pub fingerprint: String,
    pub commit: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    pub line_text: String,
    /// In a test / fixture / example file (often fake secrets on purpose).
    pub in_test: bool,
}

pub fn is_test_path(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase();
    let name = l.rsplit('/').next().unwrap_or(&l);
    l.split('/').any(|seg| {
        matches!(
            seg,
            "test"
                | "tests"
                | "__tests__"
                | "spec"
                | "specs"
                | "fixtures"
                | "__fixtures__"
                | "testdata"
                | "examples"
                | "example"
                | "mocks"
                | "__mocks__"
        )
    }) || name.contains(".test.")
        || name.contains(".spec.")
        || name.ends_with("_test.go")
        || name.starts_with("test_")
        || name.ends_with("_test.py")
        || name.ends_with(".example")
        || name.contains(".sample")
}

pub fn mask(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 8 {
        return "*".repeat(chars.len());
    }
    let keep = (chars.len() / 6).clamp(2, 6);
    format!(
        "{}{}{}",
        chars[..keep].iter().collect::<String>(),
        "*".repeat(chars.len() - 2 * keep),
        chars[chars.len() - keep..].iter().collect::<String>()
    )
}

fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Scan one line; returns (rule index, column, secret).
pub fn scan_line(line: &str) -> Vec<(usize, usize, String)> {
    if line.contains("gear:allow-secret") || line.contains("gitleaks:allow") || line.len() > 4000 {
        return vec![];
    }
    let mut out: Vec<(usize, usize, String)> = Vec::new();
    for (i, re) in compiled().iter().enumerate() {
        for c in re.captures_iter(line) {
            let m = c.get(1).or_else(|| c.get(0)).unwrap();
            let secret = m.as_str().to_string();
            let rule = &RULES[i];
            if rule.entropy > 0.0 && entropy(&secret) < rule.entropy {
                continue;
            }
            if is_placeholder(rule.id, &secret) {
                continue;
            }
            // An earlier (more specific) rule already claimed this span.
            let overlaps = out.iter().any(|(_, col, s)| {
                let start = col - 1;
                m.start() < start + s.len() && start < m.end()
            });
            if overlaps {
                continue;
            }
            out.push((i, m.start() + 1, secret));
        }
    }
    out
}

fn finding(rule: usize, file: &str, line: u32, column: usize, secret: &str, text: &str) -> Finding {
    let r = &RULES[rule];
    let line_text: String = text
        .trim()
        .chars()
        .take(300)
        .collect::<String>()
        .replace(secret, &mask(secret));
    Finding {
        rule: r.id.into(),
        title: r.title.into(),
        file: file.into(),
        line,
        column: column as u32,
        masked: mask(secret),
        fingerprint: format!("{}:{}:{}", r.id, file, fnv(secret)),
        commit: None,
        author: None,
        date: None,
        line_text,
        in_test: is_test_path(file),
    }
}

const SKIP_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tgz", "woff", "woff2", "ttf",
    "otf", "mp4", "mp3", "wasm", "exe", "dll", "so", "dylib", "jar", "class", "lock", "svg", "map",
];
const SKIP_NAMES: &[&str] = &[
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "Cargo.lock",
    "go.sum",
    "poetry.lock",
];

/// Folders of installed third-party code: their sample keys and test fixtures are noise, not the user's secrets.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "site-packages",
    "__pycache__",
];

fn skip_path(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let in_skipped_dir = rel
        .rsplit_once('/')
        .is_some_and(|(dirs, _)| dirs.split('/').any(|part| SKIP_DIRS.contains(&part)));
    if SKIP_NAMES.contains(&name) || in_skipped_dir {
        return true;
    }
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    SKIP_EXT.contains(&ext.as_str()) || name.ends_with(".min.js")
}

/// Ignore file: fingerprints and path globs (`*` within a segment, `**` across).
pub struct Ignore {
    fingerprints: HashSet<String>,
    globs: Vec<Regex>,
}

impl Ignore {
    pub fn parse(text: &str) -> Ignore {
        let mut fingerprints = HashSet::new();
        let mut globs = Vec::new();
        for l in text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
        {
            if l.matches(':').count() >= 2
                && RULES.iter().any(|r| l.starts_with(&format!("{}:", r.id)))
            {
                fingerprints.insert(l.to_string());
            } else {
                let re = regex::escape(l)
                    .replace(r"\*\*/", "(?:.*/)?")
                    .replace(r"\*\*", ".*")
                    .replace(r"\*", "[^/]*")
                    .replace(r"\?", "[^/]");
                if let Ok(r) = Regex::new(&format!("^(?:{re})$|^(?:{re})/")) {
                    globs.push(r);
                }
            }
        }
        Ignore {
            fingerprints,
            globs,
        }
    }
    fn path(&self, rel: &str) -> bool {
        self.globs.iter().any(|g| g.is_match(rel))
    }
    fn finding(&self, f: &Finding) -> bool {
        self.fingerprints.contains(&f.fingerprint) || self.path(&f.file)
    }
}

pub const IGNORE_FILE: &str = ".gearsecretsignore";

fn load_ignore(root: &Path) -> Ignore {
    Ignore::parse(&std::fs::read_to_string(root.join(IGNORE_FILE)).unwrap_or_default())
}

pub fn scan_tree(root: &Path) -> Result<Vec<Finding>, String> {
    let ignore = load_ignore(root);
    let mut out = Vec::new();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .filter_entry(|e| !SKIP_DIRS.iter().any(|d| e.file_name() == *d))
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        if skip_path(&rel) || ignore.path(&rel) || rel == IGNORE_FILE {
            continue;
        }
        if entry
            .metadata()
            .map(|m| m.len() > 2 * 1024 * 1024)
            .unwrap_or(true)
        {
            continue;
        }
        let Ok(mut f) = std::fs::File::open(path) else {
            continue;
        };
        let mut buf = Vec::new();
        if f.read_to_end(&mut buf).is_err() || buf.iter().take(8000).any(|b| *b == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&buf);
        for (n, line) in text.lines().enumerate() {
            for (rule, col, secret) in scan_line(line) {
                let f = finding(rule, &rel, n as u32 + 1, col, &secret, line);
                if !ignore.finding(&f) {
                    out.push(f);
                }
            }
        }
    }
    out.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    Ok(out)
}

/// Every added line in git history (all refs), newest first; one finding per secret.
pub fn scan_history(root: &Path, max_commits: u32) -> Result<Vec<Finding>, String> {
    let ignore = load_ignore(root);
    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "log",
            "-p",
            "--all",
            "--no-color",
            "--no-ext-diff",
            "--unified=0",
            "--format=%x00%H%x1f%an%x1f%aI",
        ])
        .arg(format!("--max-count={max_commits}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("git: {e}"))?;
    let stdout = child.stdout.take().ok_or("no git output")?;
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let (mut commit, mut author, mut date) = (String::new(), String::new(), String::new());
    let mut file: Option<String> = None;
    let mut lineno = 0u32;
    for raw in BufReader::new(stdout).split(b'\n') {
        let raw = raw.map_err(|e| e.to_string())?;
        let l = String::from_utf8_lossy(&raw);
        if let Some(h) = l.strip_prefix('\0') {
            let mut p = h.split('\u{1f}');
            commit = p.next().unwrap_or("").to_string();
            author = p.next().unwrap_or("").to_string();
            date = p.next().unwrap_or("").to_string();
            file = None;
        } else if let Some(p) = l.strip_prefix("+++ ") {
            file = p
                .strip_prefix("b/")
                .map(str::to_string)
                .filter(|f| !skip_path(f) && !ignore.path(f));
        } else if l.starts_with("@@ ") {
            // @@ -a,b +c,d @@
            lineno = l
                .split(' ')
                .nth(2)
                .and_then(|s| s.trim_start_matches('+').split(',').next()?.parse().ok())
                .unwrap_or(1);
        } else if let (Some(f), Some(added)) = (&file, l.strip_prefix('+')) {
            for (rule, col, secret) in scan_line(added) {
                let mut fd = finding(rule, f, lineno, col, &secret, added);
                if ignore.finding(&fd) || !seen.insert(fd.fingerprint.clone()) {
                    continue;
                }
                fd.commit = Some(commit.clone());
                fd.author = Some(author.clone());
                fd.date = Some(date.clone());
                out.push(fd);
            }
            lineno += 1;
        }
    }
    let _ = child.wait();
    Ok(out)
}

/// A POSIX pre-commit hook that greps the staged diff with the rules' ERE forms.
pub fn hook_script() -> String {
    let pats: Vec<&str> = RULES.iter().filter_map(|r| r.ere).collect();
    format!(
        r#"#!/bin/sh
# Installed by Gear: blocks commits that add likely secrets.
# Bypass once with: git commit --no-verify. Allow a line with a "gear:allow-secret" comment.
patterns() {{
cat <<'GEAR_PATTERNS'
{}
GEAR_PATTERNS
}}
added=$(git diff --cached --no-color --unified=0 --diff-filter=ACM | grep '^+' | grep -v '^+++' | grep -v 'gear:allow-secret')
[ -z "$added" ] && exit 0
patterns | while IFS= read -r p; do
  [ -z "$p" ] && continue
  if printf '%s\n' "$added" | grep -Eq -- "$p"; then
    echo "gear: staged changes look like they contain a secret (pattern: $p)" >&2
    exit 1
  fi
done
"#,
        pats.join("\n")
    )
}

// ── commands ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn secrets_scan(
    root: String,
    history: bool,
    max_commits: Option<u32>,
) -> Result<Vec<Finding>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        let mut out = scan_tree(&root)?;
        if history {
            let current: HashSet<String> = out.iter().map(|f| f.fingerprint.clone()).collect();
            out.extend(
                scan_history(&root, max_commits.unwrap_or(5000))?
                    .into_iter()
                    .filter(|f| !current.contains(&f.fingerprint)),
            );
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn secrets_hook_script() -> String {
    hook_script()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Built at runtime so this file itself doesn't trip scanners.
    fn tok(prefix: &str, body: &str) -> String {
        format!("{prefix}{body}")
    }

    #[test]
    fn detects_provider_tokens() {
        let gh = tok("ghp_", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z5A");
        let aws = tok("AKIA", "Z7Q2M4N6P8R1T3V5");
        let stripe = tok("sk_live_", "51HqLwXa9Kd3Pz7Vt2Rm8Ys6");
        let google = tok("AIza", "SyD-9tSrke72PouQMnMX7Kd9Xz3ab_1mnQ0");
        let cases = vec![
            (format!("token = \"{gh}\""), "github-token"),
            (format!("AWS_ACCESS_KEY_ID={aws}"), "aws-access-key"),
            (format!("stripe.api_key = '{stripe}'"), "stripe-key"),
            (
                format!("<script src=\"https://maps.googleapis.com/?key={google}\">"),
                "google-api-key",
            ),
            (
                "-----BEGIN OPENSSH PRIVATE KEY-----".to_string(),
                "private-key",
            ),
            (
                "DATABASE_URL=postgres://app:Zq8#mP2v!xL@db.internal:5432/app".to_string(),
                "url-credentials",
            ),
            (
                "const password = \"Tr0ub4dor&3-horse-Staple\";".to_string(),
                "generic-secret",
            ),
        ];
        for (line, rule) in cases {
            let hits = scan_line(&line);
            assert_eq!(hits.len(), 1, "{line} → {hits:?}");
            assert_eq!(RULES[hits[0].0].id, rule, "{line}");
        }
    }

    #[test]
    fn ignores_placeholders_and_low_entropy() {
        for line in [
            "password = \"changeme123\"",
            "api_key: \"${API_KEY}\"",
            "token = \"xxxxxxxxxxxxxxxx\"",
            "secret = \"aaaaaaaaaaaaaaaa\"",
            "password = process.env.DB_PASSWORD",
            "const token = getToken();",
            "postgres://user:${PASSWORD}@localhost/db",
            "let k = \"AKIAIOSFODNN7EXAMPLE\"",
            "password = \"Tr0ub4dor&3-horse-Staple\" // gear:allow-secret",
            "3. Add as repo secret: `HOMEBREW_TAP_TOKEN`",
            "\"apiKey\": \"API-Schlüssel\",",
            "return res.end(JSON.stringify({ token: `tok-${JSON.parse(body).user}` }));",
        ] {
            assert_eq!(scan_line(line), vec![], "{line}");
        }
        assert!(entropy("aaaa") < 0.1);
        assert!(entropy("aB3dE5fG7hJ9kL1m") > 3.5);
        assert_eq!(mask("abcdefghijklmnop"), "ab************op");
        assert!(
            is_test_path("src/modules/ai/lib/redact.test.ts")
                && is_test_path("pkg/auth/token_test.go")
                && is_test_path("tests/conftest.py")
                && is_test_path(".env.example")
        );
        assert!(!is_test_path("src/config.ts") && !is_test_path("latest.json"));
    }

    #[test]
    fn tree_history_ignore_and_hook() {
        let root = std::env::temp_dir().join(format!("gear-secrets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        let git = |args: &[&str]| {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(&root)
                    .args(args)
                    .env("GIT_AUTHOR_NAME", "t")
                    .env("GIT_AUTHOR_EMAIL", "t@t")
                    .env("GIT_COMMITTER_NAME", "t")
                    .env("GIT_COMMITTER_EMAIL", "t@t")
                    .output()
                    .unwrap()
                    .status
                    .success(),
                "{args:?}"
            )
        };
        git(&["init", "-q"]);
        let gh = tok("ghp_", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z5A");
        let npm = tok("npm_", "Q8wE4rT6yU2iO9pA1sD3fG5hJ7kL0zX2cV4b");
        // Committed, then removed: only history has it.
        std::fs::write(
            root.join("src/config.js"),
            format!("module.exports = {{\n  token: \"{gh}\",\n}};\n"),
        )
        .unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "add config"]);
        std::fs::write(
            root.join("src/config.js"),
            "module.exports = { token: process.env.TOKEN };\n",
        )
        .unwrap();
        git(&["commit", "-qam", "use env"]);
        // In the tree now: one tracked, one ignored by .gitignore, one in a lockfile.
        std::fs::write(
            root.join(".npmrc"),
            format!("//registry.npmjs.org/:_authToken={npm}\n"),
        )
        .unwrap();
        std::fs::write(root.join(".gitignore"), "secret.env\n").unwrap();
        std::fs::write(root.join("secret.env"), format!("TOKEN={gh}\n")).unwrap();
        std::fs::write(root.join("package-lock.json"), format!("\"{npm}\"\n")).unwrap();

        let tree = scan_tree(&root).unwrap();
        assert_eq!(
            tree.iter()
                .map(|f| (f.file.as_str(), f.rule.as_str(), f.line))
                .collect::<Vec<_>>(),
            vec![(".npmrc", "npm-token", 1)]
        );
        assert!(!tree[0].line_text.contains(&npm));

        let hist = scan_history(&root, 100).unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(
            (hist[0].file.as_str(), hist[0].line, hist[0].rule.as_str()),
            ("src/config.js", 2, "github-token")
        );
        assert!(hist[0].commit.as_ref().unwrap().len() == 40);

        // Ignore by fingerprint and by glob.
        std::fs::write(
            root.join(IGNORE_FILE),
            format!("# reviewed\n{}\nsrc/**\n", tree[0].fingerprint),
        )
        .unwrap();
        assert!(scan_tree(&root).unwrap().is_empty());
        assert!(scan_history(&root, 100).unwrap().is_empty());

        // The hook blocks a staged secret and lets a clean change through.
        let hook = root.join(".git/hooks/pre-commit");
        std::fs::write(&hook, hook_script()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::write(root.join("src/a.txt"), format!("key {gh}\n")).unwrap();
        git(&["add", "src/a.txt"]);
        let blocked = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["commit", "-qm", "oops"])
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .unwrap();
        assert!(!blocked.status.success(), "hook should block");
        assert!(
            String::from_utf8_lossy(&blocked.stderr).contains("look like they contain a secret")
        );
        std::fs::write(root.join("src/a.txt"), "nothing to see\n").unwrap();
        git(&["add", "src/a.txt"]);
        git(&["commit", "-qm", "fine"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn hook_ends_with_the_loop() {
        // The app chains an existing hook by rewriting this ending (security/secrets.ts).
        assert!(hook_script().ends_with("\ndone\n"));
        if let Ok(out) = std::env::var("GEAR_HOOK_OUT") {
            std::fs::write(out, hook_script()).unwrap();
        }
    }
}
