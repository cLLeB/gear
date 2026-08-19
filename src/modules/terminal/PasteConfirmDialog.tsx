import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePastePromptStore } from "./lib/pastePrompt";

const PREVIEW_LINES = 12;

/**
 * Shown before a paste that the shell would treat as more than typing — several
 * lines, a trailing newline that runs the last one, or a payload that carried
 * escape sequences. The preview is the *sanitized* text, so what the user reads
 * is exactly what the terminal receives.
 */
export function PasteConfirmDialog() {
  const pending = usePastePromptStore((s) => s.pending);
  const answer = usePastePromptStore((s) => s.answer);

  const analysis = pending?.analysis;
  const lines = analysis ? analysis.text.replace(/\n$/, "").split("\n") : [];
  const shown = lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - shown.length;

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => !open && answer(false)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {analysis?.risk === "control"
              ? "This paste contained hidden control characters"
              : `Paste ${analysis?.lineCount ?? 0} line${analysis?.lineCount === 1 ? "" : "s"}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {analysis?.risk === "control"
              ? "Escape sequences were removed — they can run commands or disguise what you are pasting. Review the cleaned text before it reaches the shell."
              : analysis?.submits
                ? "The text ends with a newline, so the shell will run the last command immediately."
                : "Each line will be sent to the shell as if you typed it."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
            {shown.join("\n")}
          </pre>
          {hidden > 0 && (
            <div className="mt-1 px-1 text-[11px] text-muted-foreground">
              +{hidden} more line{hidden === 1 ? "" : "s"}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>
            Paste
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
