// What goes inside the QR code for the common kinds of content.

export type Kind = "text" | "wifi" | "contact" | "email";

export interface Fields {
  text: string;
  ssid: string;
  password: string;
  security: "WPA" | "WEP" | "nopass";
  hidden: boolean;
  name: string;
  phone: string;
  mail: string;
  org: string;
  url: string;
  to: string;
  subject: string;
  body: string;
}

export const EMPTY: Fields = { text: "", ssid: "", password: "", security: "WPA", hidden: false, name: "", phone: "", mail: "", org: "", url: "", to: "", subject: "", body: "" };

/** Wi-Fi fields escape `\ ; , : "` with a backslash. */
const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
/** vCard text escapes `\ ; ,` and turns line breaks into `\n`. */
const vcardEscape = (s: string) => s.replace(/([\\;,])/g, "\\$1").replace(/\r?\n/g, "\\n");

export function buildPayload(kind: Kind, f: Fields): string {
  switch (kind) {
    case "wifi": {
      if (!f.ssid) return "";
      const pass = f.security === "nopass" ? "" : `P:${wifiEscape(f.password)};`;
      return `WIFI:T:${f.security};S:${wifiEscape(f.ssid)};${pass}${f.hidden ? "H:true;" : ""};`;
    }
    case "contact": {
      if (!f.name.trim()) return "";
      const parts = f.name.trim().split(/\s+/);
      const family = parts.length > 1 ? (parts.pop() as string) : "";
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${vcardEscape(family)};${vcardEscape(parts.join(" "))};;;`, `FN:${vcardEscape(f.name.trim())}`];
      if (f.org.trim()) lines.push(`ORG:${vcardEscape(f.org.trim())}`);
      if (f.phone.trim()) lines.push(`TEL;TYPE=CELL:${f.phone.trim()}`);
      if (f.mail.trim()) lines.push(`EMAIL:${f.mail.trim()}`);
      if (f.url.trim()) lines.push(`URL:${f.url.trim()}`);
      lines.push("END:VCARD");
      return lines.join("\n");
    }
    case "email": {
      if (!f.to.trim()) return "";
      const q = [f.subject && `subject=${encodeURIComponent(f.subject)}`, f.body && `body=${encodeURIComponent(f.body)}`].filter(Boolean).join("&");
      return `mailto:${f.to.trim()}${q ? `?${q}` : ""}`;
    }
    default:
      return f.text;
  }
}

/** Something worth telling the user about the content before they print it. */
export function payloadWarning(kind: Kind, f: Fields): string | null {
  if (kind === "wifi" && f.security !== "nopass" && f.password.length > 0 && f.password.length < 8) return "WPA passwords are at least 8 characters long.";
  if (kind === "email" && f.to.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.to.trim())) return "That does not look like an e-mail address.";
  if (kind === "text" && /^(www\.|[\w-]+\.(com|org|net|io|dev|app)\b)/i.test(f.text.trim())) return "Add https:// in front so phones open it as a link.";
  return null;
}

/** A file name for saving, from the content. */
export function suggestName(kind: Kind, f: Fields): string {
  const base = kind === "wifi" ? `wifi-${f.ssid}` : kind === "contact" ? `contact-${f.name}` : kind === "email" ? `mail-${f.to}` : f.text.replace(/^[a-z]+:\/\//i, "");
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `qr-${clean || "code"}`;
}

/** Whether two colours differ enough for a scanner (WCAG relative-luminance ratio). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return 0;
    const [r, g, bl] = m.slice(1).map((h) => {
      const c = Number.parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
