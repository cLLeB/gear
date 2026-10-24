// A small confetti burst on a canvas in the theme's own colours: no
// dependency, a few seconds long, and skipped entirely for people who ask the
// system for reduced motion.

import { themeColors } from "./themeColors";

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
  round: boolean;
}

/** Fires one burst across the canvas. Returns a function that stops it early. */
export function confetti(canvas: HTMLCanvasElement, count = 180): () => void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);
  const colors = themeColors().palette;

  // Two cannons in the lower corners, aimed up and inwards.
  const pieces: Piece[] = Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
    const speed = 9 + Math.random() * 9;
    return {
      x: left ? width * 0.05 : width * 0.95,
      y: height * 0.9,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.4,
      angle: Math.random() * Math.PI,
      color: colors[i % colors.length],
      round: Math.random() < 0.3,
    };
  });

  let frame = 0;
  let raf = 0;
  const step = () => {
    frame++;
    ctx.clearRect(0, 0, width, height);
    for (const p of pieces) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - frame / 220);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (frame < 220) raf = requestAnimationFrame(step);
    else ctx.clearRect(0, 0, width, height);
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, width, height);
  };
}
