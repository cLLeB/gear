import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setRunCustomConfigs,
  setTrustedRunProjects,
} from "@/modules/settings/store";
import {
  EMPTY_RUN_CONFIG_FORM,
  type RunConfigForm,
  RUN_PRESETS,
  type RunConfig,
  toRunConfigForm,
  validateRunConfigForm,
} from "@/modules/run";
import { Add01Icon, Delete02Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function RunSection() {
  const configs = usePreferencesStore((s) => s.runCustomConfigs);
  const trusted = usePreferencesStore((s) => s.trustedRunProjects);

  const [form, setForm] = useState<RunConfigForm | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const openNew = () => {
    setErrors([]);
    setForm(EMPTY_RUN_CONFIG_FORM);
  };

  const openEdit = (config: RunConfig) => {
    setErrors([]);
    setForm(toRunConfigForm(config));
  };

  const save = () => {
    if (!form) return;
    const { config, errors: found } = validateRunConfigForm(form);
    if (!config) {
      setErrors(found);
      return;
    }
    const existing = configs.findIndex((c) => c.id === config.id);
    const next =
      existing >= 0
        ? configs.map((c) => (c.id === config.id ? config : c))
        : [...configs, config];
    void setRunCustomConfigs(next);
    setForm(null);
  };

  const remove = (id: string) => {
    void setRunCustomConfigs(configs.filter((c) => c.id !== id));
  };

  const revoke = (root: string) => {
    void setTrustedRunProjects(trusted.filter((r) => r !== root));
  };

  const field = (key: keyof RunConfigForm, value: string) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Run"
        description="How gear runs the file you have open. Your configurations take precedence over the built-in ones; a project's own configurations take precedence over both."
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium">Your configurations</h2>
          <Button size="sm" variant="outline" onClick={openNew}>
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
            Add
          </Button>
        </div>

        {configs.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            None yet. Add one to override a built-in command — for example to
            run Python through Poetry or a virtualenv.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {configs.map((config) => (
              <div
                key={config.id}
                className="flex items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{config.name}</div>
                  <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                    {config.command}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {config.extensions?.length
                      ? config.extensions.map((e) => `.${e}`).join(" ")
                      : "No file types — selectable from the run picker only"}
                  </div>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Edit"
                  onClick={() => openEdit(config)}
                >
                  <HugeiconsIcon icon={Edit02Icon} size={14} strokeWidth={1.75} />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Remove"
                  onClick={() => remove(config.id)}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={14}
                    strokeWidth={1.75}
                  />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium">Trusted workspaces</h2>
        <p className="text-[12px] text-muted-foreground">
          Projects allowed to run the commands in their own{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
            .gear/settings.json
          </code>
          . Revoking takes effect on the next run.
        </p>
        {trusted.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No workspaces trusted yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {trusted.map((root) => (
              <div
                key={root}
                className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 break-all font-mono text-[11px]">
                  {root}
                </span>
                <Button size="sm" variant="ghost" onClick={() => revoke(root)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium">Built in</h2>
        <div className="flex flex-wrap gap-1.5">
          {RUN_PRESETS.map((preset) => (
            <span
              key={preset.id}
              title={preset.command}
              className="rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] text-muted-foreground"
            >
              {preset.name}
            </span>
          ))}
        </div>
      </div>

      <Dialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Edit run configuration" : "New run configuration"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12px]">
              Name
              <Input
                value={form?.name ?? ""}
                placeholder="Poetry"
                onChange={(e) => field("name", e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              Command
              <Input
                className="font-mono text-[12px]"
                value={form?.command ?? ""}
                placeholder="poetry run python {file}"
                onChange={(e) => field("command", e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                Placeholders: {"{file}"} {"{fileDir}"} {"{fileStem}"}{" "}
                {"{workspaceRoot}"} — each is quoted for you.
              </span>
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              File types
              <Input
                value={form?.extensions ?? ""}
                placeholder="py, pyw"
                onChange={(e) => field("extensions", e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                Comma separated. Leave blank to make this selectable from the
                run picker only, never matched automatically.
              </span>
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              Working directory
              <Input
                className="font-mono text-[12px]"
                value={form?.cwd ?? ""}
                placeholder="{fileDir}"
                onChange={(e) => field("cwd", e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              Environment
              <Textarea
                className="min-h-20 font-mono text-[12px]"
                value={form?.env ?? ""}
                placeholder={"PORT=3000\nPYTHONPATH={workspaceRoot}"}
                onChange={(e) => field("env", e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                One KEY=value per line. Set in the run terminal before the
                command.
              </span>
            </label>

            {errors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                {errors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
