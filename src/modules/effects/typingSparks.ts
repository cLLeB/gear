// Typing sparks: little particle bursts from the cursor as you type, in the
// terminal, the editor and any text field, plus an optional combo counter.
// One full-window canvas, animated only while particles are alive.

import { getFeature } from "@/modules/settings/useFeature";
import { themeColors } from "@/modules/wrapped/themeColors";

export type SparkStyle = "off" | "sparks" | "rainbow" | "fire";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

const MAX_PARTICLES = 450;
const COMBO_TIMEOUT_MS = 2500;

export interface Point {
  x: number;
  y: number;
}

/** Where the text cursor is on screen, for the focused terminal, editor or field. */
export function caretPoint(active: Element | null = document.activeElement): Point | null {
  if (!active || active === document.body) return null;
  // xterm keeps its hidden textarea on the cursor cell.
  if (active.classList.contains("xterm-helper-textarea")) {
    const r = active.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2 };
  }
  const editor = active.closest(".cm-editor");
  if (editor) {
    const cursor = editor.querySelector(".cm-cursor-primary") ?? editor.querySelector(".cm-cursor");
    if (cursor) {
      const r = cursor.getBoundingClientRect();
      if (r.height > 0) return { x: r.left, y: r.top + r.height / 2 };
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.height > 0) return { x: r.left, y: r.top + r.height / 2 };
    }
  }
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const r = active.getBoundingClientRect();
    return { x: Math.min(r.right - 8, r.left + 12 + active.value.length * 6.5), y: r.top + r.height / 2 };
  }
  return null;
}

/** True for keys that type or delete text, with no shortcut modifier held. */
export function isTypingKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 || e.key === "Backspace" || e.key === "Enter" || e.key === "Delete";
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const FIRE = ["#ffd166", "#ff9f1c", "#ff6b35", "#ef476f", "#fff3b0"];

class SparkLayer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private raf = 0;
  private last = 0;
  private hue = Math.random() * 360;
  private combo = 0;
  private comboEl: HTMLDivElement | null = null;
  private comboTimer: ReturnType<typeof setTimeout> | null = null;

  private ensureCanvas() {
    if (this.canvas) return;
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    Object.assign(c.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "2147483000",
    });
    document.body.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    if (!this.canvas || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  burst(at: Point, style: Exclude<SparkStyle, "off">, count: number) {
    this.ensureCanvas();
    let palette = FIRE;
    if (style === "sparks") {
      const theme = themeColors();
      palette = [theme.primary, ...theme.palette];
    }
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const fire = style === "fire";
      const angle = fire ? rand(-Math.PI * 0.85, -Math.PI * 0.15) : rand(0, Math.PI * 2);
      const speed = fire ? rand(30, 110) : rand(60, 210);
      let color: string;
      if (style === "rainbow") {
        this.hue = (this.hue + 7) % 360;
        color = `hsl(${this.hue}, 95%, 62%)`;
      } else {
        color = pick(palette);
      }
      const maxLife = rand(0.5, 1);
      this.particles.push({
        x: at.x + rand(-2, 2),
        y: at.y + rand(-2, 2),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (fire ? 20 : 40),
        life: maxLife,
        maxLife,
        size: rand(2, fire ? 5 : 4),
        color,
        gravity: fire ? -60 : 420,
      });
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  private frame(now: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = "lighter";
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
      alive.push(p);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.particles = alive;
    this.raf = alive.length ? requestAnimationFrame((t) => this.frame(t)) : 0;
  }

  bumpCombo(at: Point | null, style: SparkStyle) {
    this.combo += 1;
    if (!this.comboEl) {
      const el = document.createElement("div");
      el.className = "gear-combo";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
      this.comboEl = el;
    }
    const el = this.comboEl;
    el.innerHTML = `<span class="gear-combo-count">${this.combo}</span><span class="gear-combo-label">combo</span>`;
    el.classList.add("gear-combo-on");
    el.classList.remove("gear-combo-pop");
    void el.offsetWidth; // restart the pop animation
    el.classList.add("gear-combo-pop");
    if (this.combo % 50 === 0) {
      el.classList.add("gear-combo-milestone");
      setTimeout(() => el.classList.remove("gear-combo-milestone"), 600);
      if (at && style !== "off") this.burst(at, style, 60);
    }
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => this.resetCombo(), COMBO_TIMEOUT_MS);
  }

  resetCombo() {
    this.combo = 0;
    this.comboEl?.classList.remove("gear-combo-on");
  }
}

const STYLE = `
.gear-combo {
  position: fixed; top: 44px; right: 22px; z-index: 2147483001;
  display: flex; flex-direction: column; align-items: flex-end;
  pointer-events: none; opacity: 0; transition: opacity .4s ease;
  font-family: var(--font-sans, system-ui), sans-serif;
  color: var(--primary, #8b5cf6);
  text-shadow: 0 0 12px color-mix(in srgb, var(--primary, #8b5cf6) 55%, transparent);
}
.gear-combo-on { opacity: .9; }
.gear-combo-count { font-size: 34px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.gear-combo-label { font-size: 10px; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; opacity: .75; }
.gear-combo-pop .gear-combo-count { animation: gear-combo-pop .18s ease-out; }
.gear-combo-milestone .gear-combo-count { animation: gear-combo-shake .6s ease-out; }
@keyframes gear-combo-pop { from { transform: scale(1.35); } to { transform: scale(1); } }
@keyframes gear-combo-shake {
  0%, 100% { transform: translate(0) scale(1); }
  20% { transform: translate(-3px, 1px) scale(1.6); }
  40% { transform: translate(3px, -1px) scale(1.4); }
  60% { transform: translate(-2px, 1px) scale(1.2); }
  80% { transform: translate(1px, 0) scale(1.1); }
}
`;

let installed = false;

export function installTypingSparks(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const layer = new SparkLayer();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isTypingKey(e)) return;
      const sparks = getFeature("effects.typingSparks") as SparkStyle;
      const combo = getFeature("effects.typingCombo");
      if (sparks === "off" && !combo) return;
      // Let the editor or terminal move its cursor first.
      requestAnimationFrame(() => {
        const at = caretPoint();
        if (sparks !== "off" && at && !reducedMotion?.matches) {
          layer.burst(at, sparks, e.key === "Enter" ? 24 : e.key === "Backspace" ? 6 : 12);
        }
        if (combo && at) layer.bumpCombo(at, sparks);
      });
    },
    true,
  );
}
