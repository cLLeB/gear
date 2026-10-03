import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  FEATURE_DEFAULTS,
  FEATURE_META,
  searchFeatureSettings,
  type FeatureKey,
} from "@/modules/settings/featureSettings";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { resetFeatureSettings, setFeatureSetting } from "@/modules/settings/store";
import { useEffect, useMemo, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

/** Auto-generated from the feature-settings schema, with search. */
export function FeaturesSection() {
  const [query, setQuery] = useState("");
  const values = usePreferencesStore((s) => s.featureSettings) ?? FEATURE_DEFAULTS;
  const groups = useMemo(() => searchFeatureSettings(query), [query]);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Features"
        description="Terminal intelligence, command, editor and workspace features."
      />
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search features…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8"
        />
        <Button variant="outline" size="sm" onClick={() => void resetFeatureSettings()}>
          Reset all
        </Button>
      </div>
      {groups.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No settings match “{query}”.</p>
      ) : null}
      {groups.map((group) => (
        <section key={group.section} className="flex flex-col gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.section}
          </h2>
          {group.keys.map((key) => (
            <FeatureRow key={key} featureKey={key} value={values[key]} />
          ))}
        </section>
      ))}
    </div>
  );
}

function FeatureRow({ featureKey, value }: { featureKey: FeatureKey; value: unknown }) {
  const meta = FEATURE_META[featureKey];
  const def = FEATURE_DEFAULTS[featureKey];
  const set = (v: unknown) => void setFeatureSetting(featureKey, v as never);

  if (typeof def === "boolean") {
    return (
      <SettingRow title={meta.label} description={meta.description}>
        <Switch checked={value === true} onCheckedChange={(v) => set(v)} />
      </SettingRow>
    );
  }
  if (typeof def === "number") {
    return (
      <SettingRow title={meta.label} description={meta.description}>
        <NumberField value={value as number} min={meta.min} max={meta.max} onCommit={set} />
      </SettingRow>
    );
  }
  if (meta.options) {
    return (
      <SettingRow title={meta.label} description={meta.description}>
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-[12px]"
          value={value as string}
          onChange={(e) => set(e.target.value)}
        >
          {meta.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </SettingRow>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <span className="text-[12.5px] font-medium">{meta.label}</span>
      <span className="text-[10.5px] leading-relaxed text-muted-foreground">{meta.description}</span>
      <TextField value={value as string} multiline={meta.multiline} onCommit={set} />
    </div>
  );
}

function NumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <Input
      type="number"
      className="h-8 w-28"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function TextField({
  value,
  multiline,
  onCommit,
}: {
  value: string;
  multiline?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return multiline ? (
    <Textarea
      className="min-h-24 font-mono text-[12px]"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  ) : (
    <Input
      className="h-8 font-mono text-[12px]"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
