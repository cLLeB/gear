import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useMemo, useState } from "react";
import { highlightRuns, rankPicks, type RankedPick } from "./rank";
import { useQuickPickStore, type QuickPickRequest } from "./store";

const MAX_RENDERED = 300;

/** Mounted once at the app root; renders whichever request is active. */
export function QuickPickHost() {
  const request = useQuickPickStore((s) => s.request);
  const close = useQuickPickStore((s) => s.close);
  if (!request) return null;
  return request.kind === "pick" ? (
    <PickDialog key={keyOf(request)} request={request} onClose={close} />
  ) : (
    <InputDialog key={keyOf(request)} request={request} onClose={close} />
  );
}

// Each request gets a fresh dialog so stale query/selection never carries over.
const keys = new WeakMap<object, number>();
let nextKey = 1;
function keyOf(req: QuickPickRequest): number {
  const id = req.resolve as unknown as object;
  let k = keys.get(id);
  if (!k) {
    k = nextKey++;
    keys.set(id, k);
  }
  return k;
}

function PickDialog({
  request,
  onClose,
}: {
  request: Extract<QuickPickRequest, { kind: "pick" }>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const ranked = useMemo(
    () => (request.items ? rankPicks(query, request.items).slice(0, MAX_RENDERED) : []),
    [query, request.items],
  );
  const groups = useMemo(() => groupRanked(ranked), [ranked]);
  const custom = request.options.allowCustom ? query.trim() : "";
  const showCustom = custom !== "" && !ranked.some((r) => r.item.label === custom);

  useEffect(() => {
    setSelected(ranked.length > 0 ? valueKey(0) : showCustom ? CUSTOM_KEY : "");
  }, [ranked, showCustom]);

  const accept = (index: number) => {
    const hit = ranked[index];
    if (!hit) return;
    useQuickPickStore.setState({ request: null });
    request.resolve({ value: hit.item.value });
  };
  const acceptCustom = () => {
    useQuickPickStore.setState({ request: null });
    request.resolve({ custom });
  };

  let flatIndex = 0;
  return (
    <CommandDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={request.options.title ?? "Quick pick"}
      description={request.options.placeholder ?? "Choose an item"}
      className="top-1/2 w-[min(640px,calc(100vw-32px))] -translate-y-1/2"
    >
      <Command shouldFilter={false} loop value={selected} onValueChange={setSelected}>
        {request.options.title ? (
          <div className="px-4 pt-3 text-xs font-medium text-muted-foreground">
            {request.options.title}
          </div>
        ) : null}
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={request.options.placeholder ?? "Type to filter…"}
          autoFocus
        />
        <ScrollArea className="max-h-[400px]">
          <CommandList className="max-h-none overflow-visible pr-3">
            {request.loadError ? (
              <Status text={request.loadError} tone="error" />
            ) : request.items === null ? (
              <Status text="Loading…" />
            ) : ranked.length === 0 && !showCustom ? (
              <Status text={request.options.emptyText ?? "No matching items"} />
            ) : null}
            {groups.map((g) => (
              <CommandGroup key={g.name || "_"} heading={g.name || undefined}>
                {g.items.map((r) => {
                  const index = flatIndex++;
                  return (
                    <CommandItem
                      key={index}
                      value={valueKey(index)}
                      onSelect={() => accept(index)}
                      className="text-[12.5px]"
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate">
                            {highlightRuns(r.item.label, r.labelPositions).map((run, i) =>
                              run.match ? (
                                <span key={i} className="text-primary">
                                  {run.text}
                                </span>
                              ) : (
                                <span key={i}>{run.text}</span>
                              ),
                            )}
                          </span>
                          {r.item.description ? (
                            <span className="ml-auto max-w-[45%] shrink-0 truncate text-[11px] font-normal text-muted-foreground">
                              {r.item.description}
                            </span>
                          ) : null}
                        </div>
                        {r.item.detail ? (
                          <span className="truncate text-[11px] font-normal text-muted-foreground">
                            {r.item.detail}
                          </span>
                        ) : null}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
            {showCustom ? (
              <CommandGroup>
                <CommandItem value={CUSTOM_KEY} onSelect={acceptCustom} className="text-[12.5px]">
                  <span className="truncate">Use “{custom}”</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </ScrollArea>
      </Command>
    </CommandDialog>
  );
}

const CUSTOM_KEY = "quick-pick:custom";
const valueKey = (i: number) => `quick-pick:${i}`;

function groupRanked<T>(ranked: RankedPick<T>[]): Array<{ name: string; items: RankedPick<T>[] }> {
  const order: string[] = [];
  const byName = new Map<string, RankedPick<T>[]>();
  for (const r of ranked) {
    const name = r.item.group ?? "";
    let list = byName.get(name);
    if (!list) {
      list = [];
      byName.set(name, list);
      order.push(name);
    }
    list.push(r);
  }
  return order.map((name) => ({ name, items: byName.get(name)! }));
}

function Status({ text, tone = "muted" }: { text: string; tone?: "muted" | "error" }) {
  return (
    <div
      className={`px-4 py-6 text-center text-sm ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {text}
    </div>
  );
}

function InputDialog({
  request,
  onClose,
}: {
  request: Extract<QuickPickRequest, { kind: "input" }>;
  onClose: () => void;
}) {
  const { options } = request;
  const [value, setValue] = useState(options.value ?? "");
  const error = options.validate ? options.validate(value) : null;
  const submit = () => {
    if (error) return;
    useQuickPickStore.setState({ request: null });
    request.resolve(value);
  };
  return (
    <CommandDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={options.title ?? "Input"}
      description={options.prompt ?? options.placeholder ?? "Enter a value"}
      className="top-1/2 w-[min(560px,calc(100vw-32px))] -translate-y-1/2"
    >
      <form
        className="flex flex-col gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {options.title ? (
          <div className="text-xs font-medium text-muted-foreground">{options.title}</div>
        ) : null}
        <Input
          autoFocus
          type={options.password ? "password" : "text"}
          value={value}
          placeholder={options.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          aria-invalid={!!error}
        />
        <div className={`text-[11px] ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {error ?? options.prompt ?? "Press Enter to confirm or Escape to cancel"}
        </div>
      </form>
    </CommandDialog>
  );
}
