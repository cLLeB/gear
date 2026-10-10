// The Containers sidebar view: the workspace's dev container (start, rebuild,
// terminal, ports), every container grouped by Compose project with live
// CPU / memory, and local images.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { quickPick } from "@/modules/quick-pick";
import { commandLine, groupByCompose, LABEL_FOLDER, type ContainerSummary, type ImageSummary } from "./model";
import {
  addConfig,
  composeAction,
  containerAction,
  detect,
  devProbe,
  devShell,
  devStop,
  devUp,
  inspectPath,
  LOG_PATH,
  logsPath,
  openShell,
  prune,
  refresh,
  refreshStats,
  removeImage,
  useContainersStore,
} from "./store";

const STATE_DOT: Record<string, string> = { running: "bg-emerald-500", paused: "bg-amber-500", restarting: "bg-amber-500", created: "bg-sky-500", exited: "bg-muted-foreground/50", dead: "bg-destructive" };

function Section({ title, count, children, actions, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; actions?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/40">
      <div className="group flex h-7 items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <button type="button" className="flex flex-1 items-center gap-1 text-left" onClick={() => setOpen((o) => !o)}>
          <span className="w-3">{open ? "▾" : "▸"}</span>
          {title}
          {count !== undefined && <span className="font-normal normal-case">({count})</span>}
        </button>
        <div className="flex gap-0.5 normal-case opacity-0 group-hover:opacity-100">{actions}</div>
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

const iconBtn = "rounded px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground";

function DevSection() {
  const dev = useContainersStore((s) => s.dev);
  const containers = useContainersStore((s) => s.containers);
  const busy = useContainersStore((s) => s.logRunning);
  const c = dev.containerId ? containers.find((x) => x.id === dev.containerId) : undefined;
  if (!dev.configPath)
    return (
      <div className="px-3 py-2 text-[11.5px] text-muted-foreground">
        No devcontainer.json in this workspace.
        <button type="button" className="ml-1 text-primary hover:underline" onClick={() => void addConfig()}>
          Add one
        </button>
      </div>
    );
  const r = dev.resolved;
  const phase = busy ? "starting" : dev.phase;
  const menu = async () => {
    const pick = await quickPick(
      [
        { label: "Rebuild container", value: () => devUp({ rebuild: true }) },
        { label: "Rebuild without cache", value: () => devUp({ rebuild: true, noCache: true }) },
        { label: "Stop", value: () => devStop(false) },
        { label: "Remove container", value: () => devStop(true) },
        { label: "Show log", value: () => app().openFile(LOG_PATH) },
        { label: "Edit devcontainer.json", value: () => app().openFile(dev.configPath!) },
      ],
      { title: r?.name ?? "Dev container" },
    );
    void pick?.();
  };
  return (
    <div className="px-3 py-1.5 text-[12px]">
      <div className="flex items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", phase === "running" ? "bg-emerald-500" : phase === "starting" ? "animate-pulse bg-amber-500" : phase === "error" ? "bg-destructive" : "bg-muted-foreground/40")} />
        <span className="truncate font-medium">{r?.name ?? "Dev container"}</span>
        <span className="text-[11px] text-muted-foreground">{phase === "idle" ? "not created" : phase}</span>
      </div>
      {r && (
        <div className="mt-0.5 truncate pl-3.5 text-[11px] text-muted-foreground" title={r.kind === "compose" ? r.composeFiles.join("\n") : r.image}>
          {r.kind === "compose" ? `compose · ${r.service}` : r.kind === "dockerfile" ? "Dockerfile" : r.image} · {r.workspaceFolder}
          {r.features.length ? ` · ${r.features.length} feature(s)` : ""}
        </div>
      )}
      {dev.error && phase === "error" && <div className="mt-1 line-clamp-3 pl-3.5 text-[11px] text-destructive">{dev.error}</div>}
      <div className="mt-1.5 flex flex-wrap gap-1 pl-3">
        {phase !== "running" ? (
          <button type="button" disabled={busy} className="rounded bg-primary px-2 py-0.5 text-[11.5px] text-primary-foreground disabled:opacity-50" onClick={() => void devUp()}>
            {phase === "stopped" ? "Start" : "Build & start"}
          </button>
        ) : (
          <button type="button" className="rounded bg-primary px-2 py-0.5 text-[11.5px] text-primary-foreground" onClick={() => void devShell()}>
            Terminal
          </button>
        )}
        <button type="button" className={iconBtn} onClick={() => app().openFile(LOG_PATH)}>
          Log
        </button>
        <button type="button" className={iconBtn} onClick={() => void menu()}>
          More…
        </button>
      </div>
      {c && c.ports.some((p) => p.hostPort) && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-3">
          {c.ports
            .filter((p) => p.hostPort)
            .map((p) => (
              <button key={`${p.containerPort}`} type="button" className="rounded border border-border/60 px-1.5 text-[11px] hover:bg-muted" title={`Open http://localhost:${p.hostPort}`} onClick={() => app().openPreview(`http://localhost:${p.hostPort}`)}>
                {r?.ports.includes(p.containerPort) ? "" : "· "}
                {p.containerPort} → {p.hostPort}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function ContainerRow({ c, indent }: { c: ContainerSummary; indent: boolean }) {
  const stats = useContainersStore((s) => s.stats[c.id]);
  const running = c.state === "running";
  const menu = async () => {
    const items: { label: string; detail?: string; value: () => unknown }[] = [
      { label: "Logs", value: () => app().openFile(logsPath(c)) },
      { label: "Inspect", value: () => app().openFile(inspectPath(c)) },
      ...(running
        ? [
            { label: "Open shell", value: () => openShell(c) },
            { label: "Open shell as root", value: () => openShell(c, { user: "root" }) },
            { label: "Restart", value: () => containerAction(c, "restart") },
            { label: "Pause", value: () => containerAction(c, "pause") },
            { label: "Stop", value: () => containerAction(c, "stop") },
          ]
        : c.state === "paused"
          ? [{ label: "Unpause", value: () => containerAction(c, "unpause") }]
          : [{ label: "Start", value: () => containerAction(c, "start") }]),
      ...c.ports.filter((p) => p.hostPort).map((p) => ({ label: `Open localhost:${p.hostPort}`, detail: `container port ${p.containerPort}/${p.proto}`, value: () => app().openPreview(`http://localhost:${p.hostPort}`) })),
      { label: "Copy ID", value: () => navigator.clipboard.writeText(c.id) },
      { label: "Remove", detail: "docker rm -f", value: () => containerAction(c, "rm") },
    ];
    const pick = await quickPick(items, { title: c.name });
    void pick?.();
  };
  return (
    <div
      className={cn("group flex items-center gap-1.5 py-0.5 pr-2 text-[12px] hover:bg-muted/50", indent ? "pl-6" : "pl-3")}
      onContextMenu={(e) => (e.preventDefault(), void menu())}
      onDoubleClick={() => app().openFile(logsPath(c))}
      title={`${c.image}\n${c.status}\n${c.command}`}
    >
      <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[c.state] ?? "bg-muted-foreground/40")} />
      <span className="min-w-0 flex-1 truncate">
        {c.labels["com.docker.compose.service"] ?? c.name}
        {c.labels[LABEL_FOLDER] && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">dev</span>}
        <span className="ml-1.5 text-[11px] text-muted-foreground">{stats ? `${stats.cpu.toFixed(1)}% · ${stats.mem.split(" / ")[0]}` : running ? "" : c.status.replace(/ \(\d+\)/, "")}</span>
      </span>
      <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
        {running ? (
          <>
            <button type="button" className={iconBtn} title="Shell" onClick={() => openShell(c)}>
              ›_
            </button>
            <button type="button" className={iconBtn} title="Stop" onClick={() => void containerAction(c, "stop")}>
              ■
            </button>
          </>
        ) : (
          <button type="button" className={iconBtn} title="Start" onClick={() => void containerAction(c, "start")}>
            ▶
          </button>
        )}
        <button type="button" className={iconBtn} title="More" onClick={() => void menu()}>
          ⋯
        </button>
      </span>
    </div>
  );
}

function ImageRow({ img }: { img: ImageSummary }) {
  const ref = img.repository === "<none>" ? img.id : `${img.repository}:${img.tag}`;
  const menu = async () => {
    const pick = await quickPick(
      [
        { label: "Run interactively", detail: `docker run --rm -it ${ref}`, value: () => app().openTerminal({ command: commandLine(["docker", "run", "--rm", "-it", ref, "/bin/sh"], IS_WINDOWS) }) },
        { label: "Copy name", value: () => navigator.clipboard.writeText(ref) },
        { label: "Remove", value: () => removeImage(img) },
      ],
      { title: ref },
    );
    void pick?.();
  };
  return (
    <div className="group flex items-center gap-1.5 py-0.5 pl-3 pr-2 text-[12px] hover:bg-muted/50" onContextMenu={(e) => (e.preventDefault(), void menu())}>
      <span className="min-w-0 flex-1 truncate">
        {img.repository}
        <span className="text-muted-foreground">:{img.tag}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{img.size}</span>
      <button type="button" className={cn(iconBtn, "opacity-0 group-hover:opacity-100")} onClick={() => void menu()}>
        ⋯
      </button>
    </div>
  );
}

export function ContainersPanel() {
  const available = useContainersStore((s) => s.available);
  const version = useContainersStore((s) => s.version);
  const containers = useContainersStore((s) => s.containers);
  const images = useContainersStore((s) => s.images);
  const [showStopped, setShowStopped] = useState(true);

  useEffect(() => {
    void devProbe();
    void refresh().then(refreshStats);
    // Poll while the view is open and the window is visible.
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh().then(refreshStats);
    }, 5000);
    return () => window.clearInterval(t);
  }, []);

  const groups = groupByCompose(showStopped ? containers : containers.filter((c) => c.state === "running"));
  const running = containers.filter((c) => c.state === "running").length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="text-[11.5px] font-semibold">Containers</span>
        {version && available && <span className="text-[10.5px] text-muted-foreground">Docker {version}</span>}
        <span className="flex-1" />
        <button type="button" className={iconBtn} title="Refresh" onClick={() => void refresh().then(refreshStats)}>
          ⟳
        </button>
        <button type="button" className={iconBtn} title="Prune" onClick={() => void prune()}>
          Prune
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {available === false ? (
          <div className="p-3 text-[11.5px] text-muted-foreground">
            Docker isn't reachable.
            <div className="mt-1 line-clamp-4 text-[11px] text-destructive/80">{version}</div>
            <button type="button" className="mt-2 rounded border border-border/60 px-2 py-0.5 hover:bg-muted" onClick={() => void detect().then((ok) => { if (ok) void refresh(); else toast.error("Still unreachable"); })}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <Section title="Dev container">
              <DevSection />
            </Section>
            <Section
              title="Containers"
              count={containers.length}
              actions={
                <button type="button" className={iconBtn} onClick={() => setShowStopped((x) => !x)}>
                  {showStopped ? `Hide stopped (${containers.length - running})` : "Show stopped"}
                </button>
              }
            >
              {!containers.length && <div className="px-3 py-1 text-[11.5px] text-muted-foreground">{available === null ? "Loading…" : "No containers."}</div>}
              {groups.map((g) =>
                g.project ? (
                  <ComposeGroup key={g.project} project={g.project} workingDir={g.workingDir} containers={g.containers} />
                ) : (
                  g.containers.map((c) => <ContainerRow key={c.id} c={c} indent={false} />)
                ),
              )}
            </Section>
            <Section title="Images" count={images.length} defaultOpen={false}>
              {images.map((img) => (
                <ImageRow key={`${img.id}-${img.repository}-${img.tag}`} img={img} />
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function ComposeGroup({ project, workingDir, containers }: { project: string; workingDir: string | null; containers: ContainerSummary[] }) {
  const [open, setOpen] = useState(true);
  const up = containers.filter((c) => c.state === "running").length;
  const menu = async () => {
    const pick = await quickPick(
      [
        { label: "Start all", value: () => composeAction(project, workingDir, "start") },
        { label: "Restart all", value: () => composeAction(project, workingDir, "restart") },
        { label: "Stop all", value: () => composeAction(project, workingDir, "stop") },
        { label: "Down", detail: "Stop and remove the project's containers and networks", value: () => composeAction(project, workingDir, "down") },
        ...(workingDir ? [{ label: "Open the project folder in a terminal", value: () => app().openTerminal({ cwd: workingDir }) }] : []),
      ],
      { title: `Compose · ${project}` },
    );
    void pick?.();
  };
  return (
    <div>
      <div className="group flex items-center gap-1 py-0.5 pl-2 pr-2 text-[12px] hover:bg-muted/50" onContextMenu={(e) => (e.preventDefault(), void menu())}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => setOpen((o) => !o)}>
          <span className="w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>
          <span className="truncate font-medium">{project}</span>
          <span className="text-[11px] text-muted-foreground">
            {up}/{containers.length}
          </span>
        </button>
        <button type="button" className={cn(iconBtn, "opacity-0 group-hover:opacity-100")} onClick={() => void menu()}>
          ⋯
        </button>
      </div>
      {open && containers.map((c) => <ContainerRow key={c.id} c={c} indent />)}
    </div>
  );
}
