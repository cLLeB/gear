// X.509 certificates without a library: a DER reader, the fields people
// look at (names, validity, key, SANs, usages, issuer links), and checks a
// browser would fail on, in plain words.

interface Node {
  tag: number;
  /** Start of the value. */
  start: number;
  end: number;
  /** Start of the whole element (header included). */
  head: number;
  constructed: boolean;
}

function readNode(b: Uint8Array, at: number): Node {
  if (at + 2 > b.length) throw new Error("The certificate is cut short.");
  const tag = b[at];
  let len = b[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("Unsupported length in the certificate.");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i];
    start += n;
  }
  if (start + len > b.length) throw new Error("The certificate is cut short.");
  return { tag, start, end: start + len, head: at, constructed: (tag & 0x20) !== 0 };
}

function children(b: Uint8Array, n: Node): Node[] {
  const out: Node[] = [];
  for (let at = n.start; at < n.end; ) {
    const c = readNode(b, at);
    out.push(c);
    at = c.end;
  }
  return out;
}

export function oidString(b: Uint8Array, n: Node): string {
  const parts: number[] = [];
  let v = 0;
  for (let i = n.start; i < n.end; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      if (!parts.length) parts.push(v < 80 ? Math.floor(v / 40) : 2, v < 80 ? v % 40 : v - 80);
      else parts.push(v);
      v = 0;
    }
  }
  return parts.join(".");
}

const text = (b: Uint8Array, n: Node) => (n.tag === 0x1e ? String.fromCharCode(...Array.from({ length: (n.end - n.start) / 2 }, (_, i) => (b[n.start + i * 2] << 8) | b[n.start + i * 2 + 1])) : new TextDecoder().decode(b.subarray(n.start, n.end)));
const hex = (bytes: Uint8Array) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");

function time(b: Uint8Array, n: Node): Date {
  const s = text(b, n);
  // UTCTime YYMMDDHHMMSSZ, GeneralizedTime YYYYMMDDHHMMSSZ
  const m = n.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(s);
  if (!m) throw new Error(`Unreadable date in the certificate: ${s}`);
  let year = Number(m[1]);
  if (n.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)));
}

const NAME_ATTR: Record<string, string> = { "2.5.4.3": "CN", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.5": "serialNumber", "1.2.840.113549.1.9.1": "emailAddress", "2.5.4.97": "organizationIdentifier", "0.9.2342.19200300.100.1.25": "DC" };

export const SIG_ALG: Record<string, string> = {
  "1.2.840.113549.1.1.4": "MD5 with RSA",
  "1.2.840.113549.1.1.5": "SHA-1 with RSA",
  "1.2.840.113549.1.1.10": "RSA-PSS",
  "1.2.840.113549.1.1.11": "SHA-256 with RSA",
  "1.2.840.113549.1.1.12": "SHA-384 with RSA",
  "1.2.840.113549.1.1.13": "SHA-512 with RSA",
  "1.2.840.10045.4.1": "ECDSA with SHA-1",
  "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
  "1.2.840.10045.4.3.3": "ECDSA with SHA-384",
  "1.2.840.10045.4.3.4": "ECDSA with SHA-512",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
};
const CURVES: Record<string, { name: string; bits: number }> = { "1.2.840.10045.3.1.7": { name: "P-256", bits: 256 }, "1.3.132.0.34": { name: "P-384", bits: 384 }, "1.3.132.0.35": { name: "P-521", bits: 521 } };
const EKU: Record<string, string> = { "1.3.6.1.5.5.7.3.1": "Server authentication", "1.3.6.1.5.5.7.3.2": "Client authentication", "1.3.6.1.5.5.7.3.3": "Code signing", "1.3.6.1.5.5.7.3.4": "Email protection", "1.3.6.1.5.5.7.3.8": "Time stamping", "1.3.6.1.5.5.7.3.9": "OCSP signing", "2.5.29.37.0": "Any purpose" };
const KEY_USAGE = ["Digital signature", "Non-repudiation", "Key encipherment", "Data encipherment", "Key agreement", "Certificate signing", "CRL signing", "Encipher only", "Decipher only"];
const POLICY: Record<string, string> = { "2.23.140.1.1": "Extended validation (EV)", "2.23.140.1.2.1": "Domain validated (DV)", "2.23.140.1.2.2": "Organization validated (OV)", "2.23.140.1.2.3": "Individual validated (IV)" };

export interface Name {
  /** Readable one-line form, like `CN=example.com, O=Example, C=US`. */
  text: string;
  attrs: { key: string; value: string }[];
  cn: string | null;
  org: string | null;
}

export interface Certificate {
  der: Uint8Array;
  version: number;
  serial: string;
  signatureAlgorithm: string;
  issuer: Name;
  subject: Name;
  notBefore: Date;
  notAfter: Date;
  key: { type: "RSA" | "EC" | "Ed25519" | "Ed448" | "Other"; bits: number; curve?: string };
  sans: { dns: string[]; ip: string[]; email: string[]; uri: string[] };
  isCa: boolean;
  pathLength: number | null;
  keyUsage: string[];
  extendedKeyUsage: string[];
  ocsp: string[];
  caIssuers: string[];
  crl: string[];
  policies: string[];
  /** Number of embedded Certificate Transparency timestamps (approximate: 0 or more). */
  hasSct: boolean;
  selfSigned: boolean;
}

function parseName(b: Uint8Array, n: Node): Name {
  const attrs: { key: string; value: string }[] = [];
  for (const rdn of children(b, n)) {
    for (const atv of children(b, rdn)) {
      const [oid, val] = children(b, atv);
      const k = oidString(b, oid);
      attrs.push({ key: NAME_ATTR[k] ?? k, value: text(b, val) });
    }
  }
  // Conventionally shown most specific first.
  const shown = [...attrs].reverse();
  return { text: shown.map((a) => `${a.key}=${a.value}`).join(", "), attrs, cn: attrs.filter((a) => a.key === "CN").slice(-1)[0]?.value ?? null, org: attrs.find((a) => a.key === "O")?.value ?? null };
}

function ipText(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");
  if (bytes.length === 16) {
    const groups = Array.from({ length: 8 }, (_, i) => ((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16));
    return groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::").replace(/:{3,}/, "::");
  }
  return hex(bytes);
}

export function parseCertificate(der: Uint8Array): Certificate {
  const root = readNode(der, 0);
  const [tbsNode, sigAlgNode] = children(der, root);
  const tbs = children(der, tbsNode);
  let i = 0;
  let version = 1;
  if (tbs[0].tag === 0xa0) {
    const v = children(der, tbs[0])[0];
    version = der[v.start] + 1;
    i++;
  }
  const serialNode = tbs[i++];
  i++; // inner signature algorithm
  const issuerNode = tbs[i++];
  const validity = children(der, tbs[i++]);
  const subjectNode = tbs[i++];
  const spki = tbs[i++];
  const cert: Certificate = {
    der,
    version,
    serial: hex(der.subarray(serialNode.start, serialNode.end)).replace(/^00(?=[89a-f])/, "").toUpperCase(),
    signatureAlgorithm: (() => {
      const oid = oidString(der, children(der, sigAlgNode)[0]);
      return SIG_ALG[oid] ?? oid;
    })(),
    issuer: parseName(der, issuerNode),
    subject: parseName(der, subjectNode),
    notBefore: time(der, validity[0]),
    notAfter: time(der, validity[1]),
    key: { type: "Other", bits: 0 },
    sans: { dns: [], ip: [], email: [], uri: [] },
    isCa: false,
    pathLength: null,
    keyUsage: [],
    extendedKeyUsage: [],
    ocsp: [],
    caIssuers: [],
    crl: [],
    policies: [],
    hasSct: false,
    selfSigned: false,
  };
  // Key
  const [algSeq, keyBits] = children(der, spki);
  const alg = children(der, algSeq);
  const keyOid = oidString(der, alg[0]);
  if (keyOid === "1.2.840.113549.1.1.1") {
    const rsa = readNode(der, keyBits.start + 1);
    const modulus = children(der, rsa)[0];
    let len = modulus.end - modulus.start;
    if (der[modulus.start] === 0) len--;
    cert.key = { type: "RSA", bits: len * 8 };
  } else if (keyOid === "1.2.840.10045.2.1") {
    const curve = alg[1] && alg[1].tag === 0x06 ? CURVES[oidString(der, alg[1])] : undefined;
    cert.key = { type: "EC", bits: curve?.bits ?? 0, curve: curve?.name ?? "unknown curve" };
  } else if (keyOid === "1.3.101.112") cert.key = { type: "Ed25519", bits: 256 };
  else if (keyOid === "1.3.101.113") cert.key = { type: "Ed448", bits: 456 };
  // Extensions
  const extWrap = tbs.slice(i).find((n) => n.tag === 0xa3);
  if (extWrap) {
    for (const ext of children(der, children(der, extWrap)[0])) {
      const parts = children(der, ext);
      const oid = oidString(der, parts[0]);
      const value = parts[parts.length - 1];
      const inner = () => readNode(der, value.start);
      try {
        switch (oid) {
          case "2.5.29.17":
            for (const g of children(der, inner())) {
              const v = der.subarray(g.start, g.end);
              if (g.tag === 0x82) cert.sans.dns.push(new TextDecoder().decode(v));
              else if (g.tag === 0x87) cert.sans.ip.push(ipText(v));
              else if (g.tag === 0x81) cert.sans.email.push(new TextDecoder().decode(v));
              else if (g.tag === 0x86) cert.sans.uri.push(new TextDecoder().decode(v));
            }
            break;
          case "2.5.29.19": {
            const bc = children(der, inner());
            for (const c of bc) {
              if (c.tag === 0x01) cert.isCa = der[c.start] !== 0;
              if (c.tag === 0x02) cert.pathLength = der[c.start];
            }
            break;
          }
          case "2.5.29.15": {
            const bits = inner();
            const unused = der[bits.start];
            const bytes = der.subarray(bits.start + 1, bits.end);
            KEY_USAGE.forEach((name, bit) => {
              const byte = bytes[bit >> 3] ?? 0;
              if (byte & (0x80 >> (bit & 7)) && !(bit >> 3 === bytes.length - 1 && 7 - (bit & 7) < unused)) cert.keyUsage.push(name);
            });
            break;
          }
          case "2.5.29.37":
            for (const o of children(der, inner())) {
              const s = oidString(der, o);
              cert.extendedKeyUsage.push(EKU[s] ?? s);
            }
            break;
          case "1.3.6.1.5.5.7.1.1":
            for (const ad of children(der, inner())) {
              const [m, loc] = children(der, ad);
              const url = new TextDecoder().decode(der.subarray(loc.start, loc.end));
              const method = oidString(der, m);
              if (method === "1.3.6.1.5.5.7.48.1") cert.ocsp.push(url);
              else if (method === "1.3.6.1.5.5.7.48.2") cert.caIssuers.push(url);
            }
            break;
          case "2.5.29.31": {
            // Pull every URI out of the distribution points.
            const walk = (n: Node) => {
              if (n.tag === 0x86) cert.crl.push(new TextDecoder().decode(der.subarray(n.start, n.end)));
              else if (n.constructed) for (const c of children(der, n)) walk(c);
            };
            walk(inner());
            break;
          }
          case "2.5.29.32":
            for (const p of children(der, inner())) {
              const s = oidString(der, children(der, p)[0]);
              cert.policies.push(POLICY[s] ?? s);
            }
            break;
          case "1.3.6.1.4.1.11129.2.4.2":
            cert.hasSct = true;
            break;
        }
      } catch {
        // An extension we cannot read is left out rather than failing the certificate.
      }
    }
  }
  cert.selfSigned = cert.issuer.text === cert.subject.text;
  return cert;
}

/** DER blocks from PEM text (one or more `-----BEGIN CERTIFICATE-----`). */
export function pemToDer(pem: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const m of pem.matchAll(/-----BEGIN (?:TRUSTED |X509 )?CERTIFICATE-----([\s\S]*?)-----END (?:TRUSTED |X509 )?CERTIFICATE-----/g)) {
    const bin = atob(m[1].replace(/[^A-Za-z0-9+/=]/g, ""));
    out.push(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return out;
}

export function derToPem(der: Uint8Array): string {
  let s = "";
  for (let i = 0; i < der.length; i += 0x8000) s += String.fromCharCode(...der.subarray(i, i + 0x8000));
  const b64 = btoa(s).replace(/.{64}/g, "$&\n").trim();
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

export async function fingerprint(der: Uint8Array, algo: "SHA-256" | "SHA-1" = "SHA-256"): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest(algo, der as BufferSource));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/** Whether a certificate covers a host name, by the rules browsers use (one wildcard label, leftmost only). */
export function matchesHost(cert: Certificate, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(h) || h.includes(":")) return cert.sans.ip.includes(h.replace(/^\[|\]$/g, ""));
  const names = cert.sans.dns.length ? cert.sans.dns : cert.subject.cn ? [cert.subject.cn] : [];
  return names.some((n) => {
    const name = n.toLowerCase().replace(/\.$/, "");
    if (name === h) return true;
    if (name.startsWith("*.")) {
      const rest = name.slice(2);
      const dot = h.indexOf(".");
      return dot > 0 && h.slice(dot + 1) === rest && rest.includes(".");
    }
    return false;
  });
}

export type Severity = "error" | "warning" | "info" | "ok";

export interface Finding {
  severity: Severity;
  message: string;
}

const DAY = 86400000;

export function daysLeft(cert: Certificate, now = Date.now()): number {
  return Math.floor((cert.notAfter.getTime() - now) / DAY);
}

/** Problems with a chain as a browser sees them; `host` is checked against the leaf when given. */
export function checkChain(chain: Certificate[], host: string | null, now = Date.now()): Finding[] {
  const out: Finding[] = [];
  if (!chain.length) return [{ severity: "error", message: "The server sent no certificate." }];
  const leaf = chain[0];
  const left = daysLeft(leaf, now);
  if (leaf.notBefore.getTime() > now) out.push({ severity: "error", message: `Not valid yet: it starts on ${leaf.notBefore.toISOString().slice(0, 10)}. Check the server's clock too.` });
  if (left < 0) out.push({ severity: "error", message: `Expired ${-left} day${left === -1 ? "" : "s"} ago, on ${leaf.notAfter.toISOString().slice(0, 10)}.` });
  else if (left < 14) out.push({ severity: "warning", message: `Expires in ${left} day${left === 1 ? "" : "s"}. Renew it now.` });
  else if (left < 30) out.push({ severity: "info", message: `Expires in ${left} days.` });
  if (host && !matchesHost(leaf, host)) out.push({ severity: "error", message: `Not valid for ${host}. It covers: ${[...leaf.sans.dns, ...leaf.sans.ip].join(", ") || leaf.subject.cn || "no names"}.` });
  if (!leaf.sans.dns.length && !leaf.sans.ip.length) out.push({ severity: "warning", message: "No Subject Alternative Names: browsers ignore the common name and will reject it." });
  const lifetime = Math.round((leaf.notAfter.getTime() - leaf.notBefore.getTime()) / DAY);
  if (!leaf.selfSigned && lifetime > 398) out.push({ severity: "warning", message: `Valid for ${lifetime} days; browsers reject public certificates valid for more than 398.` });
  chain.forEach((c, i) => {
    const label = i === 0 ? "The certificate" : `Certificate ${i + 1} (${c.subject.cn ?? c.subject.text})`;
    if (c.key.type === "RSA" && c.key.bits < 2048) out.push({ severity: "error", message: `${label} has a ${c.key.bits}-bit RSA key; 2048 bits is the minimum.` });
    const isRoot = c.selfSigned && i > 0;
    if (!isRoot && /SHA-1|MD5/.test(c.signatureAlgorithm)) out.push({ severity: "error", message: `${label} is signed with ${c.signatureAlgorithm}, which is no longer trusted.` });
    if (i > 0 && daysLeft(c, now) < 0) out.push({ severity: "error", message: `${label} has expired.` });
  });
  for (let i = 0; i + 1 < chain.length; i++) {
    if (chain[i].issuer.text !== chain[i + 1].subject.text) {
      out.push({ severity: "warning", message: `The chain is out of order: certificate ${i + 1} was not issued by certificate ${i + 2}.` });
      break;
    }
  }
  const last = chain[chain.length - 1];
  if (!last.selfSigned && chain.length === 1 && !leaf.selfSigned) out.push({ severity: "warning", message: "Only the server's own certificate was sent; without the intermediate certificate some clients cannot verify it." });
  if (chain.length > 1 && last.selfSigned) out.push({ severity: "info", message: "The server also sends the root certificate; clients already have it, so it only adds bytes to every handshake." });
  if (leaf.selfSigned) out.push({ severity: "warning", message: "Self-signed: only machines that were told to trust it will accept it." });
  if (!leaf.selfSigned && !leaf.hasSct) out.push({ severity: "info", message: "No Certificate Transparency timestamps embedded; they may arrive in the handshake instead." });
  if (!leaf.extendedKeyUsage.length || leaf.extendedKeyUsage.some((u) => u === "Server authentication" || u === "Any purpose")) {
    // fine
  } else out.push({ severity: "error", message: `Not meant for web servers: it is for ${leaf.extendedKeyUsage.join(", ").toLowerCase()}.` });
  if (!out.some((f) => f.severity === "error" || f.severity === "warning")) out.unshift({ severity: "ok", message: `Valid for ${left} more days.` });
  return out;
}

/** The verifier's error, in words. */
export function explainTrustError(err: string): string {
  if (/UnknownIssuer/i.test(err)) return "Not issued by a trusted authority, or an intermediate certificate is missing from the chain.";
  if (/NotValidForName/i.test(err)) return "The certificate does not cover this host name.";
  if (/Expired/i.test(err)) return "The certificate has expired.";
  if (/NotValidYet/i.test(err)) return "The certificate is not valid yet.";
  if (/Revoked/i.test(err)) return "The certificate has been revoked.";
  if (/BadSignature/i.test(err)) return "A signature in the chain does not match.";
  if (/UnsupportedSignatureAlgorithm/i.test(err)) return "The chain uses a signature algorithm that is no longer accepted.";
  if (/InvalidPurpose/i.test(err)) return "The certificate is not meant for web servers.";
  return err;
}
