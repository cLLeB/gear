import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { motion } from "motion/react";
import { useEffect } from "react";

export type SelectionAskAiProps = {
  x: number;
  y: number;
  onAsk: (prefix: string) => void;
  onDismiss: () => void;
};

const W = 240;
const OFFSET = 36;

const PRESETS: { label: string; prefix: string }[] = [
  { label: "Explain", prefix: "Explain this code:\n" },
  { label: "Refactor", prefix: "Refactor this code:\n" },
  { label: "Fix", prefix: "Fix this code:\n" },
];

export function SelectionAskAi({ x, y, onAsk, onDismiss }: SelectionAskAiProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const top = Math.max(8, y - OFFSET);
  const left = Math.max(8, Math.min(x - W / 2, window.innerWidth - W - 8));

  return (
    <motion.div
      data-selection-ask-ai
      initial={{ opacity: 0, y: 4, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.95 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{ top, left, width: W }}
      className="fixed z-50 flex gap-1 rounded-md border border-border/60 bg-card/95 p-1 shadow-lg backdrop-blur-md"
    >
      {PRESETS.map(({ label, prefix }) => (
        <button
          key={label}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAsk(prefix);
          }}
          className="flex flex-1 items-center justify-center rounded px-2 py-1 text-xs hover:bg-accent"
        >
          {label}
        </button>
      ))}
      <div className="flex items-center border-l border-border/60 pl-1">
        <button
          type="button"
          title="Ask Gear"
          onClick={(e) => {
            e.stopPropagation();
            onAsk("");
          }}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <KbdGroup>
            <Kbd className="h-4 min-w-4 px-1 text-[10px]">{fmtShortcut(MOD_KEY, "L")}</Kbd>
          </KbdGroup>
        </button>
      </div>
    </motion.div>
  );
}
