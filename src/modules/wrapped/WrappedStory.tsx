// Gear Wrapped: a story you tap through, like a year-in-review. Slides move on
// by themselves (hold to pause), click right or press → for the next one, left
// or ← to go back, Esc to close. The last slide is a card to copy or save.

import { downloadDir } from "@tauri-apps/api/path";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTime } from "@/modules/timetrack/TimePane";
import { bytesToBase64, toolsNative } from "@/modules/tools/paneHandle";
import { confetti } from "./confetti";
import { dateKey, favorites, formatDay, formatHour, formatWait, rangeFor, summarize, type RangeId, type Summary } from "./model";
import { cardStats, drawCard } from "./shareCard";
import { closeWrapped, loadShellHistory, openWrapped, useWrapped } from "./store";

const SLIDE_MS = 6500;

/** Counts up to `to` once shown, easing out. */
function useCountUp(to: number, ms = 1200): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return void setN(to);
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return n;
}

function Count({ to, className }: { to: number; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{useCountUp(to).toLocaleString()}</span>;
}

const rise = (i: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.15 + i * 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

function Kicker({ children }: { children: ReactNode }) {
  return (
    <motion.div {...rise(0)} className="text-[13px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {children}
    </motion.div>
  );
}

function Bars({ rows, mono }: { rows: [string, number][]; mono?: boolean }) {
  const max = Math.max(...rows.map(([, n]) => n), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map(([label, n], i) => (
        <motion.div key={label} {...rise(i + 2)} className="flex items-center gap-3">
          <span className={cn("w-6 shrink-0 text-right font-black", i === 0 ? "text-3xl" : "text-xl text-muted-foreground")}>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className={cn("truncate font-semibold", mono && "font-mono", i === 0 ? "text-xl" : "text-[15px]")}>{label}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{n.toLocaleString()}×</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${(n / max) * 100}%` }}
                transition={{ delay: 0.4 + i * 0.18, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function Clock({ hours, peak }: { hours: number[]; peak: number }) {
  const max = Math.max(...hours, 1);
  return (
    <div>
      <div className="flex h-36 items-end gap-[3px]">
        {hours.map((n, h) => (
          <motion.div
            key={h}
            title={`${formatHour(h)}: ${n}`}
            className={cn("flex-1 rounded-t-sm", h === peak ? "bg-primary" : "bg-primary/30")}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(3, (n / max) * 100)}%` }}
            transition={{ delay: 0.3 + h * 0.03, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-muted-foreground">
        <span>12a</span>
        <span>6a</span>
        <span>noon</span>
        <span>6p</span>
        <span>11p</span>
      </div>
    </div>
  );
}

function Tile({ value, label, i }: { value: ReactNode; label: string; i: number }) {
  return (
    <motion.div {...rise(i + 1)} className="rounded-2xl border border-border/60 bg-muted/60 p-4">
      <div className="text-2xl leading-tight font-black">{value}</div>
      <div className="mt-1 text-[12.5px] text-muted-foreground">{label}</div>
    </motion.div>
  );
}

interface Slide {
  id: string;
  body: ReactNode;
}

function buildSlides(s: Summary, range: RangeId, onRange: (r: RangeId) => void, finale: ReactNode): Slide[] {
  const slides: Slide[] = [];
  const empty = !s.commands && !s.history && !s.time;
  slides.push({
    id: "intro",
    body: (
      <div className="flex h-full flex-col justify-center gap-5">
        <motion.div initial={{ scale: 0.4, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 12 }} className="text-6xl">
          ✨
        </motion.div>
        <motion.h1 {...rise(1)} className="text-[40px] leading-[1.05] font-black tracking-tight">
          {s.title}
        </motion.h1>
        <motion.p {...rise(2)} className="text-[16px] text-muted-foreground">
          {empty ? "Nothing to look back on yet. Run some commands and come back — it all stays on this machine." : "Every command, every late night. Let's look back."}
        </motion.p>
        <motion.div {...rise(3)} className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {(["month", "lastMonth", "year"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRange(r)}
              className={cn("rounded-full px-3 py-1 text-[12.5px] font-semibold transition", r === range ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground")}
              data-wrapped-range={r}
            >
              {r === "month" ? "This month" : r === "lastMonth" ? "Last month" : "This year"}
            </button>
          ))}
        </motion.div>
      </div>
    ),
  });

  if (s.commands) {
    const ok = Math.round(((s.commands - s.failed) / s.commands) * 100);
    slides.push({
      id: "commands",
      body: (
        <div className="flex h-full flex-col justify-center gap-3">
          <Kicker>You ran</Kicker>
          <motion.div {...rise(1)} className="text-[76px] leading-none font-black tracking-tight text-primary">
            <Count to={s.commands} />
          </motion.div>
          <motion.div {...rise(2)} className="text-2xl font-bold">
            commands in Gear
          </motion.div>
          <motion.p {...rise(3)} className="text-[15px] text-muted-foreground">
            across {s.activeDays} day{s.activeDays === 1 ? "" : "s"}. {ok}% finished without an error
            {s.failed ? <>, and {s.failed.toLocaleString()} didn't. You fixed them anyway.</> : ". Flawless."}
          </motion.p>
        </div>
      ),
    });
  }

  const { rows: top, fromHistory } = favorites(s);
  if (top.length) {
    slides.push({
      id: "top",
      body: (
        <div className="flex h-full flex-col justify-center gap-5">
          <Kicker>{fromHistory ? "Your all-time favourites" : "Your top commands"}</Kicker>
          <motion.h2 {...rise(1)} className="text-[30px] leading-tight font-black">
            {top[0][1] >= 10 ? "You couldn't stop typing " : "Leading the pack: "}
            <span className="font-mono">{top[0][0]}</span>
          </motion.h2>
          <Bars rows={top} mono />
          {fromHistory && (
            <motion.p {...rise(8)} className="text-[12px] text-muted-foreground">
              From your shell's own history, counted on this machine.
            </motion.p>
          )}
        </div>
      ),
    });
  }

  if (s.peakHour !== null) {
    slides.push({
      id: "clock",
      body: (
        <div className="flex h-full flex-col justify-center gap-5">
          <Kicker>When you code</Kicker>
          <motion.h2 {...rise(1)} className="text-[34px] leading-tight font-black">
            Your terminal peaks at {formatHour(s.peakHour)}
          </motion.h2>
          <motion.div {...rise(2)}>
            <Clock hours={s.hours} peak={s.peakHour} />
          </motion.div>
          <motion.p {...rise(3)} className="text-[15px] text-muted-foreground">
            {s.persona.emoji} {s.persona.blurb}
          </motion.p>
        </div>
      ),
    });
  }

  if (s.time) {
    const [lang, secs] = s.time.languages[0] ?? [null, 0];
    slides.push({
      id: "time",
      body: (
        <div className="flex h-full flex-col justify-center gap-4">
          <Kicker>Time in Gear</Kicker>
          <motion.div {...rise(1)} className="text-[70px] leading-none font-black text-primary">
            <Count to={Math.round(s.time.total / 3600)} />
            <span className="ml-2 text-3xl">hours</span>
          </motion.div>
          {lang && (
            <motion.p {...rise(2)} className="text-[17px]">
              {Math.round((secs / s.time.total) * 100)}% of it in <b className="capitalize">{lang}</b>.
            </motion.p>
          )}
          {s.time.languages.length > 1 && <Bars rows={s.time.languages.map(([l, v]) => [l, Math.round(v / 60)] as [string, number])} />}
        </div>
      ),
    });
  }

  const tiles: [ReactNode, string][] = [];
  if (s.longest) tiles.push([formatWait(s.longest.ms), `longest wait: ${s.longest.label}`]);
  if (s.busiest) tiles.push([s.busiest.count.toLocaleString(), `commands on ${formatDay(s.busiest.day)}, your busiest day`]);
  if (s.streak > 1) tiles.push([`${s.streak} days`, "in a row, and counting 🔥"]);
  if (s.commits) tiles.push([s.commits.toLocaleString(), "git commits from the terminal"]);
  if (s.wandering) tiles.push([s.wandering.toLocaleString(), "times you changed or listed directories. Wanderer."]);
  if (tiles.length >= 2) {
    slides.push({
      id: "records",
      body: (
        <div className="flex h-full flex-col justify-center gap-4">
          <Kicker>Hall of fame</Kicker>
          <div className="grid grid-cols-2 gap-3">
            {tiles.slice(0, 4).map(([v, l], i) => (
              <Tile key={l} value={v} label={l} i={i} />
            ))}
          </div>
        </div>
      ),
    });
  }

  slides.push({ id: "finale", body: finale });
  return slides;
}

function Finale({ s, onReplay }: { s: Summary; onReplay: () => void }) {
  const card = useRef<HTMLCanvasElement>(null);
  const burst = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (card.current) drawCard(card.current, s);
    return burst.current ? confetti(burst.current) : undefined;
  }, [s]);

  const blob = () => new Promise<Blob | null>((res) => (card.current ? card.current.toBlob(res, "image/png") : res(null)));
  const copy = async () => {
    try {
      const b = await blob();
      if (!b) throw new Error("no image");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
      toast.success("Copied. Paste it anywhere to share.");
    } catch (e) {
      toast.error(`Could not copy the image: ${String(e)}`);
    }
  };
  const save = async () => {
    try {
      const b = await blob();
      if (!b) throw new Error("no image");
      const dir = (await downloadDir()).replace(/[\\/]+$/, "");
      // gear-wrapped-2026.png, or gear-wrapped-october-2026.png for a month.
      const year = s.from.slice(0, 4);
      const name = `gear-wrapped-${s.label === year ? year : `${s.label.toLowerCase()}-${year}`}.png`;
      await toolsNative.writeBytes(`${dir}/${name}`, bytesToBase64(new Uint8Array(await b.arrayBuffer())));
      toast.success(`Saved ${name} to Downloads`);
    } catch (e) {
      toast.error(`Could not save the image: ${String(e)}`);
    }
  };

  return (
    <div className="relative flex h-full flex-col justify-center gap-4">
      <canvas ref={burst} className="pointer-events-none absolute inset-[-24px] h-[calc(100%+48px)] w-[calc(100%+48px)]" />
      <Kicker>You are</Kicker>
      <motion.div initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 11, delay: 0.2 }} className="text-6xl">
        {s.persona.emoji}
      </motion.div>
      <motion.h2 {...rise(2)} className="text-[34px] leading-[1.05] font-black text-primary" data-wrapped-persona>
        {s.persona.title}
      </motion.h2>
      <motion.p {...rise(3)} className="text-[15px] text-muted-foreground">
        {s.persona.blurb}
      </motion.p>
      <motion.div {...rise(4)} className="grid grid-cols-2 gap-2">
        {cardStats(s).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border/60 bg-muted/60 px-3 py-2">
            <div className="text-lg font-black">{value}</div>
            <div className="text-[11.5px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </motion.div>
      <motion.div {...rise(5)} className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => void copy()} className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-bold text-primary-foreground hover:bg-primary/90" data-wrapped-copy>
          Copy image
        </button>
        <button type="button" onClick={() => void save()} className="rounded-full bg-muted px-4 py-1.5 text-[13px] font-semibold hover:bg-accent" data-wrapped-save>
          Save image
        </button>
        <button type="button" onClick={onReplay} className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          ↺ Replay
        </button>
      </motion.div>
      <canvas ref={card} className="hidden" data-wrapped-card />
    </div>
  );
}

function Story() {
  const log = useWrapped((st) => st.log);
  const range = useWrapped((st) => st.range);
  const time = useTime((st) => st.data);
  const [history, setHistory] = useState<Record<string, number> | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    // Never wait long on disk: the story starts with whatever is ready.
    const fallback = setTimeout(() => live && setHistory((h) => (h === undefined ? null : h)), 1500);
    void loadShellHistory().then((h) => live && setHistory(h));
    return () => {
      live = false;
      clearTimeout(fallback);
    };
  }, []);

  const summary = useMemo(() => {
    const now = new Date();
    return summarize(log, rangeFor(range, now), dateKey(now), Object.keys(time).length ? time : null, history ?? null);
  }, [log, range, time, history]);

  const onRange = (r: RangeId) => {
    openWrapped(r);
    setIndex(0);
  };
  const slides = buildSlides(summary, range, onRange, <Finale s={summary} onReplay={() => (setIndex(0), setRun((n) => n + 1))} />);
  const last = slides.length - 1;
  const at = Math.min(index, last);
  const next = () => setIndex((i) => Math.min(i + 1, last));
  const prev = () => setIndex((i) => Math.max(i - 1, 0));

  useEffect(() => {
    if (paused || at >= last) return;
    const t = setTimeout(next, SLIDE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, paused, last, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWrapped();
      else if (e.key === "ArrowRight" || e.key === " ") next();
      else if (e.key === "ArrowLeft") prev();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);

  if (history === undefined) return null;
  const slide = slides[at];

  return (
    <motion.div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-background/80 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && closeWrapped()}
      role="dialog"
      aria-modal="true"
      aria-label={summary.title}
      data-wrapped
    >
      <div
        className={cn("relative h-[min(760px,92vh)] w-[min(430px,92vw)] overflow-hidden rounded-[28px] border border-border bg-card text-card-foreground shadow-2xl select-none")}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX - r.left < r.width / 3) prev();
          else next();
        }}
        data-wrapped-slide={slide.id}
      >
        <div className="absolute inset-x-4 top-4 z-10 flex gap-1.5">
          {slides.map((sl, i) => (
            <div key={sl.id} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                key={`${i}-${at}-${run}`}
                className="h-full rounded-full bg-primary"
                style={
                  i < at
                    ? { width: "100%" }
                    : i === at && at < last
                      ? { width: "100%", animation: `gear-wrapped-progress ${SLIDE_MS}ms linear`, animationPlayState: paused ? "paused" : "running" }
                      : i === at
                        ? { width: "100%" }
                        : { width: 0 }
                }
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="Close"
          className="absolute top-8 right-4 z-10 rounded-full px-2 text-xl text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            closeWrapped();
          }}
        >
          ×
        </button>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${slide.id}-${run}-${range}`}
            className="absolute inset-0 px-8 pt-16 pb-10"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.35 }}
          >
            {slide.body}
          </motion.div>
        </AnimatePresence>
        <style>{"@keyframes gear-wrapped-progress { from { width: 0 } to { width: 100% } }"}</style>
      </div>
    </motion.div>
  );
}

/** Mounted once in the app; shows the story while it is open. */
export function WrappedHost() {
  const open = useWrapped((st) => st.open);
  return createPortal(<AnimatePresence>{open && <Story key="wrapped" />}</AnimatePresence>, document.body);
}
