import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Common languages offered in the picker, mapped to their file extension. */
const LANGUAGES: { label: string; ext: string }[] = [
  { label: "TypeScript", ext: "ts" },
  { label: "TSX", ext: "tsx" },
  { label: "JavaScript", ext: "js" },
  { label: "JSX", ext: "jsx" },
  { label: "Python", ext: "py" },
  { label: "Rust", ext: "rs" },
  { label: "Go", ext: "go" },
  { label: "Swift", ext: "swift" },
  { label: "Vue", ext: "vue" },
  { label: "JSON", ext: "json" },
  { label: "Markdown", ext: "md" },
  { label: "HTML", ext: "html" },
  { label: "CSS", ext: "css" },
  { label: "YAML", ext: "yaml" },
  { label: "TOML", ext: "toml" },
  { label: "Shell", ext: "sh" },
  { label: "SQL", ext: "sql" },
  { label: "C", ext: "c" },
  { label: "C++", ext: "cpp" },
  { label: "Java", ext: "java" },
  { label: "PHP", ext: "php" },
  { label: "Ruby", ext: "rb" },
  { label: "Plain text", ext: "txt" },
];

type Props = {
  /** Current language extension (override or file-derived), or null. */
  language: string | null;
  /** Whether the current language is a manual override. */
  isOverride: boolean;
  onSelect: (ext: string | undefined) => void;
};

export function LanguagePicker({ language, isOverride, onSelect }: Props) {
  const label =
    LANGUAGES.find((l) => l.ext === language)?.label ??
    (language ? language.toUpperCase() : "Plain text");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Select language mode for this file"
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent/40 hover:text-foreground",
            isOverride ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
          {isOverride && <span className="ml-1 opacity-60">·override</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 min-w-[180px] overflow-auto"
      >
        <DropdownMenuItem
          className="text-[12px]"
          onSelect={() => onSelect(undefined)}
        >
          Auto detect
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.ext}
            className={cn("text-[12px]", l.ext === language && "bg-accent/50")}
            onSelect={() => onSelect(l.ext)}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
