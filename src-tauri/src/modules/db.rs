//! Database client backend: connections to PostgreSQL, MySQL / MariaDB and
//! SQLite, ad-hoc queries (every value returned as text), schema
//! introspection, and transactional statement batches for grid edits.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

const ROW_CAP: usize = 20_000;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectSpec {
    /// "postgres" | "mysql" | "sqlite"
    pub kind: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    /// SQLite file path.
    pub path: Option<String>,
    /// "disable" | "prefer" | "require"
    pub ssl: Option<String>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub truncated: bool,
    /// Rows changed by INSERT / UPDATE / DELETE.
    pub affected: Option<u64>,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    /// "table" | "view"
    pub kind: String,
    pub columns: Vec<ColumnInfo>,
}

pub enum Conn {
    Pg(postgres::Client),
    My(mysql::Conn),
    Lite(rusqlite::Connection),
}

#[derive(Default)]
pub struct DbState {
    conns: Mutex<HashMap<u32, Arc<Mutex<Conn>>>>,
    next: AtomicU32,
}

fn tls_config() -> rustls::ClientConfig {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("tls versions")
        .with_root_certificates(roots)
        .with_no_client_auth()
}

fn connect(spec: &ConnectSpec) -> Result<Conn, String> {
    match spec.kind.as_str() {
        "postgres" => {
            let mut cfg = postgres::Config::new();
            cfg.host(spec.host.as_deref().unwrap_or("localhost"))
                .port(spec.port.unwrap_or(5432))
                .user(spec.user.as_deref().unwrap_or("postgres"))
                .dbname(spec.database.as_deref().unwrap_or("postgres"))
                .application_name("Gear")
                .connect_timeout(std::time::Duration::from_secs(10));
            if let Some(p) = &spec.password {
                cfg.password(p);
            }
            let ssl = spec.ssl.as_deref().unwrap_or("prefer");
            if ssl == "disable" {
                return cfg.connect(postgres::NoTls).map(Conn::Pg).map_err(pg_err);
            }
            cfg.ssl_mode(if ssl == "require" {
                postgres::config::SslMode::Require
            } else {
                postgres::config::SslMode::Prefer
            });
            let tls = tokio_postgres_rustls::MakeRustlsConnect::new(tls_config());
            cfg.connect(tls).map(Conn::Pg).map_err(pg_err)
        }
        "mysql" => {
            let mut b = mysql::OptsBuilder::new()
                .ip_or_hostname(Some(
                    spec.host.clone().unwrap_or_else(|| "localhost".into()),
                ))
                .tcp_port(spec.port.unwrap_or(3306))
                .user(spec.user.clone())
                .pass(spec.password.clone())
                .db_name(spec.database.clone().filter(|d| !d.is_empty()))
                .tcp_connect_timeout(Some(std::time::Duration::from_secs(10)));
            if spec.ssl.as_deref() == Some("require") {
                b = b.ssl_opts(Some(mysql::SslOpts::default()));
            }
            mysql::Conn::new(b).map(Conn::My).map_err(|e| e.to_string())
        }
        "sqlite" => {
            let path = spec.path.as_deref().ok_or("SQLite needs a file path")?;
            rusqlite::Connection::open(path)
                .map(Conn::Lite)
                .map_err(|e| e.to_string())
        }
        other => Err(format!("unsupported database kind: {other}")),
    }
}

fn pg_err(e: postgres::Error) -> String {
    match e.as_db_error() {
        Some(db) => {
            let mut s = format!("{}: {}", db.severity(), db.message());
            if let Some(d) = db.detail() {
                s.push_str(&format!("\n{d}"));
            }
            if let Some(h) = db.hint() {
                s.push_str(&format!("\nHint: {h}"));
            }
            if let Some(p) = db.position() {
                s.push_str(&format!("\n(at {p:?})"));
            }
            s
        }
        None => e.to_string(),
    }
}

fn mysql_value(v: &mysql::Value) -> Option<String> {
    use mysql::Value::*;
    match v {
        NULL => None,
        Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
        Int(i) => Some(i.to_string()),
        UInt(u) => Some(u.to_string()),
        Float(f) => Some(f.to_string()),
        Double(f) => Some(f.to_string()),
        Date(y, mo, d, h, mi, s, us) => Some(if *h == 0 && *mi == 0 && *s == 0 && *us == 0 {
            format!("{y:04}-{mo:02}-{d:02}")
        } else {
            format!(
                "{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}{}",
                if *us > 0 {
                    format!(".{us:06}")
                } else {
                    String::new()
                }
            )
        }),
        Time(neg, d, h, m, s, us) => Some(format!(
            "{}{:02}:{m:02}:{s:02}{}",
            if *neg { "-" } else { "" },
            *d * 24 + u32::from(*h),
            if *us > 0 {
                format!(".{us:06}")
            } else {
                String::new()
            }
        )),
    }
}

fn lite_value(v: rusqlite::types::ValueRef<'_>) -> Option<String> {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => None,
        Integer(i) => Some(i.to_string()),
        Real(f) => Some(f.to_string()),
        Text(t) => Some(String::from_utf8_lossy(t).into_owned()),
        Blob(b) => Some(format!(
            "\\x{}",
            b.iter().map(|x| format!("{x:02x}")).collect::<String>()
        )),
    }
}

pub fn run_query(conn: &mut Conn, sql: &str, max_rows: usize) -> Result<QueryResult, String> {
    let started = Instant::now();
    let cap = max_rows.clamp(1, ROW_CAP);
    let mut out = QueryResult::default();
    match conn {
        Conn::Pg(c) => {
            // simple_query returns every value as text — exactly what a grid needs.
            for msg in c.simple_query(sql).map_err(pg_err)? {
                match msg {
                    postgres::SimpleQueryMessage::RowDescription(cols) => {
                        out.columns = cols.iter().map(|c| c.name().to_string()).collect();
                        out.rows.clear();
                        out.truncated = false;
                    }
                    postgres::SimpleQueryMessage::Row(row) => {
                        if out.columns.is_empty() {
                            out.columns =
                                row.columns().iter().map(|c| c.name().to_string()).collect();
                        }
                        if out.rows.len() >= cap {
                            out.truncated = true;
                            continue;
                        }
                        out.rows.push(
                            (0..row.len())
                                .map(|i| row.get(i).map(str::to_string))
                                .collect(),
                        );
                    }
                    postgres::SimpleQueryMessage::CommandComplete(n) if out.columns.is_empty() => {
                        out.affected = Some(n);
                    }
                    _ => {}
                }
            }
        }
        Conn::My(c) => {
            use mysql::prelude::Queryable;
            let mut result = c.query_iter(sql).map_err(|e| e.to_string())?;
            let mut affected = 0u64;
            while let Some(set) = result.iter() {
                affected += set.affected_rows();
                let cols: Vec<String> = set
                    .columns()
                    .as_ref()
                    .iter()
                    .map(|c| c.name_str().into_owned())
                    .collect();
                let mut rows = Vec::new();
                let mut truncated = false;
                for row in set {
                    let row = row.map_err(|e| e.to_string())?;
                    if rows.len() >= cap {
                        truncated = true;
                        continue;
                    }
                    rows.push(row.unwrap().iter().map(mysql_value).collect());
                }
                // Keep the last result set that has columns (multi-statement scripts).
                if !cols.is_empty() || out.columns.is_empty() {
                    out.columns = cols;
                    out.rows = rows;
                    out.truncated = truncated;
                }
            }
            drop(result);
            if out.columns.is_empty() {
                out.affected = Some(affected);
            }
        }
        Conn::Lite(c) => {
            let mut stmt = c.prepare(sql).map_err(|e| e.to_string())?;
            if stmt.column_count() == 0 {
                let n = stmt.execute([]).map_err(|e| e.to_string())?;
                out.affected = Some(n as u64);
            } else {
                out.columns = stmt.column_names().iter().map(|s| s.to_string()).collect();
                let n = out.columns.len();
                let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
                while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                    if out.rows.len() >= cap {
                        out.truncated = true;
                        break;
                    }
                    let mut r = Vec::with_capacity(n);
                    for i in 0..n {
                        r.push(lite_value(row.get_ref(i).map_err(|e| e.to_string())?));
                    }
                    out.rows.push(r);
                }
            }
        }
    }
    out.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(out)
}

/// Run statements atomically (grid edits): all or nothing.
pub fn run_batch(conn: &mut Conn, statements: &[String]) -> Result<u64, String> {
    let mut total = 0u64;
    match conn {
        Conn::Pg(c) => {
            let mut tx = c.transaction().map_err(pg_err)?;
            for s in statements {
                total += tx.execute(s.as_str(), &[]).map_err(pg_err)?;
            }
            tx.commit().map_err(pg_err)?;
        }
        Conn::My(c) => {
            use mysql::prelude::Queryable;
            let mut tx = c
                .start_transaction(mysql::TxOpts::default())
                .map_err(|e| e.to_string())?;
            for s in statements {
                tx.query_drop(s).map_err(|e| e.to_string())?;
                total += tx.affected_rows();
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
        Conn::Lite(c) => {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            for s in statements {
                total += tx.execute(s, []).map_err(|e| e.to_string())? as u64;
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
    }
    Ok(total)
}

fn rows_of(conn: &mut Conn, sql: &str) -> Result<Vec<Vec<Option<String>>>, String> {
    Ok(run_query(conn, sql, ROW_CAP)?.rows)
}

pub fn schema(conn: &mut Conn) -> Result<Vec<TableInfo>, String> {
    let mut tables: Vec<TableInfo> = Vec::new();
    let mut index: HashMap<(String, String), usize> = HashMap::new();
    let (tsql, csql, pksql) = match conn {
        Conn::Pg(_) => (
            "SELECT table_schema, table_name, CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2",
            "SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name, ordinal_position",
            "SELECT kcu.table_schema, kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY'",
        ),
        Conn::My(_) => (
            "SELECT table_schema, table_name, CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY 1, 2",
            "SELECT table_schema, table_name, column_name, column_type, is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_schema, table_name, ordinal_position",
            "SELECT table_schema, table_name, column_name FROM information_schema.key_column_usage WHERE constraint_name = 'PRIMARY' AND table_schema = DATABASE()",
        ),
        Conn::Lite(_) => ("", "", ""),
    };
    if let Conn::Lite(_) = conn {
        let names = rows_of(conn, "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
        for r in names {
            let name = r[0].clone().unwrap_or_default();
            let kind = r[1].clone().unwrap_or_default();
            let cols = rows_of(
                conn,
                &format!("PRAGMA table_info(\"{}\")", name.replace('"', "\"\"")),
            )?;
            tables.push(TableInfo {
                schema: "main".into(),
                name,
                kind,
                columns: cols
                    .into_iter()
                    .map(|c| ColumnInfo {
                        name: c[1].clone().unwrap_or_default(),
                        data_type: c[2].clone().unwrap_or_default(),
                        nullable: c[3].as_deref() != Some("1"),
                        primary_key: c[5].as_deref().is_some_and(|p| p != "0"),
                    })
                    .collect(),
            });
        }
        return Ok(tables);
    }
    for r in rows_of(conn, tsql)? {
        let key = (
            r[0].clone().unwrap_or_default(),
            r[1].clone().unwrap_or_default(),
        );
        index.insert(key.clone(), tables.len());
        tables.push(TableInfo {
            schema: key.0,
            name: key.1,
            kind: r[2].clone().unwrap_or_default(),
            columns: vec![],
        });
    }
    for r in rows_of(conn, csql)? {
        let key = (
            r[0].clone().unwrap_or_default(),
            r[1].clone().unwrap_or_default(),
        );
        if let Some(&i) = index.get(&key) {
            tables[i].columns.push(ColumnInfo {
                name: r[2].clone().unwrap_or_default(),
                data_type: r[3].clone().unwrap_or_default(),
                nullable: r[4].as_deref() == Some("YES"),
                primary_key: false,
            });
        }
    }
    for r in rows_of(conn, pksql)? {
        let key = (
            r[0].clone().unwrap_or_default(),
            r[1].clone().unwrap_or_default(),
        );
        if let Some(&i) = index.get(&key) {
            if let Some(c) = tables[i]
                .columns
                .iter_mut()
                .find(|c| Some(&c.name) == r[2].as_ref())
            {
                c.primary_key = true;
            }
        }
    }
    Ok(tables)
}

fn get(state: &DbState, id: u32) -> Result<Arc<Mutex<Conn>>, String> {
    state
        .conns
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| "connection closed".to_string())
}

#[tauri::command]
pub async fn db_connect(
    state: tauri::State<'_, DbState>,
    spec: ConnectSpec,
) -> Result<u32, String> {
    let conn = tauri::async_runtime::spawn_blocking(move || connect(&spec))
        .await
        .map_err(|e| e.to_string())??;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state
        .conns
        .lock()
        .unwrap()
        .insert(id, Arc::new(Mutex::new(conn)));
    Ok(id)
}

#[tauri::command]
pub async fn db_query(
    state: tauri::State<'_, DbState>,
    id: u32,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    let c = get(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_query(&mut c.lock().unwrap(), &sql, max_rows.unwrap_or(1000))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_batch(
    state: tauri::State<'_, DbState>,
    id: u32,
    statements: Vec<String>,
) -> Result<u64, String> {
    let c = get(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || run_batch(&mut c.lock().unwrap(), &statements))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_schema(
    state: tauri::State<'_, DbState>,
    id: u32,
) -> Result<Vec<TableInfo>, String> {
    let c = get(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || schema(&mut c.lock().unwrap()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn db_close(state: tauri::State<'_, DbState>, id: u32) {
    state.conns.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lite() -> Conn {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL); INSERT INTO users VALUES (1, 'ada', 9.5), (2, 'bob', NULL); CREATE VIEW v AS SELECT name FROM users;").unwrap();
        Conn::Lite(c)
    }

    #[test]
    fn sqlite_query_batch_and_schema() {
        let mut c = lite();
        let r = run_query(&mut c, "SELECT * FROM users ORDER BY id", 1).unwrap();
        assert_eq!(r.columns, ["id", "name", "score"]);
        assert_eq!(
            r.rows,
            vec![vec![
                Some("1".into()),
                Some("ada".into()),
                Some("9.5".into())
            ]]
        );
        assert!(r.truncated);
        assert_eq!(
            run_batch(
                &mut c,
                &[
                    "UPDATE users SET score = 1 WHERE id = 2".into(),
                    "DELETE FROM users WHERE id = 1".into()
                ]
            )
            .unwrap(),
            2
        );
        // A failing statement rolls the whole batch back.
        assert!(run_batch(
            &mut c,
            &[
                "DELETE FROM users".into(),
                "INSERT INTO nope VALUES (1)".into()
            ]
        )
        .is_err());
        assert_eq!(
            run_query(&mut c, "SELECT count(*) FROM users", 10)
                .unwrap()
                .rows[0][0]
                .as_deref(),
            Some("1")
        );
        let s = schema(&mut c).unwrap();
        let users = s.iter().find(|t| t.name == "users").unwrap();
        assert!(users.columns[0].primary_key);
        assert!(!users.columns[1].nullable);
        assert_eq!(s.iter().find(|t| t.name == "v").unwrap().kind, "view");
        assert_eq!(
            run_query(&mut c, "INSERT INTO users (name) VALUES ('x')", 10)
                .unwrap()
                .affected,
            Some(1)
        );
    }

    /// Runs against a real server when GEAR_TEST_PG_PORT is set (local Postgres, user "gear", trust auth).
    #[test]
    fn postgres_end_to_end() {
        let Ok(port) = std::env::var("GEAR_TEST_PG_PORT") else {
            return;
        };
        let spec = ConnectSpec {
            kind: "postgres".into(),
            host: Some("127.0.0.1".into()),
            port: port.parse().ok(),
            user: Some("gear".into()),
            password: None,
            database: Some("postgres".into()),
            path: None,
            ssl: Some("prefer".into()),
        };
        let mut c = connect(&spec).unwrap();
        run_query(&mut c, "DROP TABLE IF EXISTS gear_t; CREATE TABLE gear_t (id serial PRIMARY KEY, name text NOT NULL, born date, meta jsonb)", 10).unwrap();
        let ins = run_query(&mut c, "INSERT INTO gear_t (name, born, meta) VALUES ('ada', '1815-12-10', '{\"x\": 1}'), ('bob', NULL, NULL)", 10).unwrap();
        assert_eq!(ins.affected, Some(2));
        let r = run_query(
            &mut c,
            "SELECT id, name, born, meta FROM gear_t ORDER BY id",
            10,
        )
        .unwrap();
        assert_eq!(r.columns, ["id", "name", "born", "meta"]);
        assert_eq!(
            r.rows[0],
            vec![
                Some("1".into()),
                Some("ada".into()),
                Some("1815-12-10".into()),
                Some("{\"x\": 1}".into())
            ]
        );
        assert_eq!(r.rows[1][2], None);
        let err = run_query(&mut c, "SELECT nope FROM gear_t", 10).unwrap_err();
        assert!(err.contains("column \"nope\" does not exist"), "{err}");
        assert!(run_batch(
            &mut c,
            &[
                "UPDATE gear_t SET name = 'x' WHERE id = 1".into(),
                "UPDATE gear_t SET id = NULL".into()
            ]
        )
        .is_err());
        assert_eq!(
            run_query(&mut c, "SELECT name FROM gear_t WHERE id = 1", 10)
                .unwrap()
                .rows[0][0]
                .as_deref(),
            Some("ada")
        );
        let s = schema(&mut c).unwrap();
        let t = s.iter().find(|t| t.name == "gear_t").unwrap();
        assert!(
            t.columns
                .iter()
                .find(|c| c.name == "id")
                .unwrap()
                .primary_key
        );
        assert_eq!(
            t.columns
                .iter()
                .find(|c| c.name == "meta")
                .unwrap()
                .data_type,
            "jsonb"
        );
        run_query(&mut c, "DROP TABLE gear_t", 10).unwrap();
    }
}
