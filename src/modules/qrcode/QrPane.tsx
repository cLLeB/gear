// gear-qr://: make a QR code from text, a link, Wi-Fi details, a contact or
// an e-mail, and copy or save it as SVG or PNG.

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { bytesToBase64, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { buildPayload, contrastRatio, EMPTY, payloadWarning, suggestName, type Fields, type Kind } from "./payload";
import { byteCapacity, encodeQr, toSvg, type Level, type QrCode } from "./qr";

export const QR_PATH = "gear-qr://QR code";

let seedText = "";

/** Opens the generator; a selection in the editor becomes the text. */
export function openQr(): void {
  const view = getActiveEditor()?.view;
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : "";
  if (sel.trim()) seedText = sel.trim();
  app().openFile(QR_PATH);
}

/** The code drawn on a canvas, for PNG export. */
function toCanvas(qr: QrCode, scale: number, dark: string, light: string, border = 4): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const dim = (qr.size + border * 2) * scale;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = dark;
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
  return canvas;
}

function pngBytes(canvas: HTMLCanvasElement): Uint8Array {
  const b64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "w-full rounded border border-border/60 bg-background px-2 py-1 text-[12.5px] outline-none focus:border-ring";
const KINDS: { id: Kind; label: string }[] = [
  { id: "text", label: "Text or link" },
  { id: "wifi", label: "Wi-Fi" },
  { id: "contact", label: "Contact" },
  { id: "email", label: "E-mail" },
];
const LEVELS: { id: Level; hint: string }[] = [
  { id: "L", hint: "7% of the code can be damaged" },
  { id: "M", hint: "15%" },
  { id: "Q", hint: "25%" },
  { id: "H", hint: "30% — best for print" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export const QrPane = forwardRef<EditorPaneHandle, { path: string }>(function QrPane({ path }, ref) {
  const [kind, setKind] = useState<Kind>("text");
  const [f, setF] = useState<Fields>(() => ({ ...EMPTY, text: seedText || "https://example.org" }));
  const [level, setLevel] = useState<Level>("M");
  const [dark, setDark] = useState("#000000");
  const [light, setLight] = useState("#ffffff");
  const [scale, setScale] = useState(10);
  const patch = (p: Partial<Fields>) => setF({ ...f, ...p });

  const payload = useMemo(() => buildPayload(kind, f), [kind, f]);
  const qr = useMemo(() => (payload ? encodeQr(payload, level) : null), [payload, level]);
  const svg = useMemo(() => (qr ? toSvg(qr, { dark, light }) : ""), [qr, dark, light]);
  const bytes = useMemo(() => new TextEncoder().encode(payload).length, [payload]);
  const warning = payloadWarning(kind, f);
  const contrast = contrastRatio(dark, light);

  useImperativeHandle(ref, () => toolPaneHandle(path, { getSelection: () => payload }), [path, payload]);

  const save = async (ext: "svg" | "png") => {
    if (!qr) return;
    const root = app().workspaceRoot();
    if (!root) return void toast.error("Open a folder first.");
    const file = `${root.replace(/[\\/]+$/, "")}/${suggestName(kind, f)}.${ext}`;
    try {
      if (ext === "svg") await native.writeFile(file, svg, "user");
      else await toolsNative.writeBytes(file, bytesToBase64(pngBytes(toCanvas(qr, scale, dark, light))));
      toast.success(`Saved ${file.split("/").pop()}`);
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    }
  };

  const copyPng = async () => {
    if (!qr) return;
    try {
      const blob = await new Promise<Blob | null>((res) => toCanvas(qr, scale, dark, light).toBlob(res, "image/png"));
      if (!blob) throw new Error("could not draw the image");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Image copied");
    } catch (err) {
      toast.error(`Could not copy the image: ${String(err)}`);
    }
  };

  return (
    <div className="flex h-full text-[12.5px]">
      <div className="w-[380px] shrink-0 space-y-2 overflow-auto border-r border-border/60 p-3">
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button key={k.id} type="button" data-kind={k.id} className={cn(btn, kind === k.id && "bg-muted font-medium")} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        {kind === "text" && (
          <Row label="Text or link">
            <textarea className={cn(field, "h-[120px] resize-y font-mono")} data-qr-text spellCheck={false} value={f.text} onChange={(e) => patch({ text: e.target.value })} />
          </Row>
        )}
        {kind === "wifi" && (
          <>
            <Row label="Network name">
              <input className={field} data-qr-ssid value={f.ssid} onChange={(e) => patch({ ssid: e.target.value })} />
            </Row>
            <Row label="Security">
              <select className={field} value={f.security} onChange={(e) => patch({ security: e.target.value as Fields["security"] })}>
                <option value="WPA">WPA / WPA2 / WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">None (open network)</option>
              </select>
            </Row>
            {f.security !== "nopass" && (
              <Row label="Password">
                <input className={cn(field, "font-mono")} data-qr-password value={f.password} onChange={(e) => patch({ password: e.target.value })} />
              </Row>
            )}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.hidden} onChange={(e) => patch({ hidden: e.target.checked })} />
              Hidden network
            </label>
          </>
        )}
        {kind === "contact" && (
          <>
            <Row label="Name">
              <input className={field} data-qr-name value={f.name} onChange={(e) => patch({ name: e.target.value })} />
            </Row>
            <Row label="Phone">
              <input className={field} value={f.phone} onChange={(e) => patch({ phone: e.target.value })} />
            </Row>
            <Row label="E-mail">
              <input className={field} value={f.mail} onChange={(e) => patch({ mail: e.target.value })} />
            </Row>
            <Row label="Organisation">
              <input className={field} value={f.org} onChange={(e) => patch({ org: e.target.value })} />
            </Row>
            <Row label="Website">
              <input className={field} value={f.url} onChange={(e) => patch({ url: e.target.value })} />
            </Row>
          </>
        )}
        {kind === "email" && (
          <>
            <Row label="To">
              <input className={field} data-qr-to value={f.to} onChange={(e) => patch({ to: e.target.value })} />
            </Row>
            <Row label="Subject">
              <input className={field} value={f.subject} onChange={(e) => patch({ subject: e.target.value })} />
            </Row>
            <Row label="Message">
              <textarea className={cn(field, "h-[80px] resize-y")} value={f.body} onChange={(e) => patch({ body: e.target.value })} />
            </Row>
          </>
        )}
        {warning && <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-600">{warning}</div>}
        <Row label="Error correction">
          <div className="flex gap-1">
            {LEVELS.map((l) => (
              <button key={l.id} type="button" data-level={l.id} className={cn(btn, level === l.id && "bg-muted font-medium")} title={l.hint} onClick={() => setLevel(l.id)}>
                {l.id}
              </button>
            ))}
            <span className="self-center text-muted-foreground">{LEVELS.find((l) => l.id === level)?.hint}</span>
          </div>
        </Row>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <input type="color" value={dark} onChange={(e) => setDark(e.target.value)} />
            Code
          </label>
          <label className="flex items-center gap-1.5">
            <input type="color" value={light} onChange={(e) => setLight(e.target.value)} />
            Background
          </label>
          <label className="flex items-center gap-1.5" title="Pixels per module in the PNG">
            PNG scale
            <input className="w-[52px] rounded border border-border/60 bg-background px-1 py-0.5" type="number" min={2} max={40} value={scale} onChange={(e) => setScale(Math.max(2, Math.min(40, Number(e.target.value) || 10)))} />
          </label>
        </div>
        {contrast < 4 && <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-600">These two colours are too close for many scanners. Use a dark code on a light background.</div>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-auto p-4">
        {qr ? (
          <>
            <div className="w-full max-w-[420px] rounded-md border border-border/60 bg-white p-2" data-qr-svg dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="text-muted-foreground" data-qr-info>
              Version {qr.version} ({qr.size}×{qr.size}) · level {qr.level} · {bytes} of {byteCapacity(qr.version, level)} bytes
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              <button type="button" className={btn} onClick={() => void copyPng()}>
                Copy image
              </button>
              <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(svg).then(() => toast.success("SVG copied"))}>
                Copy SVG
              </button>
              <button type="button" className={btn} onClick={() => void save("png")}>
                Save PNG
              </button>
              <button type="button" className={btn} onClick={() => void save("svg")}>
                Save SVG
              </button>
            </div>
            <pre className="w-full max-w-[520px] overflow-auto whitespace-pre-wrap break-all rounded border border-border/60 p-2 font-mono text-[11.5px] text-muted-foreground" data-qr-payload>
              {payload}
            </pre>
          </>
        ) : (
          <div className="p-6 text-muted-foreground" data-qr-empty>
            {payload ? `That is too much for one QR code at level ${level} (${bytes.toLocaleString()} bytes; the limit is ${byteCapacity(40, level).toLocaleString()}). Shorten it or lower the error correction.` : "Fill in the fields on the left."}
          </div>
        )}
      </div>
    </div>
  );
});

export const QR_ACTIONS = [{ id: "qr.open", label: "QR code: Make a QR code", keywords: ["qr", "qrcode", "barcode", "wifi", "link", "share", "scan", "vcard"], run: openQr }];
