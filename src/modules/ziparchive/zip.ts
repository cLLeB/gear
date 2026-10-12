// Reading zip archives (also .jar, .apk, .docx, .xlsx, .epub, .vsix…): the
// central directory, and the bytes of one entry (stored or deflated).

export interface Entry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  dir: boolean;
  size: number;
  compressedSize: number;
  /** 0 = stored, 8 = deflate; anything else cannot be extracted here. */
  method: number;
  crc: number;
  modified: Date;
  encrypted: boolean;
  /** Offset of the entry's local header. */
  offset: number;
}

export interface Archive {
  entries: Entry[];
  comment: string;
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

function dosDate(date: number, time: number): Date {
  return new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0x0f) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

const CP437_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // Without the UTF-8 flag the name is officially code page 437, but many tools write UTF-8 anyway.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let s = "";
    for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    return s;
  }
}

/** Reads the list of entries. Throws with a plain message when the file is not a usable zip. */
export function readArchive(bytes: Uint8Array): Archive {
  // The end-of-central-directory record sits at the end, before an optional comment of up to 64 KiB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50 && i + 22 + u16(bytes, i + 20) <= bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a zip archive (no directory found at the end of the file).");
  const total = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error("This archive uses the Zip64 format (very large or with more than 65,535 files), which is not supported here.");
  if (cdOffset + cdSize > eocd) throw new Error("The archive's directory is damaged or the file is incomplete.");
  const comment = decodeName(bytes.subarray(eocd + 22, eocd + 22 + u16(bytes, eocd + 20)), false);
  const entries: Entry[] = [];
  let at = cdOffset;
  for (let i = 0; i < total; i++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) throw new Error("The archive's directory is damaged.");
    const flags = u16(bytes, at + 8);
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const name = decodeName(bytes.subarray(at + 46, at + 46 + nameLen), (flags & 0x800) !== 0).replace(/\\/g, "/");
    entries.push({
      name,
      dir: name.endsWith("/"),
      size: u32(bytes, at + 24),
      compressedSize: u32(bytes, at + 20),
      method: u16(bytes, at + 10),
      crc: u32(bytes, at + 16),
      modified: dosDate(u16(bytes, at + 14), u16(bytes, at + 12)),
      encrypted: (flags & 1) !== 0,
      offset: u32(bytes, at + 42),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, comment };
}

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The uncompressed bytes of one entry, checked against its CRC. */
export async function extract(bytes: Uint8Array, entry: Entry): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error("This entry is password-protected.");
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`This entry uses a compression method (${entry.method}) that cannot be read here.`);
  const at = entry.offset;
  if (at + 30 > bytes.length || u32(bytes, at) !== 0x04034b50) throw new Error("The archive is damaged at this entry.");
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (raw.length !== entry.compressedSize) throw new Error("The archive is cut short at this entry.");
  const out = entry.method === 0 ? raw.slice() : await inflateRaw(raw);
  if (out.length !== entry.size || crc32(out) !== entry.crc) throw new Error("This entry is damaged (its checksum does not match).");
  return out;
}

/** True when the bytes look like text worth showing (no NULs, valid UTF-8). */
export function isText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8000);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 64000));
    return true;
  } catch {
    // A multi-byte character may be cut at the sample's end; only fail on a clearly binary sample.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.max(0, Math.min(bytes.length, 64000) - 4)));
      return true;
    } catch {
      return false;
    }
  }
}

export interface Row {
  entry: Entry | null;
  /** Full path of this row inside the archive (no trailing slash). */
  path: string;
  name: string;
  depth: number;
  dir: boolean;
  /** Total uncompressed size (folders: of everything inside). */
  size: number;
  compressedSize: number;
  files: number;
}

/**
 * The archive as an indented tree, folders first. Folders that the archive
 * does not list explicitly are still shown. `collapsed` holds folder paths.
 */
export function treeRows(entries: Entry[], collapsed: Set<string> = new Set(), filter = ""): Row[] {
  interface Node {
    name: string;
    path: string;
    entry: Entry | null;
    children: Map<string, Node>;
    dir: boolean;
    size: number;
    compressedSize: number;
    files: number;
  }
  const root: Node = { name: "", path: "", entry: null, children: new Map(), dir: true, size: 0, compressedSize: 0, files: 0 };
  const q = filter.trim().toLowerCase();
  for (const e of entries) {
    if (q && !e.name.toLowerCase().includes(q)) continue;
    const parts = e.name.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join("/"), entry: null, children: new Map(), dir: !last || e.dir, size: 0, compressedSize: 0, files: 0 };
        node.children.set(part, child);
      }
      if (last) child.entry = e;
      if (!e.dir) {
        child.size += e.size;
        child.compressedSize += e.compressedSize;
        child.files += 1;
      }
      node = child;
    });
    if (!e.dir) {
      root.size += e.size;
      root.files += 1;
    }
  }
  const out: Row[] = [];
  const walk = (node: Node, depth: number) => {
    const kids = [...node.children.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    for (const k of kids) {
      out.push({ entry: k.entry, path: k.path, name: k.name, depth, dir: k.dir, size: k.size, compressedSize: k.compressedSize, files: k.files });
      // While filtering, everything that matched stays visible.
      if (k.dir && (q || !collapsed.has(k.path))) walk(k, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export function totals(entries: Entry[]): { files: number; size: number; compressedSize: number; ratio: number } {
  const files = entries.filter((e) => !e.dir);
  const size = files.reduce((a, e) => a + e.size, 0);
  const compressedSize = files.reduce((a, e) => a + e.compressedSize, 0);
  return { files: files.length, size, compressedSize, ratio: size ? 1 - compressedSize / size : 0 };
}

/**
 * Where an entry may be written when extracting: its path under `dest`, or
 * null when the name tries to escape (`../`, an absolute path, a drive letter).
 */
export function safeTarget(dest: string, name: string): string | null {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.includes("..") || /^[a-z]:$/i.test(parts[0]) || name.startsWith("/") || name.startsWith("\\")) return null;
  if (parts.some((p) => /[<>:"|?*]/.test(p) || p.split("").some((ch) => ch.charCodeAt(0) < 32))) return null;
  return `${dest.replace(/[\\/]+$/, "")}/${parts.join("/")}`;
}
