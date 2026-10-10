// Database connections: saved profiles (passwords in the OS keychain), live
// connections, schema cache, query history, and the virtual tab paths that
// open a console or a table.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import type { Dialect } from "./model";

export interface DbProfile {
  id: string;
  name: string;
  kind: Dialect;
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  path?: string;
  ssl?: "disable" | "prefer" | "require";
  /** Ask before running anything that writes. */
  readOnly?: boolean;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: "table" | "view";
  columns: ColumnInfo[];
}

export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  truncated: boolean;
  affected: number | null;
  elapsedMs: number;
}

interface DbStore {
  profiles: DbProfile[];
  /** profile id → backend connection id */
  live: Record<string, number>;
  schema: Record<string, TableInfo[]>;
  connecting: Record<string, boolean>;
  history: { profileId: string; sql: string; at: number }[];
}

const KEY = "gear-db-profiles";
const HIST = "gear-db-history";
const SERVICE = "gear-database";

function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}

export const useDbStore = create<DbStore>(() => ({ profiles: load(KEY, []), live: {}, schema: {}, connecting: {}, history: load(HIST, []) }));

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(useDbStore.getState().profiles));
  } catch {
    /* ignore */
  }
}

export function profileById(id: string): DbProfile | undefined {
  return useDbStore.getState().profiles.find((p) => p.id === id);
}

export async function saveProfile(p: DbProfile, password?: string | null): Promise<void> {
  useDbStore.setState((s) => ({ profiles: [...s.profiles.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)) }));
  persist();
  if (password !== undefined) {
    if (password) await invoke("secrets_set", { service: SERVICE, account: p.id, password }).catch((e) => toast.error(`Couldn't store the password: ${e}`));
    else await invoke("secrets_delete", { service: SERVICE, account: p.id }).catch(() => {});
  }
}

export async function deleteProfile(id: string): Promise<void> {
  await disconnect(id);
  useDbStore.setState((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) }));
  persist();
  await invoke("secrets_delete", { service: SERVICE, account: id }).catch(() => {});
}

async function password(id: string): Promise<string | null> {
  return invoke<string | null>("secrets_get", { service: SERVICE, account: id }).catch(() => null);
}

function spec(p: DbProfile, pw: string | null) {
  return { kind: p.kind, host: p.host ?? null, port: p.port ?? null, user: p.user ?? null, password: pw, database: p.database ?? null, path: p.path ?? null, ssl: p.ssl ?? "prefer" };
}

/** Try a connection without saving it. */
export async function testConnection(p: DbProfile, pw: string | null): Promise<string> {
  const id = await invoke<number>("db_connect", { spec: spec(p, pw) });
  try {
    const r = await invoke<QueryResult>("db_query", { id, sql: p.kind === "sqlite" ? "select sqlite_version()" : "select version()", maxRows: 1 });
    return r.rows[0]?.[0] ?? "connected";
  } finally {
    void invoke("db_close", { id });
  }
}

export async function connect(profileId: string): Promise<number> {
  const live = useDbStore.getState().live[profileId];
  if (live) return live;
  const p = profileById(profileId);
  if (!p) throw new Error("Unknown connection");
  useDbStore.setState((s) => ({ connecting: { ...s.connecting, [profileId]: true } }));
  try {
    const id = await invoke<number>("db_connect", { spec: spec(p, await password(profileId)) });
    useDbStore.setState((s) => ({ live: { ...s.live, [profileId]: id } }));
    void refreshSchema(profileId);
    return id;
  } finally {
    useDbStore.setState((s) => ({ connecting: { ...s.connecting, [profileId]: false } }));
  }
}

export async function disconnect(profileId: string): Promise<void> {
  const id = useDbStore.getState().live[profileId];
  if (id) await invoke("db_close", { id }).catch(() => {});
  useDbStore.setState((s) => {
    const { [profileId]: _, ...live } = s.live;
    return { live };
  });
}

/** Run on a profile, reconnecting once if the server dropped the connection. */
async function withConn<T>(profileId: string, f: (id: number) => Promise<T>): Promise<T> {
  const id = await connect(profileId);
  try {
    return await f(id);
  } catch (e) {
    const msg = String(e);
    if (/connection (closed|reset)|broken pipe|server closed|lost connection|gone away|terminating connection/i.test(msg)) {
      await disconnect(profileId);
      return f(await connect(profileId));
    }
    throw e;
  }
}

export async function runQuery(profileId: string, sql: string, maxRows = 2000): Promise<QueryResult> {
  const r = await withConn(profileId, (id) => invoke<QueryResult>("db_query", { id, sql, maxRows }));
  useDbStore.setState((s) => {
    const history = [{ profileId, sql, at: Date.now() }, ...s.history.filter((h) => !(h.profileId === profileId && h.sql === sql))].slice(0, 200);
    try {
      localStorage.setItem(HIST, JSON.stringify(history));
    } catch {
      /* ignore */
    }
    return { history };
  });
  if (/^\s*(create|alter|drop|rename)\b/i.test(sql)) void refreshSchema(profileId);
  return r;
}

export async function runBatch(profileId: string, statements: string[]): Promise<number> {
  return withConn(profileId, (id) => invoke<number>("db_batch", { id, statements }));
}

export async function refreshSchema(profileId: string): Promise<TableInfo[]> {
  const tables = await withConn(profileId, (id) => invoke<TableInfo[]>("db_schema", { id })).catch((e) => {
    toast.error("Couldn't read the schema", { description: String(e) });
    return [] as TableInfo[];
  });
  useDbStore.setState((s) => ({ schema: { ...s.schema, [profileId]: tables } }));
  return tables;
}

// ── tabs ──────────────────────────────────────────────────────────────────

export const DB_SCHEME = "gear-db://";

export function consolePath(profileId: string, table?: { schema: string; name: string }): string {
  return table ? `${DB_SCHEME}${profileId}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.name)}` : `${DB_SCHEME}${profileId}/Console ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function parseConsolePath(path: string): { profileId: string; table: { schema: string; name: string } | null } | null {
  if (!path.startsWith(DB_SCHEME)) return null;
  const parts = path.slice(DB_SCHEME.length).split("/");
  if (parts.length === 3) return { profileId: parts[0], table: { schema: decodeURIComponent(parts[1]), name: decodeURIComponent(parts[2]) } };
  return { profileId: parts[0], table: null };
}

export function openConsole(profileId: string, table?: { schema: string; name: string }): void {
  app().openFile(consolePath(profileId, table));
}

export function newProfileId(): string {
  return `db-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
