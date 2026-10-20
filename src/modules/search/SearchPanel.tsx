// The sidebar's Search view: find text across the workspace, with match
// case, whole word and regex toggles, an include filter, and results grouped
// by file that open at their line.

import { ArrowDown01Icon, ArrowRight01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { type GrepResponse, native } from "@/modules/ai/lib/native";
import { buildQuery, groupHits, matchRanges, parseGlobs, type SearchOptions } from "./query";

export type SearchPanelHandle = { focus: () => void };

const toggle = "rounded px-1 py-0.5 font-mono text-[10.5px] leading-none";
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 2000;

function Highlighted({ text, matcher }: { text: string; matcher: RegExp }) {
  const line = text.replace(/\t/g, "  ");
  const ranges = matchRanges(line, matcher);
  // Keep the first match in view in a narrow sidebar: trim leading text.
  const start = ranges.length && ranges[0][0] > 16 ? ranges[0][0] - 10 : 0;
  const parts: React.ReactNode[] = [];
  let at = start;
  for (const [s, e] of ranges) {
    if (e <= start) continue;
    if (s > at) parts.push(line.slice(at, s));
    parts.push(
      <mark key={s} className="rounded-sm bg-amber-400/35 text-foreground">
        {line.slice(Math.max(s, start), e)}
      </mark>,
    );
    at = e;
  }
  parts.push(line.slice(at, at + 200));
  return (
    <>
      {start > 0 && "…"}
      {parts}
    </>
  );
}

export const SearchPanel = forwardRef<SearchPanelHandle, { rootPath: string | null }>(function SearchPanel({ rootPath }, ref) {
  const [opts, setOpts] = useState<SearchOptions>({ text: "", matchCase: false, wholeWord: false, regex: false });
  const [include, setInclude] = useState("");
  const [result, setResult] = useState<GrepResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  useImperativeHandle(ref, () => ({ focus: () => (inputRef.current?.focus(), inputRef.current?.select()) }), []);

  const query = useMemo(() => buildQuery(opts), [opts]);

  useEffect(() => {
    if (!rootPath || !query || "error" in query) {
      setResult(null);
      setError(query && "error" in query ? query.error : null);
      return;
    }
    const id = ++runId.current;
    const t = setTimeout(() => {
      setBusy(true);
      setError(null);
      const globs = parseGlobs(include);
      native
        .grep({ pattern: query.pattern, root: rootPath, glob: globs.length ? globs : undefined, caseInsensitive: query.caseInsensitive, maxResults: MAX_RESULTS })
        .then((r) => id === runId.current && setResult(r))
        .catch((e) => id === runId.current && setError(String(e)))
        .finally(() => id === runId.current && setBusy(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, include, rootPath]);

  const groups = useMemo(() => (result ? groupHits(result.hits) : []), [result]);
  const matcher = query && !("error" in query) ? query.matcher : null;

  const flag = (key: "matchCase" | "wholeWord" | "regex", label: string, short: string) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={opts[key]}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setOpts((o) => ({ ...o, [key]: !o[key] }))}
      className={cn(toggle, opts[key] ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}
      data-search-flag={key}
    >
      {short}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col text-[12px]" data-search-panel>
      <div className="flex h-9 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Search</div>
      <div className="space-y-1.5 px-2 pb-2">
        <div className="relative">
          <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={opts.text}
            onChange={(e) => setOpts((o) => ({ ...o, text: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpts((o) => ({ ...o, text: "" }));
            }}
            placeholder="Search in files"
            spellCheck={false}
            className={cn("h-7 w-full rounded-md border border-border/60 bg-muted/50 pr-[78px] pl-7 text-[12.5px] outline-none focus:border-primary/60", error && "border-destructive/60 text-destructive")}
            data-search-input
          />
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
            {flag("matchCase", "Match case", "Aa")}
            {flag("wholeWord", "Whole word", "ab")}
            {flag("regex", "Regular expression", ".*")}
          </div>
        </div>
        <input
          value={include}
          onChange={(e) => setInclude(e.target.value)}
          placeholder="Files to include, e.g. src/**/*.ts, *.md"
          spellCheck={false}
          className="h-6 w-full rounded-md border border-border/60 bg-transparent px-2 text-[11.5px] outline-none focus:border-primary/60"
          data-search-include
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground" data-search-summary>
          <span>
            {error
              ? error
              : busy
                ? "Searching…"
                : result
                  ? result.hits.length
                    ? `${result.hits.length}${result.truncated ? "+" : ""} result${result.hits.length === 1 ? "" : "s"} in ${groups.length} file${groups.length === 1 ? "" : "s"}`
                    : "No results"
                  : rootPath
                    ? ""
                    : "Open a folder to search it"}
          </span>
          {groups.length > 1 && (
            <button type="button" className="hover:text-foreground" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.path)))}>
              {collapsed.size ? "Expand all" : "Collapse all"}
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {matcher &&
          groups.map((g) => {
            const open = !collapsed.has(g.path);
            const dir = g.rel.includes("/") ? g.rel.slice(0, g.rel.lastIndexOf("/")) : "";
            return (
              <div key={g.path} data-search-file={g.rel}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-accent/50"
                  onClick={() => setCollapsed((c) => (c.has(g.path) ? new Set([...c].filter((x) => x !== g.path)) : new Set([...c, g.path])))}
                >
                  <HugeiconsIcon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={11} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{g.rel.split("/").pop()}</span>
                  {dir && <span className="truncate text-[10.5px] text-muted-foreground">{dir}</span>}
                  <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">{g.hits.length}</span>
                </button>
                {open &&
                  g.hits.map((h) => (
                    <button
                      key={`${h.line}-${h.text.length}`}
                      type="button"
                      className="flex w-full items-baseline gap-2 py-0.5 pr-2 pl-6 text-left hover:bg-accent/50"
                      onClick={() => app().openFile(h.path, h.line)}
                      title={`${g.rel}:${h.line}`}
                      data-search-hit={h.line}
                    >
                      <span className="w-7 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">{h.line}</span>
                      <span className="min-w-0 truncate font-mono text-[11.5px]">
                        <Highlighted text={h.text} matcher={matcher} />
                      </span>
                    </button>
                  ))}
              </div>
            );
          })}
      </div>
    </div>
  );
});
