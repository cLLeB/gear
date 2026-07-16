export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

function base64UrlDecode(segment: string): string {
  let b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = typeof atob === "function" ? atob(b64) : "";
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Decode a JWT into its header, payload, and signature WITHOUT verifying the
 * signature. For display/inspection only — never trust an unverified payload.
 * Returns null when the token is malformed.
 */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(base64UrlDecode(parts[0])),
      payload: JSON.parse(base64UrlDecode(parts[1])),
      signature: parts[2],
    };
  } catch {
    return null;
  }
}

/** True when a decoded JWT's `exp` claim is in the past. */
export function isJwtExpired(token: string, now = Date.now()): boolean {
  const decoded = decodeJwt(token);
  const exp = decoded?.payload.exp;
  if (typeof exp !== "number") return false;
  return exp * 1000 < now;
}
