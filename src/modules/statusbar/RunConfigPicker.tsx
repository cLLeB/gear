import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type LayeredRunConfig, qualifiedId } from "@/modules/run";

type Props = {
  /** Everything selectable, in precedence order. */
  configs: LayeredRunConfig[];
  /** Pinned qualified id, or null when the run target follows the file type. */
  selectedId: string | null;
  /** Pin a config, or null to go back to matching on file type. */
  onSelect: (qualifiedId: string | null) => void;
  /** The project ships configs that are withheld pending approval. */
  needsTrust?: boolean;
};

const SOURCE_LABEL: Record<LayeredRunConfig["source"], string> = {
  project: "Project",
  settings: "Your settings",
  preset: "Built in",
};

/**
 * Status bar control for the run target. Hidden entirely when only presets
 * exist and nothing is pinned — with nothing to choose between, a picker would
 * be noise.
 */
export function RunConfigPicker({
  configs,
  selectedId,
  onSelect,
  needsTrust,
}: Props) {
  const selected = configs.find((c) => qualifiedId(c) === selectedId) ?? null;
  const hasChoice = configs.some((c) => c.source !== "preset");
  if (!hasChoice && !selected && !needsTrust) return null;

  const grouped = (["project", "settings", "preset"] as const)
    .map((source) => ({
      source,
      items: configs.filter((c) => c.source === source),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={
            selected
              ? `Run target pinned to ${selected.name}`
              : "Run target follows the focused file's type"
          }
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent/40 hover:text-foreground",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {selected ? `Run: ${selected.name}` : "Run: auto"}
          {needsTrust && <span className="ml-1 opacity-60">·untrusted</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 min-w-[200px] overflow-auto"
      >
        <DropdownMenuItem className="text-[12px]" onSelect={() => onSelect(null)}>
          Auto (match the file type)
        </DropdownMenuItem>
        {grouped.map((group) => (
          <div key={group.source}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {SOURCE_LABEL[group.source]}
            </DropdownMenuLabel>
            {group.items.map((config) => {
              const id = qualifiedId(config);
              return (
                <DropdownMenuItem
                  key={id}
                  className={cn("text-[12px]", id === selectedId && "bg-accent/50")}
                  onSelect={() => onSelect(id)}
                >
                  {config.name}
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
        {needsTrust && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">
              This project ships run configs. Press Run to review and approve
              them.
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
