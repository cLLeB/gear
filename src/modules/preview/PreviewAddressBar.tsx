import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  Globe02Icon,
  LinkSquare02Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DEVICES, type Device, ZOOM_STEPS } from "./lib/nativeBrowser";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type PortPreset = {
  port: number;
  label: string;
  hint: string;
};

// Curated dev-server ports. Ordered by frontend frequency, then backend.
const PORT_PRESETS: readonly PortPreset[] = [
  { port: 5173, label: "Vite", hint: "vite, sveltekit" },
  { port: 5174, label: "Vite (alt)", hint: "second vite instance" },
  { port: 3000, label: "Next.js", hint: "next, express, rails" },
  { port: 3001, label: "Next.js (alt)", hint: "second next instance" },
  { port: 4173, label: "Vite preview", hint: "vite preview" },
  { port: 4200, label: "Angular", hint: "angular cli" },
  { port: 4321, label: "Astro", hint: "astro" },
  { port: 5500, label: "Live Server", hint: "vscode live server" },
  { port: 6006, label: "Storybook", hint: "storybook" },
  { port: 8080, label: "Webpack", hint: "webpack, vue cli" },
  { port: 8081, label: "Metro", hint: "react native metro" },
  { port: 8000, label: "Django / FastAPI", hint: "django, fastapi" },
  { port: 8888, label: "Jupyter", hint: "jupyter notebook" },
  { port: 5000, label: "Flask", hint: "flask" },
  { port: 7860, label: "Gradio", hint: "gradio" },
  { port: 11434, label: "Ollama", hint: "ollama api" },
];

export type PreviewAddressBarHandle = {
  focus: () => void;
};

type Props = {
  url: string;
  onSubmit: (url: string) => void;
  onReload: () => void;
  /** Native view controls; absent until a page is open. */
  nav?: {
    loading: boolean;
    onBack: () => void;
    onForward: () => void;
    onStop: () => void;
    onDevtools: () => void;
    zoom: number;
    onZoom: (z: number) => void;
    device: Device;
    onDevice: (d: Device) => void;
  };
};

export const PreviewAddressBar = forwardRef<PreviewAddressBarHandle, Props>(
  function PreviewAddressBar({ url, onSubmit, onReload, nav }, ref) {
    const [draft, setDraft] = useState(url);
    const inputRef = useRef<HTMLInputElement>(null);

    // Keep draft in sync when the parent updates the URL externally
    // (AI tool, detected localhost chip, etc.).
    useEffect(() => {
      setDraft(url);
    }, [url]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.select();
        },
      }),
      [],
    );

    const [notice, setNotice] = useState<string | null>(null);
    const [checkingPort, setCheckingPort] = useState<number | null>(null);

    const submit = () => {
      const next = normalizeUrl(draft);
      if (!next) {
        setNotice("Enter a URL or pick a port preset.");
        return;
      }
      setNotice(null);
      if (next !== url) onSubmit(next);
      else onReload();
    };

    const tryPort = async (port: number) => {
      setNotice(null);
      setCheckingPort(port);
      const url = `http://localhost:${port}`;
      const ok = await probeUrl(url);
      setCheckingPort(null);
      if (!ok) {
        setNotice(`No server listening on :${port}.`);
        return;
      }
      setDraft(url);
      onSubmit(url);
    };

    return (
      <div className="shrink-0 border-b border-border/60">
      <div className="flex h-9 items-center gap-1 bg-card/40 px-1.5">
        {nav && (
          <>
            <Button type="button" variant="ghost" size="icon" onClick={nav.onBack} title="Back" data-browser-back className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={nav.onForward} title="Forward" data-browser-forward className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={nav?.loading ? nav.onStop : onReload}
          title={nav?.loading ? "Stop loading" : "Reload"}
          data-browser-reload={nav?.loading ? "stop" : "reload"}
          className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon
            icon={nav?.loading ? Cancel01Icon : ArrowReloadHorizontalIcon}
            size={14}
            strokeWidth={1.75}
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Common dev-server ports"
              className="h-7 shrink-0 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                icon={Globe02Icon}
                size={13}
                strokeWidth={1.75}
              />
              <span className="hidden sm:inline">Ports</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-80 min-w-56 overflow-y-auto"
          >
            {PORT_PRESETS.map((p) => (
              <DropdownMenuItem
                key={p.port}
                onSelect={(e) => {
                  e.preventDefault();
                  void tryPort(p.port);
                }}
              >
                <span className="flex-1">{p.label}</span>
                <span className="text-xs text-muted-foreground">
                  {checkingPort === p.port ? "checking…" : `:${p.port}`}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex min-w-0 flex-1 items-center">
          <Input
            ref={inputRef}
            value={draft}
            placeholder="http://localhost:3000"
            spellCheck={false}
            autoComplete="off"
            className="h-7 w-full bg-muted/60 px-2 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-0"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(url);
                inputRef.current?.blur();
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            if (url) void openUrl(url).catch(console.error);
          }}
          title="Open in system browser"
          className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={!url}
        >
          <HugeiconsIcon
            icon={LinkSquare02Icon}
            size={14}
            strokeWidth={1.75}
          />
        </Button>
        {nav && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" title="Page options" data-browser-menu className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <HugeiconsIcon icon={Settings02Icon} size={14} strokeWidth={1.75} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">Page zoom: {Math.round(nav.zoom * 100)}%</DropdownMenuLabel>
              <div className="flex items-center gap-1 px-2 pb-1.5">
                {[
                  { label: "−", z: ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(nav.zoom) - 1)] ?? 1 },
                  { label: "100%", z: 1 },
                  { label: "+", z: ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(nav.zoom) + 1)] ?? 1 },
                ].map((b) => (
                  <button key={b.label} type="button" className="flex-1 rounded border border-border/60 py-0.5 text-[11px] hover:bg-accent" onClick={() => nav.onZoom(b.z)}>
                    {b.label}
                  </button>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">Viewport</DropdownMenuLabel>
              {DEVICES.map((d) => (
                <DropdownMenuItem key={d.id} onSelect={() => nav.onDevice(d)} data-browser-device={d.id}>
                  <span className="flex-1">{d.label}</span>
                  {nav.device.id === d.id && <span className="text-xs text-muted-foreground">✓</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(url).catch(() => {})} disabled={!url}>
                Copy page address
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={nav.onDevtools} data-browser-devtools>
                Inspect page (developer tools)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {notice ? (
        <div className="flex items-center gap-1.5 bg-amber-500/8 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-400">
          <span className="truncate">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-auto rounded px-1 text-[10px] opacity-80 hover:bg-accent hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      </div>
    );
  },
);

async function probeUrl(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(900),
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}
