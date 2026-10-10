// The Database sidebar view: saved connections, a connection form (paste a
// URL or fill the fields, test before saving), and the schema tree with
// tables / views / columns that open in a console.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { confirmPick, quickPick } from "@/modules/quick-pick";
import { parseConnectionUrl, type Dialect } from "./model";
import { connect, deleteProfile, disconnect, newProfileId, openConsole, refreshSchema, saveProfile, testConnection, useDbStore, type DbProfile, type TableInfo } from "./store";

const DEFAULT_PORT: Record<Dialect, number | undefined> = { postgres: 5432, mysql: 3306, sqlite: undefined };

export function ConnectionDialog({ initial, onClose }: { initial: DbProfile | null; onClose: () => void }) {
  const [p, setP] = useState<DbProfile>(initial ?? { id: newProfileId(), name: "", kind: "postgres", host: "localhost", port: 5432, user: "", database: "", ssl: "prefer" });
  const [pw, setPw] = useState<string>("");
  const [pwTouched, setPwTouched] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<DbProfile>) => setP((x) => ({ ...x, ...patch }));
  const fromUrl = (u: string) => {
    setUrl(u);
    const parsed = parseConnectionUrl(u);
    if (!parsed) return;
    const { password, ...rest } = parsed;
    setP((x) => ({ ...x, ...rest, ssl: (rest.ssl as DbProfile["ssl"]) ?? x.ssl, name: x.name || `${rest.database ?? rest.path?.replace(/^.*[\\/]/, "") ?? ""}@${rest.host ?? "local"}` }));
    if (password) {
      setPw(password);
      setPwTouched(true);
    }
  };
  const test = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const v = await testConnection(p, pwTouched ? pw : null);
      setStatus({ ok: true, text: v.split("\n")[0].slice(0, 160) });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!p.name.trim()) return void toast.error("Give the connection a name");
    await saveProfile({ ...p, name: p.name.trim() }, pwTouched ? pw : undefined);
    onClose();
  };
  const field = "w-full rounded border border-border/60 bg-background px-2 py-1 text-[12px]";
  const label = "text-[11px] text-muted-foreground";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-lg flex-col gap-3 p-4">
        <DialogTitle className="text-sm">{initial ? "Edit connection" : "New database connection"}</DialogTitle>
        <div className="flex flex-col gap-1">
          <span className={label}>Paste a URL (optional)</span>
          <input className={field} placeholder="postgres://user:pass@host:5432/db?sslmode=require  ·  mysql://…  ·  sqlite:/path/app.db" value={url} onChange={(e) => fromUrl(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 flex flex-col gap-1">
            <span className={label}>Name</span>
            <input className={field} value={p.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Type</span>
            <select className={field} value={p.kind} onChange={(e) => set({ kind: e.target.value as Dialect, port: DEFAULT_PORT[e.target.value as Dialect] })}>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite</option>
            </select>
          </label>
        </div>
        {p.kind === "sqlite" ? (
          <label className="flex flex-col gap-1">
            <span className={label}>Database file</span>
            <input className={field} placeholder="/path/to/app.db" value={p.path ?? ""} onChange={(e) => set({ path: e.target.value })} />
          </label>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <label className="col-span-2 flex flex-col gap-1">
                <span className={label}>Host</span>
                <input className={field} value={p.host ?? ""} onChange={(e) => set({ host: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Port</span>
                <input className={field} value={p.port ?? ""} onChange={(e) => set({ port: Number(e.target.value) || undefined })} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className={label}>User</span>
                <input className={field} value={p.user ?? ""} onChange={(e) => set({ user: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Password</span>
                <input
                  className={field}
                  type="password"
                  placeholder={initial && !pwTouched ? "(unchanged)" : ""}
                  value={pw}
                  onChange={(e) => {
                    setPw(e.target.value);
                    setPwTouched(true);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Database</span>
                <input className={field} value={p.database ?? ""} onChange={(e) => set({ database: e.target.value })} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[12px]">
              <span className={label}>TLS</span>
              <select className="rounded border border-border/60 bg-background px-1 py-0.5 text-[12px]" value={p.ssl ?? "prefer"} onChange={(e) => set({ ssl: e.target.value as DbProfile["ssl"] })}>
                <option value="prefer">prefer</option>
                <option value="require">require</option>
                <option value="disable">disable</option>
              </select>
            </label>
          </>
        )}
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={!!p.readOnly} onChange={(e) => set({ readOnly: e.target.checked })} />
          Ask before writing (production safety)
        </label>
        {status ? <div className={cn("rounded p-2 text-[11.5px]", status.ok ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-red-500/10 text-red-700 dark:text-red-300")}>{status.ok ? `✓ ${status.text}` : status.text}</div> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border border-border/60 px-3 py-1 text-[12px] hover:bg-muted disabled:opacity-50" disabled={busy} onClick={() => void test()}>
            {busy ? "Testing…" : "Test"}
          </button>
          <button type="button" className="rounded bg-primary px-3 py-1 text-[12px] text-primary-foreground" onClick={() => void save()}>
            Save
          </button>
        </div>
        <p className="text-[10.5px] text-muted-foreground">Passwords are kept in the OS keychain, never in Gear's settings.</p>
      </DialogContent>
    </Dialog>
  );
}

function TableRow({ profileId, t }: { profileId: string; t: TableInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="group flex items-center gap-1 py-px pl-6 pr-2 text-[11.5px] hover:bg-muted/50">
        <button type="button" className="w-3 text-[9px] text-muted-foreground" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"}
        </button>
        <button type="button" className="min-w-0 flex-1 truncate text-left" title={`${t.schema}.${t.name}`} onClick={() => openConsole(profileId, { schema: t.schema, name: t.name })}>
          <span className="mr-1 text-muted-foreground">{t.kind === "view" ? "👁" : "▦"}</span>
          {t.name}
        </button>
        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">{t.columns.length} cols</span>
      </div>
      {open
        ? t.columns.map((c) => (
            <div key={c.name} className="flex items-center gap-1.5 py-px pl-12 pr-2 text-[11px]">
              <span className="w-3 text-center">{c.primaryKey ? "🔑" : ""}</span>
              <span className="truncate font-mono">{c.name}</span>
              <span className="ml-auto truncate text-muted-foreground">
                {c.dataType}
                {c.nullable ? "" : " not null"}
              </span>
            </div>
          ))
        : null}
    </div>
  );
}

function ProfileRow({ p, onEdit }: { p: DbProfile; onEdit: () => void }) {
  const live = useDbStore((s) => !!s.live[p.id]);
  const connecting = useDbStore((s) => !!s.connecting[p.id]);
  const schema = useDbStore((s) => s.schema[p.id]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, TableInfo[]>();
    for (const t of schema ?? []) if (!filter || t.name.toLowerCase().includes(filter.toLowerCase())) m.set(t.schema, [...(m.get(t.schema) ?? []), t]);
    return [...m];
  }, [schema, filter]);
  const toggle = async () => {
    if (!open && !live) {
      try {
        await connect(p.id);
      } catch (e) {
        return void toast.error(`Couldn't connect to ${p.name}`, { description: String(e) });
      }
    }
    setOpen((o) => !o);
  };
  const menu = async () => {
    const a = await quickPick(
      [
        { label: "New console", value: "console" },
        { label: "Refresh schema", value: "refresh" },
        { label: live ? "Disconnect" : "Connect", value: "toggle" },
        { label: "Edit…", value: "edit" },
        { label: "Delete", value: "delete" },
      ],
      { title: p.name },
    );
    if (a === "console") openConsole(p.id);
    else if (a === "refresh") void refreshSchema(p.id);
    else if (a === "toggle") void (live ? disconnect(p.id) : connect(p.id).catch((e) => toast.error(String(e))));
    else if (a === "edit") onEdit();
    else if (a === "delete" && (await confirmPick(`Delete the connection "${p.name}"?`, "Delete"))) void deleteProfile(p.id);
  };
  return (
    <div className="border-b border-border/30">
      <div className="group flex items-center gap-1.5 px-2 py-1 text-[12px] hover:bg-muted/50" onContextMenu={(e) => (e.preventDefault(), void menu())}>
        <button type="button" className="w-3 text-[9px] text-muted-foreground" onClick={() => void toggle()}>
          {open ? "▾" : "▸"}
        </button>
        <span className={cn("size-2 shrink-0 rounded-full", connecting ? "animate-pulse bg-amber-500" : live ? "bg-green-500" : "bg-muted-foreground/40")} />
        <button type="button" className="min-w-0 flex-1 truncate text-left font-medium" onClick={() => void toggle()} title={p.kind === "sqlite" ? p.path : `${p.user}@${p.host}:${p.port}/${p.database}`}>
          {p.name}
        </button>
        <span className="text-[10px] uppercase text-muted-foreground">{p.kind === "postgres" ? "pg" : p.kind}</span>
        <span className="flex gap-0.5 opacity-0 group-hover:opacity-100">
          <button type="button" className="px-1 hover:text-primary" title="New console" onClick={() => openConsole(p.id)}>
            ⌨
          </button>
          <button type="button" className="px-1 hover:text-primary" title="More…" onClick={() => void menu()}>
            ⋯
          </button>
        </span>
      </div>
      {open ? (
        <div className="pb-1">
          {(schema?.length ?? 0) > 15 ? <input className="mx-2 mb-1 w-[calc(100%-16px)] rounded border border-border/50 bg-transparent px-1.5 py-0.5 text-[11px]" placeholder="Filter tables…" value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
          {!schema ? <div className="px-6 py-1 text-[11px] text-muted-foreground">Loading schema…</div> : null}
          {groups.map(([s, tables]) => (
            <div key={s}>
              {groups.length > 1 ? <div className="px-4 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{s}</div> : null}
              {tables.map((t) => (
                <TableRow key={`${t.schema}.${t.name}`} profileId={p.id} t={t} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DatabasePanel() {
  const profiles = useDbStore((s) => s.profiles);
  const [editing, setEditing] = useState<DbProfile | null | "new">(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="text-[11.5px] font-semibold">Database</span>
        <button type="button" className="ml-auto rounded px-2 py-0.5 text-[11.5px] hover:bg-muted" onClick={() => setEditing("new")}>
          + Connection
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!profiles.length ? <div className="p-3 text-[11.5px] text-muted-foreground">Connect to PostgreSQL, MySQL / MariaDB or SQLite: browse tables, run queries with schema-aware completion, and edit rows.</div> : null}
        {profiles.map((p) => (
          <ProfileRow key={p.id} p={p} onEdit={() => setEditing(p)} />
        ))}
      </div>
      {editing ? <ConnectionDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
