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
import { useRunTrustStore } from "./lib/trustPrompt";

/**
 * Workspace trust prompt. Shows the exact commands the project wants to run
 * before any of them execute — approving on a description alone would defeat
 * the point of the gate.
 */
export function RunTrustDialog() {
  const pending = useRunTrustStore((s) => s.pending);
  const answer = useRunTrustStore((s) => s.answer);

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => !open && answer(false)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Run this project's commands?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block">
              This workspace ships its own run configurations in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                .gear/settings.json
              </code>
              . They can run any command on your machine. Approve only if you
              trust this project.
            </span>
            <span className="mt-2 block break-all font-mono text-[11px] text-muted-foreground">
              {pending?.workspaceRoot}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
          {pending?.configs.map((config) => (
            <div key={config.id} className="px-1 py-1.5 text-xs">
              <div className="font-medium text-foreground">{config.name}</div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                {config.command}
              </div>
              {config.env && Object.keys(config.env).length > 0 && (
                <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                  {Object.entries(config.env)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("  ")}
                </div>
              )}
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>
            Trust this workspace
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
