// Spot credentials printed to a terminal (a `cat .env`, a verbose curl, a CI
// log) so the user can clear the scrollback before it is screen-shared,
// copied into a chat, or sent to an AI as context. High-confidence token
// formats match directly; generic KEY=value assignments additionally need a
// high-entropy value so placeholders ("changeme", "$TOKEN", "***") don't fire.

export interface SecretHit {
  kind: string;
  label: string;
  /** The secret with its middle masked, safe to display. */
  preview: string;
}

const TOKEN_PATTERNS: Array<{ kind: string; label: string; re: RegExp }> = [
  { kind: "private-key", label: "private key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  { kind: "anthropic-key", label: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "openai-key", label: "OpenAI API key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { kind: "aws-access-key", label: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "github-token", label: "GitHub token", re: /\b(?:gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { kind: "gitlab-token", label: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "google-api-key", label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "slack-token", label: "Slack token", re: /\bxox[bpsare]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "stripe-key", label: "Stripe secret key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/ },
  { kind: "npm-token", label: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: "huggingface-token", label: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{34,}\b/ },
  { kind: "db-url", label: "database URL with password", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:/@]+:[^\s@/]{6,}@/ },
];

const ASSIGN_RE =
  /\b([A-Z][A-Z0-9_]*(?:API_?KEY|SECRET(?:_?KEY)?|ACCESS_?TOKEN|AUTH_?TOKEN|TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|CLIENT_?SECRET))\s*[:=]\s*["']?([^\s"';|&]+)/;

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}${"•".repeat(Math.min(12, secret.length - 8))}${secret.slice(-4)}`;
}

function looksLikePlaceholder(v: string): boolean {
  return (
    /^[$%{<*]/.test(v) ||
    /^(x+|\*+|•+|changeme|password|secret|example|your[-_]?\w*|null|none|true|false|undefined|redacted)$/i.test(v) ||
    /REDACTED/i.test(v)
  );
}

export function scanForSecrets(line: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const p of TOKEN_PATTERNS) {
    const m = p.re.exec(line);
    if (m) hits.push({ kind: p.kind, label: p.label, preview: maskSecret(m[0]) });
  }
  if (hits.length === 0) {
    const a = ASSIGN_RE.exec(line);
    if (a) {
      const value = a[2];
      if (value.length >= 12 && !looksLikePlaceholder(value) && entropy(value) >= 3.3) {
        hits.push({ kind: "assignment", label: `${a[1]} value`, preview: maskSecret(value) });
      }
    }
  }
  return hits;
}
