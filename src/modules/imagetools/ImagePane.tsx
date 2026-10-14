// gear-image://<file>: an image's format, size and metadata (with what it
// gives away), resize and convert to PNG / JPEG / WebP, remove metadata,
// pick colours from it, and generate a favicon set.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { openExternalUrl } from "@/lib/external-link";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { copyToClipboard, base64ToBytes, bytesToBase64, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { buildIco, dominantColors, FAVICON_SET, faviconSnippet, fitSize, imageInfo, MIME, readExif, stripJpegMetadata, type Exif, type ImageInfo } from "./model";

const SCHEME = "gear-image://";
const READ_CAP = 64 * 1024 * 1024;

export function openImageFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export async function openImageTools(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const file = await inputBox({ title: "Open an image in the image tools", value: /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|tiff?)$/i.test(current) ? current : "", placeholder: "Path to a PNG, JPEG, WebP, GIF, SVG…" });
  if (file?.trim()) openImageFor(file.trim());
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-background px-1.5 py-0.5 outline-none focus:border-ring";
type OutFormat = "png" | "jpeg" | "webp";
const EXT: Record<OutFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const baseOf = (p: string) => (p.split(/[\\/]/).pop() ?? p).replace(/\.[^.]+$/, "");

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This format cannot be written here."))), type, quality));
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

export const ImagePane = forwardRef<EditorPaneHandle, { path: string }>(function ImagePane({ path }, ref) {
  const file = path.slice(SCHEME.length);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [maxW, setMaxW] = useState("");
  const [maxH, setMaxH] = useState("");
  const [fmt, setFmt] = useState<OutFormat>("webp");
  const [quality, setQuality] = useState(82);
  const [background, setBackground] = useState("#ffffff");
  const [result, setResult] = useState<{ bytes: Uint8Array; width: number; height: number; url: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [favName, setFavName] = useState(() => baseOf(file));
  const [favTheme, setFavTheme] = useState("#ffffff");
  const [favDone, setFavDone] = useState<{ dir: string; html: string; manifest: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sampler = useRef<HTMLCanvasElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await toolsNative.readBytes(file, READ_CAP);
      if (r.truncated) throw new Error(`This image is ${formatBytes(r.size)}; images over ${formatBytes(READ_CAP)} are not opened.`);
      const bytes = base64ToBytes(r.data);
      const info = imageInfo(bytes);
      if (!info) throw new Error("This file is not an image format the image tools know (PNG, JPEG, GIF, WebP, BMP, ICO, SVG, AVIF, TIFF).");
      setData(bytes);
      setError(null);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);
  useEffect(() => void load(), [load]);

  const info: ImageInfo | null = useMemo(() => (data ? imageInfo(data) : null), [data]);
  const exif: Exif | null = useMemo(() => (data ? readExif(data) : null), [data]);

  useEffect(() => {
    if (!data || !info) return;
    const u = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[info.format] }));
    setUrl(u);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      // A small copy to sample colours from.
      const c = document.createElement("canvas");
      c.width = el.naturalWidth || 1;
      c.height = el.naturalHeight || 1;
      c.getContext("2d", { willReadFrequently: true })?.drawImage(el, 0, 0);
      sampler.current = c;
    };
    el.onerror = () => setImg(null);
    el.src = u;
    return () => URL.revokeObjectURL(u);
  }, [data, info]);

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void load(), true) }), [path, load]);

  const palette = useMemo(() => {
    if (!img) return [];
    const c = document.createElement("canvas");
    const s = fitSize(img.naturalWidth || 1, img.naturalHeight || 1, 96, 96);
    c.width = s.width;
    c.height = s.height;
    const ctx = c.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, s.width, s.height);
    return dominantColors(ctx.getImageData(0, 0, s.width, s.height).data, 6);
  }, [img]);

  const width = img?.naturalWidth || info?.width || 0;
  const height = img?.naturalHeight || info?.height || 0;
  const target = fitSize(width || 1, height || 1, Number(maxW) || null, Number(maxH) || null);

  const draw = (w: number, h: number, fill: string | null): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx || !img) throw new Error("The image could not be drawn.");
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  };

  const convert = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const c = draw(target.width, target.height, fmt === "jpeg" ? background : null);
      const blob = await canvasBlob(c, `image/${fmt}`, fmt === "png" ? undefined : quality / 100);
      const bytes = await blobBytes(blob);
      if (result) URL.revokeObjectURL(result.url);
      setResult({ bytes, width: target.width, height: target.height, url: URL.createObjectURL(blob) });
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  const write = async (target: string, bytes: Uint8Array) => {
    await toolsNative.writeBytes(target, bytesToBase64(bytes));
    toast.success(`Saved ${target.split(/[\\/]/).pop()} (${formatBytes(bytes.length)})`);
  };

  const saveResult = async () => {
    if (!result) return;
    const name = `${baseOf(file)}${result.width !== width || result.height !== height ? `-${result.width}w` : ""}.${EXT[fmt]}`;
    const dest = await inputBox({ title: "Save the converted image as", value: `${dirOf(file)}/${name}` });
    if (dest?.trim()) await write(dest.trim(), result.bytes).catch((err) => toast.error(`Could not save: ${String(err)}`));
  };

  const stripMetadata = async () => {
    if (!data || !info) return;
    try {
      let bytes: Uint8Array;
      let note = "";
      if (info.format === "jpeg") {
        const r = stripJpegMetadata(data);
        bytes = r.bytes;
        note = "the picture itself is untouched";
      } else {
        // Re-encoding drops every chunk except the pixels.
        const out: OutFormat = info.format === "webp" ? "webp" : "png";
        bytes = await blobBytes(await canvasBlob(draw(width, height, null), `image/${out}`, out === "webp" ? 0.95 : undefined));
        note = "re-encoded";
      }
      const ext = info.format === "jpeg" ? "jpg" : info.format === "webp" ? "webp" : "png";
      const dest = `${dirOf(file)}/${baseOf(file)}.clean.${ext}`;
      await write(dest, bytes);
      toast.info(`Metadata removed (${note}).`);
    } catch (err) {
      toast.error(`Could not remove metadata: ${String(err)}`);
    }
  };

  const makeFavicons = async () => {
    if (!img) return;
    const root = app().workspaceRoot();
    const suggested = root ? `${root.replace(/[\\/]+$/, "")}/public` : dirOf(file);
    const dir = await inputBox({ title: "Write the favicon files to this folder", value: suggested });
    if (!dir?.trim()) return;
    setBusy(true);
    try {
      // Square: centre-crop the image first.
      const side = Math.min(width, height);
      const square = (size: number) => {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("The image could not be drawn.");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
        return canvasBlob(c, "image/png").then(blobBytes);
      };
      const out = dir.trim().replace(/[\\/]+$/, "");
      for (const f of FAVICON_SET) await toolsNative.writeBytes(`${out}/${f.name}`, bytesToBase64(await square(f.size)));
      const ico = buildIco(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await square(size) }))));
      await toolsNative.writeBytes(`${out}/favicon.ico`, bytesToBase64(ico));
      const snippet = faviconSnippet(favName.trim() || "App", favTheme);
      await toolsNative.writeBytes(`${out}/site.webmanifest`, bytesToBase64(new TextEncoder().encode(snippet.manifest)));
      setFavDone({ dir: out, ...snippet });
      toast.success(`Wrote ${FAVICON_SET.length + 2} files to ${out}`);
    } catch (err) {
      toast.error(`Could not write the favicons: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = (e: React.MouseEvent<HTMLImageElement>) => {
    const c = sampler.current;
    if (!c) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * c.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * c.height);
    const px = c.getContext("2d")?.getImageData(x, y, 1, 1).data;
    if (!px) return;
    const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}${px[3] < 255 ? px[3].toString(16).padStart(2, "0") : ""}`;
    setPicked(hex);
    void copyToClipboard(hex).then(() => toast.success(`Copied ${hex}`));
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500" data-image-error>{error}</div>;
  if (!data || !info) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading…</div>;

  const saving = result ? 1 - result.bytes.length / data.length : 0;

  return (
    <div className="flex h-full overflow-auto text-[12.5px]">
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-4" style={{ backgroundImage: "repeating-conic-gradient(#8881 0% 25%, transparent 0% 50%)", backgroundSize: "16px 16px" }}>
        {url && <img src={result?.url ?? url} alt="" className="max-h-[70vh] max-w-full cursor-crosshair object-contain shadow" onClick={pick} title="Click to pick a colour" data-image-preview />}
        {result && <div className="rounded bg-background/90 px-2 py-0.5 text-muted-foreground">Showing the converted image</div>}
      </div>
      <div className="w-[360px] shrink-0 space-y-4 overflow-auto border-l border-border/60 p-3">
        <section className="space-y-0.5" data-image-info>
          <div className="mb-1 break-all font-medium">{file.split(/[\\/]/).pop()}</div>
          {[
            ["Format", `${info.format.toUpperCase()}${info.animated ? " (animated)" : ""}${info.progressive ? " (progressive)" : ""}`],
            ["Size", width && height ? `${width} × ${height} px` : "unknown"],
            ["File", formatBytes(data.length)],
            ...(width && height ? [["Megapixels", (width * height / 1e6).toFixed(2)], ["Aspect", aspect(width, height)]] : []),
            ...(info.alpha !== undefined ? [["Transparency", info.alpha ? "yes" : "no"]] : []),
            ...(info.bitDepth ? [["Bit depth", String(info.bitDepth)]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{k}</span>
              <span className="text-right">{v}</span>
            </div>
          ))}
        </section>

        {exif && exif.fields.length > 0 && (
          <section className="space-y-0.5" data-image-exif>
            <div className="mb-1 font-medium">Metadata</div>
            {exif.privacy.length > 0 && <div className="mb-1 rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">Gives away: {exif.privacy.join(", ").toLowerCase()}. Remove it before publishing the image.</div>}
            {exif.fields.map((f) => (
              <div key={f.label} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="break-all text-right">{f.value}</span>
              </div>
            ))}
            {exif.gps && (
              <button type="button" className={btn} onClick={() => void openExternalUrl(`https://www.openstreetmap.org/?mlat=${exif.gps?.lat}&mlon=${exif.gps?.lon}#map=16/${exif.gps?.lat}/${exif.gps?.lon}`)}>
                Show the location on a map
              </button>
            )}
          </section>
        )}
        <button type="button" className={btn} data-image-strip disabled={!img && info.format !== "jpeg"} onClick={() => void stripMetadata()} title={info.format === "jpeg" ? "Removes EXIF, XMP and comments without re-encoding" : "Re-encodes the pixels without any metadata"}>
          Save a copy without metadata
        </button>

        <section className="space-y-1.5 border-t border-border/60 pt-3" data-image-convert>
          <div className="font-medium">Resize and convert</div>
          <div className="flex items-center gap-1.5">
            <span className="w-16 text-muted-foreground">Max size</span>
            <input className={cn(field, "w-20")} value={maxW} placeholder={String(width || "")} onChange={(e) => setMaxW(e.target.value.replace(/\D/g, ""))} data-image-maxw />
            <span>×</span>
            <input className={cn(field, "w-20")} value={maxH} placeholder={String(height || "")} onChange={(e) => setMaxH(e.target.value.replace(/\D/g, ""))} />
            <span className="text-muted-foreground">px</span>
          </div>
          <div className="text-muted-foreground">
            Result: {target.width} × {target.height}
          </div>
          <div className="flex items-center gap-1">
            {(["webp", "jpeg", "png"] as OutFormat[]).map((f) => (
              <button key={f} type="button" data-image-format={f} className={cn(btn, fmt === f && "bg-muted font-medium")} onClick={() => setFmt(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {fmt !== "png" && (
            <label className="flex items-center gap-2">
              <span className="w-16 text-muted-foreground">Quality</span>
              <input type="range" min={30} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="flex-1" />
              <span className="w-8 text-right tabular-nums">{quality}</span>
            </label>
          )}
          {fmt === "jpeg" && info.alpha && (
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Fill transparent areas with</span>
              <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
            </label>
          )}
          <div className="flex gap-1.5">
            <button type="button" className={btn} data-image-convert-run disabled={!img || busy} onClick={() => void convert()}>
              Convert
            </button>
            {result && (
              <>
                <button type="button" className={btn} onClick={() => void saveResult()}>
                  Save…
                </button>
                <button type="button" className={btn} onClick={() => (URL.revokeObjectURL(result.url), setResult(null))}>
                  Show original
                </button>
              </>
            )}
          </div>
          {result && (
            <div data-image-result className={cn(saving > 0 ? "text-emerald-600" : "text-amber-600")}>
              {formatBytes(result.bytes.length)} — {saving > 0 ? `${Math.round(saving * 100)}% smaller` : `${Math.round(-saving * 100)}% larger`} than the original
            </div>
          )}
        </section>

        <section className="space-y-1.5 border-t border-border/60 pt-3">
          <div className="font-medium">Colours</div>
          <div className="flex flex-wrap gap-1" data-image-palette>
            {palette.map((c) => (
              <button key={c.hex} type="button" className="flex items-center gap-1 rounded px-1 hover:bg-muted/50" onClick={() => void copyToClipboard(c.hex).then(() => toast.success(`Copied ${c.hex}`))} title={`${Math.round(c.share * 100)}% of the image`}>
                <span className="h-4 w-4 rounded border border-border/60" style={{ background: c.hex }} />
                <span className="font-mono text-[11.5px]">{c.hex}</span>
              </button>
            ))}
          </div>
          <div className="text-muted-foreground">
            Click the image to pick a colour{picked && <span className="ml-1 font-mono text-foreground">{picked}</span>}.
          </div>
        </section>

        <section className="space-y-1.5 border-t border-border/60 pt-3">
          <div className="font-medium">Favicon set</div>
          <div className="text-muted-foreground">PNG icons from 16 to 512 px, a favicon.ico (16, 32, 48) and a web manifest. Non-square images are cropped to the centre.</div>
          <div className="flex items-center gap-1.5">
            <span className="w-16 text-muted-foreground">App name</span>
            <input className={cn(field, "min-w-0 flex-1")} value={favName} onChange={(e) => setFavName(e.target.value)} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-16 text-muted-foreground">Theme</span>
            <input type="color" value={favTheme} onChange={(e) => setFavTheme(e.target.value)} />
          </div>
          <button type="button" className={btn} data-image-favicons disabled={!img || busy} onClick={() => void makeFavicons()}>
            Generate favicons…
          </button>
          {favDone && (
            <div className="space-y-1">
              <div className="text-muted-foreground">Add this to the page &lt;head&gt;:</div>
              <pre className="overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">{favDone.html}</pre>
              <button type="button" className={btn} onClick={() => void copyToClipboard(favDone.html).then(() => toast.success("Copied"))}>
                Copy HTML
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
});

function aspect(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  const r = `${w / g}:${h / g}`;
  return w / g > 50 ? (w / h).toFixed(2) : r;
}

export const IMAGE_ACTIONS = [
  { id: "image.open", label: "Image tools: Open an image (metadata, resize, convert, favicons)…", keywords: ["image", "picture", "photo", "exif", "metadata", "resize", "convert", "webp", "jpeg", "png", "compress", "favicon", "ico", "gps"], run: () => void openImageTools() },
  {
    id: "image.openActive",
    label: "Image tools: Open the current image",
    keywords: ["image", "exif", "resize", "convert", "favicon"],
    run: () => {
      const f = frontFilePath();
      if (f && /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|tiff?)$/i.test(f)) openImageFor(f);
      else void openImageTools();
    },
  },
];
