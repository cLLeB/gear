// The Extensions sidebar view: installed extensions with their state,
// permissions, commands and settings; enable / reload / uninstall; install
// from a folder or a git URL; scaffold a new one; and the API reference.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { PERMISSIONS, type ExtensionManifest } from "./manifest";
import { configValues, createExtension, extensionsRoot, installFromFolder, installFromGit, restart, runCommandFromUi, scan, setConfigValue, setEnabled, uninstall, useExtStore, type Installed } from "./store";

export const extLogPath = (id: string) => `gear-ext://log/${id}`;

const btn = "rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground";

function Settings({ m }: { m: ExtensionManifest }) {
  const [values, setValues] = useState(() => configValues(m.id));
  const entries = Object.entries(m.contributes.configuration);
  if (!entries.length) return null;
  const set = (k: string, v: unknown) => {
    setConfigValue(m.id, k, v);
    setValues(configValues(m.id));
  };
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 rounded border border-border/50 p-2">
      {entries.map(([k, def]) => {
        const v = values[k] ?? def.default;
        return (
          <label key={k} className="flex flex-col gap-0.5 text-[11px]">
            <span className="font-medium">{k.replace(`${m.id}.`, "")}</span>
            {def.description && <span className="text-muted-foreground">{def.description}</span>}
            {def.type === "boolean" ? (
              <input type="checkbox" className="self-start" checked={Boolean(v)} onChange={(e) => set(k, e.target.checked)} />
            ) : def.enum ? (
              <select className="rounded border border-border/60 bg-background px-1 py-0.5" value={String(v)} onChange={(e) => set(k, def.type === "number" ? Number(e.target.value) : e.target.value)}>
                {def.enum.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {String(o)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="rounded border border-border/60 bg-background px-1.5 py-0.5"
                type={def.type === "number" ? "number" : "text"}
                defaultValue={String(v)}
                onBlur={(e) => set(k, def.type === "number" ? Number(e.target.value) : e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function ExtensionCard({ x }: { x: Installed }) {
  const m = x.manifest;
  const enabled = useExtStore((s) => (m ? Boolean(s.enabled[m.id]) : false));
  const state = useExtStore((s) => (m ? (s.state[m.id] ?? "stopped") : "error"));
  const err = useExtStore((s) => (m ? s.errors[m.id] : undefined)) ?? x.error;
  const [open, setOpen] = useState(false);
  const dot = !enabled ? "bg-muted-foreground/30" : state === "active" ? "bg-emerald-500" : state === "starting" ? "animate-pulse bg-amber-500" : state === "error" ? "bg-destructive" : "bg-sky-500";
  return (
    <div className="border-b border-border/40 px-3 py-2 text-[12px]">
      <div className="flex items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", dot)} title={enabled ? state : "disabled"} />
        <button type="button" className="min-w-0 flex-1 truncate text-left font-medium" onClick={() => setOpen((o) => !o)}>
          {m?.name ?? x.dir.split("/").pop()}
          {m && <span className="ml-1.5 font-normal text-muted-foreground">{m.version}</span>}
        </button>
        {m && !x.error && (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", enabled ? "bg-primary" : "bg-muted-foreground/30")}
            onClick={() => void setEnabled(m.id, !enabled)}
            title={enabled ? "Disable" : "Enable"}
          >
            <span className={cn("absolute top-0.5 size-3 rounded-full bg-background transition-all", enabled ? "left-3.5" : "left-0.5")} />
          </button>
        )}
      </div>
      {m?.description && <div className="mt-0.5 line-clamp-2 pl-3.5 text-[11.5px] text-muted-foreground">{m.description}</div>}
      {err && <div className="mt-1 whitespace-pre-wrap pl-3.5 text-[11px] text-destructive">{err}</div>}
      {m && open && (
        <div className="mt-1.5 pl-3.5">
          <div className="text-[11px] text-muted-foreground">
            {m.id}
            {m.author ? ` · ${m.author}` : ""}
          </div>
          {m.permissions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.permissions.map((p) => (
                <span key={p} className={cn("rounded px-1 text-[10.5px]", p === "shell" || p === "fs.any" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground")} title={PERMISSIONS[p]}>
                  {p}
                </span>
              ))}
            </div>
          )}
          {m.contributes.commands.length > 0 && (
            <div className="mt-1.5 flex flex-col">
              {m.contributes.commands.map((c) => (
                <button key={c.id} type="button" disabled={!enabled} className="truncate rounded px-1 py-0.5 text-left text-[11.5px] hover:bg-muted disabled:opacity-50" onClick={() => runCommandFromUi(c.id)} title={c.id}>
                  ▸ {c.title}
                </button>
              ))}
            </div>
          )}
          {enabled && <Settings m={m} />}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {enabled && (
              <button type="button" className={btn} onClick={() => void restart(m.id)}>
                Reload
              </button>
            )}
            <button type="button" className={btn} onClick={() => app().openFile(extLogPath(m.id))}>
              Log
            </button>
            <button type="button" className={btn} onClick={() => app().openFile(`${x.dir}/${m.main}`)}>
              Source
            </button>
            <button type="button" className={btn} onClick={() => void uninstall(m.id).catch((e) => toast.error(String(e)))}>
              Uninstall
            </button>
          </div>
        </div>
      )}
      {!m && (
        <div className="mt-1 flex gap-1 pl-3.5">
          <button type="button" className={btn} onClick={() => app().openFile(`${x.dir}/gear-extension.json`)}>
            Open manifest
          </button>
        </div>
      )}
    </div>
  );
}

const API = [
  ["gear.commands.register(id, fn)", "Handle a command declared in contributes.commands"],
  ["gear.commands.execute(id, …args)", "Run another extension's command"],
  ["gear.window.showInformation / showWarning / showError(msg, …actions)", "Toast; resolves to the clicked action"],
  ["gear.window.quickPick(items, { title })", "Pick one item (strings or { label, description, detail })"],
  ["gear.window.inputBox({ title, placeholder, value })", "Ask for a line of text"],
  ["gear.window.setStatus(text, { tooltip, command })", "Status bar item (null clears it)"],
  ["gear.window.openFile(path, line?)", "Open a file in an editor tab"],
  ["gear.editor.active()", "{ path, language, text, selection, cursor } — editor.read"],
  ["gear.editor.replaceSelection / insert / setText(text)", "Edit the active editor — editor.write"],
  ["gear.workspace.root() / findFiles(glob)", "Workspace folder; matching paths — fs.read"],
  ["gear.workspace.readFile(path) / writeFile(path, text)", "Workspace files — fs.read / fs.write (fs.any outside it)"],
  ["gear.shell.exec(cmd, { cwd, timeout })", "{ stdout, stderr, code } — shell"],
  ["gear.terminal.run(cmd, { cwd })", "Run in a new terminal tab — shell"],
  ["gear.clipboard.read() / write(text)", "clipboard"],
  ["gear.config.get(key)", "Value of a contributes.configuration setting"],
  ["gear.storage.get(key) / set(key, value)", "Per-extension JSON storage (1 MB)"],
  ["gear.events.on(name, fn)", "save, activeEditorChange, configChange"],
  ["fetch(url)", "network"],
] as const;

export function ExtensionsPanel() {
  const installed = useExtStore((s) => s.installed);
  const [showApi, setShowApi] = useState(false);
  useEffect(() => {
    void scan();
  }, []);
  const add = async () => {
    const pick = await quickPick(
      [
        { label: "Create a new extension…", detail: "Scaffold a working example in ~/.gear/extensions", value: "create" },
        { label: "Install from a folder…", detail: "Copies a folder that has a gear-extension.json", value: "folder" },
        { label: "Install from a git repository…", detail: "git clone --depth 1", value: "git" },
        { label: "Open the extensions folder in a terminal", value: "terminal" },
      ],
      { title: "Extensions" },
    );
    if (pick === "create") await createExtension();
    else if (pick === "folder") {
      const p = await inputBox({ title: "Extension folder", placeholder: "/path/to/my-extension", value: app().workspaceRoot() ?? "" });
      if (p?.trim()) await installFromFolder(p.trim()).catch((e) => toast.error("Install failed", { description: String(e) }));
    } else if (pick === "git") {
      const u = await inputBox({ title: "Repository URL", placeholder: "https://github.com/me/gear-ext.git" });
      if (u?.trim()) await installFromGit(u.trim());
    } else if (pick === "terminal") app().openTerminal({ cwd: await extensionsRoot() });
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="text-[11.5px] font-semibold">Extensions</span>
        <span className="flex-1" />
        <button type="button" className={btn} title="Rescan" onClick={() => void scan()}>
          ⟳
        </button>
        <button type="button" className={btn} onClick={() => void add()}>
          + Add
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!installed.length && (
          <div className="p-3 text-[11.5px] text-muted-foreground">
            Extensions are folders in ~/.gear/extensions with a gear-extension.json and JavaScript. Each runs sandboxed in its own worker and can only use the permissions it declares.
            <button type="button" className="mt-2 block rounded border border-border/60 px-2 py-0.5 text-foreground hover:bg-muted" onClick={() => void createExtension()}>
              Create one from the example
            </button>
          </div>
        )}
        {installed.map((x) => (
          <ExtensionCard key={x.dir} x={x} />
        ))}
        <div className="px-3 py-2">
          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowApi((v) => !v)}>
            {showApi ? "▾" : "▸"} Extension API
          </button>
          {showApi && (
            <div className="mt-1 flex flex-col gap-1">
              {API.map(([sig, doc]) => (
                <div key={sig} className="text-[11px]">
                  <code className="break-all text-primary">{sig}</code>
                  <div className="text-muted-foreground">{doc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Status bar items set by extensions. */
export function ExtensionStatusItems() {
  const status = useExtStore((s) => s.status);
  const entries = Object.entries(status);
  if (!entries.length) return null;
  return (
    <>
      {entries.map(([id, s]) => (
        <button
          key={id}
          type="button"
          className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground", s.command ? "hover:bg-muted hover:text-foreground" : "cursor-default")}
          title={s.tooltip ?? id}
          onClick={() => s.command && runCommandFromUi(s.command)}
        >
          {s.text}
        </button>
      ))}
    </>
  );
}
