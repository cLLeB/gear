// Inspect a JWT: decode (without verifying), describe registered claims in
// human terms and report its validity window — jwt.io without pasting a
// token into a website.

import { decodeJwt } from "@/lib/toolkit/jwtDecode";
import { humanizeDuration } from "@/lib/toolkit/humanizeDuration";

export interface JwtClaimRow {
  key: string;
  value: string;
  note?: string;
}

export interface JwtReport {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: "valid" | "expired" | "not-yet-valid" | "no-expiry";
  summary: string;
  rows: JwtClaimRow[];
}

const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/;

/** The JWT inside some text (a header line, a cookie, a curl command). */
export function findJwt(text: string): string | null {
  return JWT_RE.exec(text)?.[0] ?? null;
}

const CLAIM_NAMES: Record<string, string> = {
  iss: "issuer",
  sub: "subject",
  aud: "audience",
  exp: "expires",
  nbf: "not before",
  iat: "issued at",
  jti: "token id",
  scope: "scopes",
  azp: "authorized party",
};

const TIME_CLAIMS = new Set(["exp", "nbf", "iat", "auth_time", "updated_at"]);

function fmt(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function inspectJwt(token: string, now = Date.now()): JwtReport | null {
  const d = decodeJwt(token);
  if (!d) return null;
  const { header, payload } = d;
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
  const nbf = typeof payload.nbf === "number" ? payload.nbf * 1000 : null;
  let status: JwtReport["status"];
  let summary: string;
  if (nbf !== null && now < nbf) {
    status = "not-yet-valid";
    summary = `Not valid for another ${humanizeDuration(nbf - now)}`;
  } else if (exp === null) {
    status = "no-expiry";
    summary = "Never expires";
  } else if (now >= exp) {
    status = "expired";
    summary = `Expired ${humanizeDuration(now - exp)} ago`;
  } else {
    status = "valid";
    summary = `Valid for ${humanizeDuration(exp - now)}`;
  }

  const rows: JwtClaimRow[] = [
    { key: "alg", value: fmt(header.alg), note: header.alg === "none" ? "unsigned token!" : "algorithm" },
  ];
  if (header.kid !== undefined) rows.push({ key: "kid", value: fmt(header.kid), note: "key id" });
  for (const [k, v] of Object.entries(payload)) {
    if (TIME_CLAIMS.has(k) && typeof v === "number") {
      const date = new Date(v * 1000);
      const rel = v * 1000 - now;
      rows.push({
        key: k,
        value: date.toISOString(),
        note: `${CLAIM_NAMES[k] ?? k} · ${rel >= 0 ? `in ${humanizeDuration(rel)}` : `${humanizeDuration(-rel)} ago`}`,
      });
    } else {
      rows.push({ key: k, value: fmt(v), note: CLAIM_NAMES[k] });
    }
  }
  return { header, payload, status, summary, rows };
}
