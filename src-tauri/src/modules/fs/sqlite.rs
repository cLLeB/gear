//! Read-only SQLite browsing for the database viewer: run one query against a
//! database file opened with `SQLITE_OPEN_READ_ONLY`, returning stringified
//! cells capped to `max_rows` so a huge table can't flood the IPC bridge.

use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const ROW_CAP: usize = 5000;

#[derive(Serialize, Debug)]
pub struct SqliteResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    /// True when more rows were available than returned.
    pub truncated: bool,
}

fn cell(v: ValueRef<'_>) -> Option<String> {
    match v {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Text(t) => Some(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Some(format!("<blob {} bytes>", b.len())),
    }
}

pub fn run_query(
    path: &std::path::Path,
    sql: &str,
    max_rows: usize,
) -> Result<SqliteResult, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| e.to_string())?;
    // Belt and braces: even a crafted statement can't write through this connection.
    conn.pragma_update(None, "query_only", "ON")
        .map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let n = columns.len();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let cap = max_rows.min(ROW_CAP);
    let mut truncated = false;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if out.len() >= cap {
            truncated = true;
            break;
        }
        let mut r = Vec::with_capacity(n);
        for i in 0..n {
            r.push(cell(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(r);
    }
    Ok(SqliteResult {
        columns,
        rows: out,
        truncated,
    })
}

#[tauri::command]
pub async fn sqlite_query(
    path: String,
    sql: String,
    max_rows: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<SqliteResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || run_query(&target, &sql, max_rows.unwrap_or(500)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("t.db");
        {
            let c = Connection::open(&db).unwrap();
            c.execute_batch("CREATE TABLE t (id INTEGER, name TEXT, data BLOB); INSERT INTO t VALUES (1, 'a', x'0102'), (2, NULL, NULL);")
                .unwrap();
        }
        let r = run_query(&db, "SELECT * FROM t ORDER BY id", 1).unwrap();
        assert_eq!(r.columns, vec!["id", "name", "data"]);
        assert_eq!(
            r.rows,
            vec![vec![
                Some("1".into()),
                Some("a".into()),
                Some("<blob 2 bytes>".into())
            ]]
        );
        assert!(r.truncated);
        assert!(run_query(&db, "DELETE FROM t", 10).is_err());
    }
}
