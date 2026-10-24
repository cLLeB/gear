// The picture at the end of Gear Wrapped: a 1200x630 card (the size social
// sites preview) with your persona and numbers, to copy or save and share.

import { favorites, formatHour, formatWait, type Summary } from "./model";
import { themeColors } from "./themeColors";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const FONT = '"Segoe UI", "Inter", system-ui, -apple-system, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The stats shown on the card, best first, at most four. */
export function cardStats(s: Summary): [string, string][] {
  const stats: [string, string][] = [];
  if (s.commands) stats.push(["commands", s.commands.toLocaleString()]);
  if (s.time) stats.push(["hours in Gear", (s.time.total / 3600).toFixed(s.time.total < 36000 ? 1 : 0)]);
  if (s.activeDays) stats.push(["active days", String(s.activeDays)]);
  if (s.peakHour !== null) stats.push(["peak hour", formatHour(s.peakHour)]);
  if (s.streak > 1) stats.push(["day streak", String(s.streak)]);
  if (s.longest) stats.push(["longest wait", formatWait(s.longest.ms)]);
  if (!stats.length && s.history) stats.push(["commands in history", s.history.total.toLocaleString()]);
  return stats.slice(0, 4);
}

/** Draws the card at `scale` (2 for a crisp image). */
export function drawCard(canvas: HTMLCanvasElement, s: Summary, scale = 2): void {
  canvas.width = CARD_WIDTH * scale;
  canvas.height = CARD_HEIGHT * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(scale, scale);
  const t = themeColors();

  ctx.fillStyle = t.card;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  // A thin accent rule in the theme's primary colour.
  ctx.fillStyle = t.primary;
  ctx.fillRect(0, 0, CARD_WIDTH, 8);

  ctx.fillStyle = t.mutedForeground;
  ctx.font = `600 22px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.fillText(`GEAR WRAPPED · ${s.label.toUpperCase()}`, 64, 56);

  ctx.font = `64px ${FONT}`;
  ctx.fillText(s.persona.emoji, 64, 104);

  ctx.fillStyle = t.primary;
  ctx.font = `800 58px ${FONT}`;
  const titleLines = wrap(ctx, s.persona.title, 700).slice(0, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 64, 190 + i * 66));

  ctx.fillStyle = t.foreground;
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText(wrap(ctx, s.persona.blurb, 700)[0] ?? "", 64, 196 + titleLines.length * 66);

  // Top commands, on the right.
  const top = favorites(s).rows.slice(0, 3);
  if (top.length) {
    ctx.fillStyle = t.muted;
    roundRect(ctx, 820, 104, 316, 54 + top.length * 58, 24);
    ctx.fill();
    ctx.fillStyle = t.mutedForeground;
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText("TOP COMMANDS", 848, 128);
    top.forEach(([label, n], i) => {
      ctx.fillStyle = t.primary;
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText(`${i + 1}`, 848, 164 + i * 58);
      ctx.fillStyle = t.foreground;
      ctx.font = `600 24px ui-monospace, "Cascadia Code", Consolas, monospace`;
      const text = label.length > 16 ? `${label.slice(0, 15)}…` : label;
      ctx.fillText(text, 884, 166 + i * 58);
      ctx.fillStyle = t.mutedForeground;
      ctx.font = `400 16px ${FONT}`;
      ctx.fillText(`${n.toLocaleString()}×`, 884, 196 + i * 58);
    });
  }

  // Stat tiles along the bottom.
  const stats = cardStats(s);
  const tileW = (CARD_WIDTH - 128 - (stats.length - 1) * 20) / Math.max(stats.length, 1);
  stats.forEach(([label, value], i) => {
    const x = 64 + i * (tileW + 20);
    ctx.fillStyle = t.muted;
    roundRect(ctx, x, 430, tileW, 120, 22);
    ctx.fill();
    ctx.fillStyle = t.foreground;
    ctx.font = `800 42px ${FONT}`;
    ctx.fillText(value, x + 24, 452);
    ctx.fillStyle = t.mutedForeground;
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(label, x + 24, 508);
  });

  ctx.fillStyle = t.mutedForeground;
  ctx.font = `500 18px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("made with Gear · gear.kyere.me", CARD_WIDTH - 64, 580);
  ctx.textAlign = "left";
}
