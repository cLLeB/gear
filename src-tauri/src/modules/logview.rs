//! Large log files: a line-offset index (built in 1 MB chunks, extended as the
//! file grows, rebuilt when it's rotated / truncated), filtered views
//! (include / exclude text or regex, levels, time range), search, and a time
//! histogram per level. The webview only ever asks for the lines it shows.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

const CHUNK: usize = 1 << 20;
const MAX_LINE_CHARS: usize = 16_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
    Other,
}

impl Level {
    fn idx(self) -> usize {
        self as usize
    }
    fn parse(s: &str) -> Option<Level> {
        Some(match s {
            "error" => Level::Error,
            "warn" => Level::Warn,
            "info" => Level::Info,
            "debug" => Level::Debug,
            "other" => Level::Other,
            _ => return None,
        })
    }
}

/// Guess a line's level from the words near its start.
pub fn detect_level(line: &[u8]) -> Level {
    let head = &line[..line.len().min(240)];
    let mut best = Level::Other;
    for word in head.split(|b| !b.is_ascii_alphabetic()) {
        if word.len() < 3 || word.len() > 8 {
            continue;
        }
        let mut w = [0u8; 8];
        for (i, b) in word.iter().enumerate() {
            w[i] = b.to_ascii_lowercase();
        }
        let lvl = match &w[..word.len()] {
            b"error" | b"err" | b"fatal" | b"critical" | b"crit" | b"panic" | b"severe"
            | b"emerg" | b"alert" => Level::Error,
            b"warn" | b"warning" => Level::Warn,
            b"info" | b"notice" => Level::Info,
            b"debug" | b"trace" | b"verbose" => Level::Debug,
            _ => continue,
        };
        // The first level word wins (it's usually the level column).
        if best == Level::Other {
            best = lvl;
            break;
        }
    }
    best
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn num(b: &[u8]) -> Option<u32> {
    if b.is_empty() || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(b).ok()?.parse().ok()
}

const MONTHS: [&[u8]; 12] = [
    b"Jan", b"Feb", b"Mar", b"Apr", b"May", b"Jun", b"Jul", b"Aug", b"Sep", b"Oct", b"Nov", b"Dec",
];

/// `2026-10-11T08:01:02.345Z`, `2026-10-11 08:01:02,345 +0200` → epoch ms.
fn parse_iso(s: &[u8]) -> Option<i64> {
    if s.len() < 19
        || s[4] != b'-'
        || s[7] != b'-'
        || !(s[10] == b'T' || s[10] == b' ')
        || s[13] != b':'
        || s[16] != b':'
    {
        return None;
    }
    let (y, mo, d) = (num(&s[0..4])?, num(&s[5..7])?, num(&s[8..10])?);
    let (h, mi, se) = (num(&s[11..13])?, num(&s[14..16])?, num(&s[17..19])?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    let mut i = 19;
    let mut ms = 0i64;
    if i < s.len() && (s[i] == b'.' || s[i] == b',') {
        let start = i + 1;
        i = start;
        while i < s.len() && s[i].is_ascii_digit() {
            i += 1;
        }
        let frac = &s[start..i.min(start + 3)];
        if let Some(f) = num(frac) {
            ms = f as i64 * 10i64.pow(3 - frac.len() as u32);
        }
    }
    // Optional zone: Z, +HH:MM, +HHMM (after an optional space).
    let mut off_min = 0i64;
    let mut j = i;
    if j < s.len() && s[j] == b' ' {
        j += 1;
    }
    if j < s.len() && s[j] == b'Z' {
    } else if j + 5 <= s.len() && (s[j] == b'+' || s[j] == b'-') {
        let sign = if s[j] == b'-' { -1 } else { 1 };
        let hh = num(&s[j + 1..j + 3]);
        let mm = if s.get(j + 3) == Some(&b':') {
            s.get(j + 4..j + 6).and_then(num)
        } else {
            s.get(j + 3..j + 5).and_then(num)
        };
        if let (Some(hh), Some(mm)) = (hh, mm) {
            off_min = sign * (hh as i64 * 60 + mm as i64);
        }
    }
    let secs =
        days_from_civil(y as i64, mo, d) * 86_400 + h as i64 * 3600 + mi as i64 * 60 + se as i64
            - off_min * 60;
    Some(secs * 1000 + ms)
}

/// `10/Oct/2026:13:55:36 +0000` (Apache / nginx).
fn parse_clf(s: &[u8]) -> Option<i64> {
    if s.len() < 20 || s[2] != b'/' || s[6] != b'/' || s[11] != b':' {
        return None;
    }
    let d = num(&s[0..2])?;
    let mo = MONTHS.iter().position(|m| *m == &s[3..6])? as u32 + 1;
    let y = num(&s[7..11])?;
    let (h, mi, se) = (num(&s[12..14])?, num(&s[15..17])?, num(&s[18..20])?);
    let mut off = 0i64;
    if s.len() >= 26 && s[20] == b' ' && (s[21] == b'+' || s[21] == b'-') {
        let v = num(&s[22..24])? as i64 * 60 + num(&s[24..26])? as i64;
        off = if s[21] == b'-' { -v } else { v };
    }
    Some(
        (days_from_civil(y as i64, mo, d) * 86_400 + h as i64 * 3600 + mi as i64 * 60 + se as i64
            - off * 60)
            * 1000,
    )
}

/// `Oct 11 08:01:02` (syslog; the year isn't in the line).
fn parse_syslog(s: &[u8], year: i32) -> Option<i64> {
    if s.len() < 15 || s[3] != b' ' || s[9] != b':' || s[12] != b':' {
        return None;
    }
    let mo = MONTHS.iter().position(|m| *m == &s[0..3])? as u32 + 1;
    let d = num(std::str::from_utf8(&s[4..6]).ok()?.trim().as_bytes())?;
    let (h, mi, se) = (num(&s[7..9])?, num(&s[10..12])?, num(&s[13..15])?);
    Some(
        (days_from_civil(year as i64, mo, d) * 86_400
            + h as i64 * 3600
            + mi as i64 * 60
            + se as i64)
            * 1000,
    )
}

/// A line's timestamp (epoch ms): at the start (optionally after `[`), after a
/// JSON time key, or the first ISO-looking date in the first 64 bytes.
pub fn parse_timestamp(line: &[u8], year: i32) -> Option<i64> {
    let mut s = line;
    while let Some((&b, rest)) = s.split_first() {
        if b == b'[' || b == b' ' || b == b'"' {
            s = rest;
        } else {
            break;
        }
    }
    if let Some(t) = parse_iso(s)
        .or_else(|| parse_clf(s))
        .or_else(|| parse_syslog(s, year))
    {
        return Some(t);
    }
    if line.first() == Some(&b'{') {
        for key in [
            &b"\"time\":"[..],
            b"\"timestamp\":",
            b"\"ts\":",
            b"\"@timestamp\":",
            b"\"datetime\":",
        ] {
            if let Some(p) = memchr::memmem::find(line, key) {
                let mut v = &line[p + key.len()..];
                while let Some((&b, rest)) = v.split_first() {
                    if b == b' ' || b == b'"' {
                        v = rest;
                    } else {
                        break;
                    }
                }
                if let Some(t) = parse_iso(v) {
                    return Some(t);
                }
                // Epoch seconds or milliseconds.
                let digits: Vec<u8> = v
                    .iter()
                    .take_while(|b| b.is_ascii_digit() || **b == b'.')
                    .copied()
                    .collect();
                if let Ok(f) = std::str::from_utf8(&digits).unwrap_or("").parse::<f64>() {
                    return Some(if f > 1e12 {
                        f as i64
                    } else {
                        (f * 1000.0) as i64
                    });
                }
            }
        }
    }
    // Somewhere near the start: "app[123]: 2026-10-11 08:01:02 …"
    let head = &line[..line.len().min(64)];
    // Access logs: `127.0.0.1 - - [11/Oct/2026:08:01:02 +0000] …`
    if let Some(b) = memchr::memchr(b'[', head) {
        if let Some(t) = parse_clf(&line[b + 1..]) {
            return Some(t);
        }
    }
    for i in 1..head.len().saturating_sub(18) {
        if head[i].is_ascii_digit()
            && head.get(i + 4) == Some(&b'-')
            && (i == 0 || !head[i - 1].is_ascii_digit())
        {
            if let Some(t) = parse_iso(&line[i..]) {
                return Some(t);
            }
        }
    }
    None
}

// ── index ───────────────────────────────────────────────────────────────

pub struct LogFile {
    path: PathBuf,
    /// Byte offset where each line starts.
    starts: Vec<u64>,
    /// Bytes indexed so far (the tail after the last newline is a partial line).
    indexed: u64,
    /// Filtered view: line numbers, or None for every line.
    view: Option<Vec<u32>>,
    filter: Option<Arc<Filter>>,
    year: i32,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct LogInfo {
    pub id: u32,
    pub lines: u32,
    pub size: u64,
    pub visible: u32,
    pub rotated: bool,
}

impl LogFile {
    pub fn open(path: PathBuf, year: i32) -> Result<Self, String> {
        let mut f = LogFile {
            path,
            starts: vec![0],
            indexed: 0,
            view: None,
            filter: None,
            year,
        };
        f.extend()?;
        Ok(f)
    }

    fn size(&self) -> Result<u64, String> {
        Ok(std::fs::metadata(&self.path)
            .map_err(|e| e.to_string())?
            .len())
    }

    /// Index bytes appended since the last call; rebuild if the file shrank. Returns (new lines, rotated).
    pub fn extend(&mut self) -> Result<(u32, bool), String> {
        let size = self.size()?;
        let mut rotated = false;
        if size < self.indexed {
            self.starts = vec![0];
            self.indexed = 0;
            rotated = true;
        }
        if size == self.indexed {
            return Ok((0, rotated));
        }
        let before = self.complete_lines();
        let mut file = File::open(&self.path).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(self.indexed))
            .map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; CHUNK];
        let mut pos = self.indexed;
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            for i in memchr::memchr_iter(b'\n', &buf[..n]) {
                self.starts.push(pos + i as u64 + 1);
            }
            pos += n as u64;
        }
        self.indexed = pos;
        let after = self.complete_lines();
        if rotated {
            if let Some(f) = self.filter.clone() {
                self.view = Some(self.scan(&f, 0, after)?);
            }
        } else if let (Some(f), true) = (self.filter.clone(), after > before) {
            let more = self.scan(&f, before, after)?;
            if let Some(v) = self.view.as_mut() {
                v.extend(more);
            }
        }
        Ok((after.saturating_sub(before), rotated))
    }

    /// Lines including a trailing partial line.
    pub fn line_count(&self) -> u32 {
        let full = self.starts.len() as u32 - 1;
        if self.indexed > *self.starts.last().unwrap() {
            full + 1
        } else {
            full
        }
    }

    /// Lines that end in a newline (a growing last line isn't filtered until complete).
    fn complete_lines(&self) -> u32 {
        self.starts.len() as u32 - 1
    }

    fn visible(&self) -> u32 {
        self.view
            .as_ref()
            .map(|v| v.len() as u32)
            .unwrap_or_else(|| self.line_count())
    }

    fn info(&self, id: u32, rotated: bool) -> LogInfo {
        LogInfo {
            id,
            lines: self.line_count(),
            size: self.indexed,
            visible: self.visible(),
            rotated,
        }
    }

    /// Read raw lines [from, to) in one sequential pass.
    fn each_line(
        &self,
        from: u32,
        to: u32,
        mut f: impl FnMut(u32, &[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        if from >= to {
            return Ok(());
        }
        let start = self.starts[from as usize];
        let file = File::open(&self.path).map_err(|e| e.to_string())?;
        let mut r = BufReader::with_capacity(CHUNK, file);
        r.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(256);
        for n in from..to {
            buf.clear();
            let read = r.read_until(b'\n', &mut buf).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            while matches!(buf.last(), Some(b'\n' | b'\r')) {
                buf.pop();
            }
            f(n, &buf)?;
        }
        Ok(())
    }

    fn scan(&self, f: &Filter, from: u32, to: u32) -> Result<Vec<u32>, String> {
        let mut out = Vec::new();
        self.each_line(from, to, |n, line| {
            if f.matches(line, self.year) {
                out.push(n);
            }
            Ok(())
        })?;
        Ok(out)
    }

    pub fn set_filter(&mut self, filter: Option<Filter>) -> Result<(), String> {
        match filter {
            None => {
                self.filter = None;
                self.view = None;
            }
            Some(f) => {
                let f = Arc::new(f);
                let total = self.complete_lines();
                let mut view = self.scan(&f, 0, total)?;
                // A partial last line is shown if it matches so far.
                if self.line_count() > total {
                    view.extend(self.scan(&f, total, total + 1)?);
                }
                self.view = Some(view);
                self.filter = Some(f);
            }
        }
        Ok(())
    }

    /// Visible rows [start, start+count): (line number, text, level, timestamp).
    pub fn rows(&self, start: u32, count: u32) -> Result<Vec<Row>, String> {
        let nums: Vec<u32> = match &self.view {
            Some(v) => v
                .iter()
                .skip(start as usize)
                .take(count as usize)
                .copied()
                .collect(),
            None => (start..(start + count).min(self.line_count())).collect(),
        };
        let mut out = Vec::with_capacity(nums.len());
        // Contiguous runs read sequentially; filtered views jump between them.
        let mut i = 0;
        while i < nums.len() {
            let mut j = i + 1;
            while j < nums.len() && nums[j] == nums[j - 1] + 1 {
                j += 1;
            }
            self.each_line(nums[i], nums[j - 1] + 1, |n, line| {
                let mut text = String::from_utf8_lossy(line).into_owned();
                if text.len() > MAX_LINE_CHARS {
                    let mut cut = MAX_LINE_CHARS;
                    while !text.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    text.truncate(cut);
                    text.push('…');
                }
                out.push(Row {
                    line: n,
                    level: detect_level(line),
                    time: parse_timestamp(line, self.year),
                    text,
                });
                Ok(())
            })?;
            i = j;
        }
        Ok(out)
    }

    /// Visible-row indexes whose text matches (for next / previous).
    pub fn search(&self, re: &Regex, max: usize) -> Result<Vec<u32>, String> {
        let mut hits = Vec::new();
        match &self.view {
            None => self.each_line(0, self.line_count(), |n, line| {
                if hits.len() < max && re.is_match(&String::from_utf8_lossy(line)) {
                    hits.push(n);
                }
                Ok(())
            })?,
            Some(v) => {
                let set: std::collections::HashSet<u32> = v.iter().copied().collect();
                let mut idx = HashMap::new();
                for (i, n) in v.iter().enumerate() {
                    idx.insert(*n, i as u32);
                }
                if let (Some(&first), Some(&last)) = (v.first(), v.last()) {
                    self.each_line(first, last + 1, |n, line| {
                        if hits.len() < max
                            && set.contains(&n)
                            && re.is_match(&String::from_utf8_lossy(line))
                        {
                            hits.push(idx[&n]);
                        }
                        Ok(())
                    })?;
                }
            }
        }
        Ok(hits)
    }

    /// Counts per time bucket and level over the visible lines.
    pub fn histogram(&self, buckets: usize) -> Result<Histogram, String> {
        let mut points: Vec<(i64, Level)> = Vec::new();
        let mut unparsed = 0u32;
        let mut last_t: Option<i64> = None;
        let want: Option<std::collections::HashSet<u32>> =
            self.view.as_ref().map(|v| v.iter().copied().collect());
        self.each_line(0, self.line_count(), |n, line| {
            if want.as_ref().is_some_and(|w| !w.contains(&n)) {
                return Ok(());
            }
            // Continuation lines (stack traces) inherit the previous timestamp.
            match parse_timestamp(line, self.year).or(last_t) {
                Some(t) => {
                    last_t = Some(t);
                    points.push((t, detect_level(line)));
                }
                None => unparsed += 1,
            }
            Ok(())
        })?;
        let buckets = buckets.clamp(1, 2000);
        let (min, max) = points
            .iter()
            .fold((i64::MAX, i64::MIN), |(lo, hi), (t, _)| {
                (lo.min(*t), hi.max(*t))
            });
        if points.is_empty() {
            return Ok(Histogram {
                start: 0,
                bucket_ms: 0,
                counts: vec![],
                unparsed,
            });
        }
        let span = (max - min).max(1);
        let bucket_ms = (span / buckets as i64 + 1).max(1);
        let mut counts = vec![[0u32; 5]; ((span / bucket_ms) + 1) as usize];
        for (t, l) in points {
            counts[((t - min) / bucket_ms) as usize][l.idx()] += 1;
        }
        Ok(Histogram {
            start: min,
            bucket_ms,
            counts,
            unparsed,
        })
    }

    /// Visible-row index of the first line at or after `t` (for jumping from the histogram).
    pub fn row_at_time(&self, t: i64) -> Result<Option<u32>, String> {
        let mut found = None;
        let mut row = 0u32;
        let want: Option<std::collections::HashSet<u32>> =
            self.view.as_ref().map(|v| v.iter().copied().collect());
        self.each_line(0, self.line_count(), |n, line| {
            if found.is_some() || want.as_ref().is_some_and(|w| !w.contains(&n)) {
                return Ok(());
            }
            if parse_timestamp(line, self.year).is_some_and(|x| x >= t) {
                found = Some(row);
            }
            row += 1;
            Ok(())
        })?;
        Ok(found)
    }
}

#[derive(Serialize)]
pub struct Row {
    pub line: u32,
    pub level: Level,
    pub time: Option<i64>,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Histogram {
    pub start: i64,
    pub bucket_ms: i64,
    /// [error, warn, info, debug, other] per bucket
    pub counts: Vec<[u32; 5]>,
    pub unparsed: u32,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilterSpec {
    pub include: Option<String>,
    pub exclude: Option<String>,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    pub levels: Option<Vec<String>>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

pub struct Filter {
    include: Option<Regex>,
    exclude: Option<Regex>,
    levels: Option<[bool; 5]>,
    from: Option<i64>,
    to: Option<i64>,
}

fn build(p: &str, regex: bool, case: bool) -> Result<Regex, String> {
    let src = if regex {
        p.to_string()
    } else {
        regex::escape(p)
    };
    RegexBuilder::new(&src)
        .case_insensitive(!case)
        .size_limit(1 << 24)
        .build()
        .map_err(|e| e.to_string())
}

impl Filter {
    pub fn from_spec(s: &FilterSpec) -> Result<Option<Filter>, String> {
        let some = |o: &Option<String>| {
            o.as_deref()
                .filter(|x| !x.is_empty())
                .map(|x| build(x, s.regex, s.case_sensitive))
                .transpose()
        };
        let levels = s.levels.as_ref().map(|ls| {
            let mut on = [false; 5];
            for l in ls {
                if let Some(l) = Level::parse(l) {
                    on[l.idx()] = true;
                }
            }
            on
        });
        let f = Filter {
            include: some(&s.include)?,
            exclude: some(&s.exclude)?,
            levels,
            from: s.from,
            to: s.to,
        };
        Ok(
            if f.include.is_none()
                && f.exclude.is_none()
                && f.levels.is_none()
                && f.from.is_none()
                && f.to.is_none()
            {
                None
            } else {
                Some(f)
            },
        )
    }

    fn matches(&self, line: &[u8], year: i32) -> bool {
        if let Some(on) = &self.levels {
            if !on[detect_level(line).idx()] {
                return false;
            }
        }
        if self.from.is_some() || self.to.is_some() {
            match parse_timestamp(line, year) {
                Some(t) => {
                    if self.from.is_some_and(|f| t < f) || self.to.is_some_and(|x| t > x) {
                        return false;
                    }
                }
                None => return false,
            }
        }
        if self.include.is_none() && self.exclude.is_none() {
            return true;
        }
        let text = String::from_utf8_lossy(line);
        self.include.as_ref().is_none_or(|re| re.is_match(&text))
            && !self.exclude.as_ref().is_some_and(|re| re.is_match(&text))
    }
}

// ── commands ─────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct LogState {
    next: AtomicU32,
    files: Mutex<HashMap<u32, Arc<Mutex<LogFile>>>>,
}

fn get(state: &LogState, id: u32) -> Result<Arc<Mutex<LogFile>>, String> {
    state
        .files
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| "log file is closed".into())
}

fn current_year() -> i32 {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    // Inverse of days_from_civil, year only.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }) as i32
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn log_open(state: tauri::State<'_, LogState>, path: String) -> Result<LogInfo, String> {
    let file = blocking(move || LogFile::open(PathBuf::from(path), current_year())).await?;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    let info = file.info(id, false);
    state
        .files
        .lock()
        .unwrap()
        .insert(id, Arc::new(Mutex::new(file)));
    Ok(info)
}

#[tauri::command]
pub async fn log_refresh(state: tauri::State<'_, LogState>, id: u32) -> Result<LogInfo, String> {
    let f = get(&state, id)?;
    blocking(move || {
        let mut f = f.lock().unwrap();
        let (_, rotated) = f.extend()?;
        Ok(f.info(id, rotated))
    })
    .await
}

#[tauri::command]
pub async fn log_rows(
    state: tauri::State<'_, LogState>,
    id: u32,
    start: u32,
    count: u32,
) -> Result<Vec<Row>, String> {
    let f = get(&state, id)?;
    blocking(move || f.lock().unwrap().rows(start, count.min(5000))).await
}

#[tauri::command]
pub async fn log_filter(
    state: tauri::State<'_, LogState>,
    id: u32,
    spec: FilterSpec,
) -> Result<LogInfo, String> {
    let f = get(&state, id)?;
    blocking(move || {
        let filter = Filter::from_spec(&spec)?;
        let mut f = f.lock().unwrap();
        f.set_filter(filter)?;
        Ok(f.info(id, false))
    })
    .await
}

#[tauri::command]
pub async fn log_search(
    state: tauri::State<'_, LogState>,
    id: u32,
    pattern: String,
    regex: bool,
    case_sensitive: bool,
) -> Result<Vec<u32>, String> {
    let f = get(&state, id)?;
    blocking(move || {
        let re = build(&pattern, regex, case_sensitive)?;
        f.lock().unwrap().search(&re, 100_000)
    })
    .await
}

#[tauri::command]
pub async fn log_histogram(
    state: tauri::State<'_, LogState>,
    id: u32,
    buckets: usize,
) -> Result<Histogram, String> {
    let f = get(&state, id)?;
    blocking(move || f.lock().unwrap().histogram(buckets)).await
}

#[tauri::command]
pub async fn log_row_at_time(
    state: tauri::State<'_, LogState>,
    id: u32,
    time: i64,
) -> Result<Option<u32>, String> {
    let f = get(&state, id)?;
    blocking(move || f.lock().unwrap().row_at_time(time)).await
}

#[tauri::command]
pub fn log_close(state: tauri::State<'_, LogState>, id: u32) {
    state.files.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str, content: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("gear-logview-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("app.log");
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn timestamps_and_levels() {
        assert_eq!(
            parse_timestamp(b"2026-10-11T08:01:02.345Z INFO up", 2026),
            Some(1_791_705_662_345)
        );
        assert_eq!(
            parse_timestamp(b"[2026-10-11 10:01:02,345 +0200] ERROR x", 2026),
            Some(1_791_705_662_345)
        );
        assert_eq!(
            parse_timestamp(
                b"127.0.0.1 - - [11/Oct/2026:08:01:02 +0000] \"GET / HTTP/1.1\" 200",
                2026
            ),
            Some(1_791_705_662_000)
        );
        assert_eq!(
            parse_timestamp(b"Oct 11 08:01:02 host sshd[1]: Accepted", 2026),
            Some(1_791_705_662_000)
        );
        assert_eq!(
            parse_timestamp(br#"{"level":"warn","ts":1791705662.5,"msg":"slow"}"#, 2026),
            Some(1_791_705_662_500)
        );
        assert_eq!(
            parse_timestamp(br#"{"time":"2026-10-11T08:01:02Z","msg":"x"}"#, 2026),
            Some(1_791_705_662_000)
        );
        assert_eq!(
            parse_timestamp(b"web.1 | 2026-10-11 08:01:02 started", 2026),
            Some(1_791_705_662_000)
        );
        assert_eq!(parse_timestamp(b"    at foo (bar.js:1:2)", 2026), None);
        assert_eq!(
            detect_level(b"2026-10-11 08:01:02 ERROR boom"),
            Level::Error
        );
        assert_eq!(
            detect_level(br#"{"level":"warn","msg":"error rate high"}"#),
            Level::Warn
        );
        assert_eq!(detect_level(b"[DEBUG] cache miss"), Level::Debug);
        assert_eq!(detect_level(b"plain text"), Level::Other);
        assert!((2024..2100).contains(&current_year()));
    }

    #[test]
    fn index_filter_follow_and_rotate() {
        let p = tmp("follow", "2026-10-11T08:00:00Z INFO start\n2026-10-11T08:00:01Z ERROR db down\n    at db.connect\n2026-10-11T08:00:05Z WARN retry\n2026-10-11T08:01:00Z INFO ok\npartial");
        let mut f = LogFile::open(p.clone(), 2026).unwrap();
        assert_eq!(f.line_count(), 6);
        let rows = f.rows(1, 2).unwrap();
        assert_eq!(
            (rows[0].line, rows[0].level, rows[0].text.as_str()),
            (1, Level::Error, "2026-10-11T08:00:01Z ERROR db down")
        );
        assert_eq!(rows[1].time, None);
        assert_eq!(f.rows(5, 10).unwrap()[0].text, "partial");

        f.set_filter(
            Filter::from_spec(&FilterSpec {
                levels: Some(vec!["error".into(), "warn".into()]),
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(f.visible(), 2);
        assert_eq!(
            f.rows(0, 10)
                .unwrap()
                .iter()
                .map(|r| r.line)
                .collect::<Vec<_>>(),
            vec![1, 3]
        );
        let re = build("retry", false, false).unwrap();
        assert_eq!(f.search(&re, 10).unwrap(), vec![1]);

        // Appending extends the index and the filtered view.
        let mut fh = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        fh.write_all(b" line\n2026-10-11T08:02:00Z ERROR again\n")
            .unwrap();
        let (added, rotated) = f.extend().unwrap();
        assert!(!rotated);
        assert_eq!(added, 2);
        assert_eq!(f.line_count(), 7);
        assert_eq!(
            f.rows(0, 10)
                .unwrap()
                .iter()
                .map(|r| r.line)
                .collect::<Vec<_>>(),
            vec![1, 3, 6]
        );
        assert_eq!(
            f.rows(0, 10).unwrap()[2].text,
            "2026-10-11T08:02:00Z ERROR again"
        );

        // Rotation: the file is replaced by a smaller one.
        std::fs::write(&p, "2026-10-11T09:00:00Z ERROR after rotate\n").unwrap();
        let (_, rotated) = f.extend().unwrap();
        assert!(rotated);
        assert_eq!(f.line_count(), 1);
        assert_eq!(f.visible(), 1);

        // Text filters: include + exclude, regex, case.
        std::fs::write(&p, "a GET /api/users 200\nb GET /api/health 200\nc POST /api/users 500\nd get /API/users 200\n").unwrap();
        f.extend().unwrap();
        f.set_filter(
            Filter::from_spec(&FilterSpec {
                include: Some("/api/users".into()),
                exclude: Some(" 500".into()),
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            f.rows(0, 10)
                .unwrap()
                .iter()
                .map(|r| r.line)
                .collect::<Vec<_>>(),
            vec![0, 3]
        );
        f.set_filter(
            Filter::from_spec(&FilterSpec {
                include: Some(r"^(a|c) \w+".into()),
                regex: true,
                case_sensitive: true,
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(f.visible(), 2);
        assert!(Filter::from_spec(&FilterSpec {
            include: Some("(".into()),
            regex: true,
            ..Default::default()
        })
        .is_err());
        f.set_filter(None).unwrap();
        assert_eq!(f.visible(), 4);
    }

    #[test]
    fn histogram_and_time_range() {
        let p = tmp("hist", "2026-10-11T08:00:00Z INFO a\n2026-10-11T08:00:30Z ERROR b\n  trace line\n2026-10-11T08:01:00Z WARN c\nno time at all\n2026-10-11T08:02:00Z INFO d\n");
        let mut f = LogFile::open(p, 2026).unwrap();
        let h = f.histogram(4).unwrap();
        let total: u32 = h.counts.iter().map(|c| c.iter().sum::<u32>()).sum();
        // The trace and the untimed line inherit the previous timestamp.
        assert_eq!(total, 6);
        assert_eq!(h.unparsed, 0);
        assert_eq!(h.start, parse_iso(b"2026-10-11T08:00:00Z").unwrap());
        assert_eq!(
            h.counts.iter().map(|c| c[Level::Error.idx()]).sum::<u32>(),
            1
        );
        let t = parse_iso(b"2026-10-11T08:01:00Z").unwrap();
        assert_eq!(f.row_at_time(t).unwrap(), Some(3));
        f.set_filter(
            Filter::from_spec(&FilterSpec {
                from: Some(t),
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            f.rows(0, 10)
                .unwrap()
                .iter()
                .map(|r| r.line)
                .collect::<Vec<_>>(),
            vec![3, 5]
        );
    }

    #[test]
    fn big_file_is_quick() {
        let mut s = String::with_capacity(60 * 200_000);
        for i in 0..200_000 {
            s.push_str(&format!(
                "2026-10-11T08:{:02}:{:02}Z {} request {} done\n",
                (i / 60) % 60,
                i % 60,
                if i % 97 == 0 { "ERROR" } else { "INFO" },
                i
            ));
        }
        let p = tmp("big", &s);
        let t = std::time::Instant::now();
        let mut f = LogFile::open(p, 2026).unwrap();
        assert_eq!(f.line_count(), 200_000);
        f.set_filter(
            Filter::from_spec(&FilterSpec {
                levels: Some(vec!["error".into()]),
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(f.visible(), 2062);
        assert_eq!(f.rows(2061, 5).unwrap()[0].line, 199_917);
        assert!(t.elapsed().as_secs() < 10, "took {:?}", t.elapsed());
    }
}
