import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function SettingRow({ title, description, children, className }: Props) {
  return (
    <div
      className={cn(
        // Wraps rather than squeezing: on a narrow pane the control drops
        // below the text instead of crushing it to a word per line.
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-48 flex-1 basis-56 flex-col gap-0.5">
        <span className="text-[12.5px] font-medium">{title}</span>
        {description ? (
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex max-w-full shrink-0 items-center">{children}</div>
    </div>
  );
}
