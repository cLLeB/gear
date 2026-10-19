import { cn } from "@/lib/utils";
import type { EditorTab, Tab } from "@/modules/tabs";
import { useEffect, useRef } from "react";
import { NotebookPane } from "@/modules/notebook/NotebookPane";
import { ProfilePane } from "@/modules/profiler/ProfilePane";
import { HeapPane } from "@/modules/profiler/HeapPane";
import { ConsolePane } from "@/modules/database/ConsolePane";
import { ErPane } from "@/modules/database/ErPane";
import { DockerPane } from "@/modules/containers/DockerPane";
import { ExtLogPane } from "@/modules/extensions/ExtLogPane";
import { HttpSplit } from "@/modules/http/HttpSplit";
import { K8sPane } from "@/modules/k8s/K8sPane";
import { LogPane } from "@/modules/logview/LogPane";
import { DepsPane } from "@/modules/deps/DepsPane";
import { SecretsPane } from "@/modules/security/SecretsPane";
import { ProcsPane } from "@/modules/procs/ProcsPane";
import { BoardPane } from "@/modules/board/BoardPane";
import { ChartPane } from "@/modules/charts/ChartPane";
import { CodeImagePane } from "@/modules/codeimage/CodeImagePane";
import { CronPane } from "@/modules/cronlab/CronPane";
import { HarPane } from "@/modules/harview/HarPane";
import { UnicodePane } from "@/modules/unicode/UnicodePane";
import { ColorPane } from "@/modules/colors/ColorPane";
import { CodeStatsPane } from "@/modules/codestats/CodeStatsPane";
import { ImagePane } from "@/modules/imagetools/ImagePane";
import { LicensePane } from "@/modules/licenses/LicensePane";
import { TlsPane } from "@/modules/tlscheck/TlsPane";
import { LinkCheckPane } from "@/modules/linkcheck/LinkCheckPane";
import { BundlePane } from "@/modules/bundle/BundlePane";
import { SarifPane } from "@/modules/sarif/SarifPane";
import { PlanPane } from "@/modules/tfplan/PlanPane";
import { ApiDiffPane } from "@/modules/apidiff/ApiDiffPane";
import { MetricsPane } from "@/modules/metrics/MetricsPane";
import { MigrationPane } from "@/modules/migrationlint/MigrationPane";
import { CodeownersPane } from "@/modules/codeowners/CodeownersPane";
import { DataGenPane } from "@/modules/datagen/DataGenPane";
import { EnvPane } from "@/modules/envmatrix/EnvPane";
import { I18nPane } from "@/modules/i18nkeys/I18nPane";
import { ImportGraphPane } from "@/modules/importgraph/ImportGraphPane";
import { LoadTestPane } from "@/modules/loadtest/LoadTestPane";
import { QrPane } from "@/modules/qrcode/QrPane";
import { SlidesPane } from "@/modules/slides/SlidesPane";
import { ZipPane } from "@/modules/ziparchive/ZipPane";
import { DirComparePane } from "@/modules/dircompare/DirComparePane";
import { DiskUsagePane } from "@/modules/diskusage/DiskUsagePane";
import { HexPane } from "@/modules/hexedit/HexPane";
import { MockPane } from "@/modules/mockserver/MockPane";
import { RegexPane } from "@/modules/regexlab/RegexPane";
import { TablePane } from "@/modules/table/TablePane";
import { TimePane } from "@/modules/timetrack/TimePane";
import { WsPane } from "@/modules/wsclient/WsPane";
import { isLogFile } from "@/modules/logview/model";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onDirtyChange: (id: number, dirty: boolean) => void;
  registerHandle: (id: number, handle: EditorPaneHandle | null) => void;
  onCloseTab: (id: number) => void;
};

export function EditorStack({
  tabs,
  activeId,
  onDirtyChange,
  registerHandle,
  onCloseTab,
}: Props) {
  const editors = tabs.filter((t): t is EditorTab => t.kind === "editor");

  // Stable per-tab callbacks. Inline arrows in `ref` and `onDirtyChange`
  // change identity every render, which makes React detach+reattach the ref
  // callback and re-invoke `onDirtyChange`, triggering setState loops in
  // the parent. Memoizing per id keeps each callback's identity stable.
  const registerRef = useRef(registerHandle);
  const dirtyRef = useRef(onDirtyChange);
  const closeRef = useRef(onCloseTab);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    dirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    closeRef.current = onCloseTab;
  }, [onCloseTab]);

  const refCallbacks = useRef(
    new Map<number, (h: EditorPaneHandle | null) => void>(),
  );
  const dirtyCallbacks = useRef(new Map<number, (dirty: boolean) => void>());
  const closeCallbacks = useRef(new Map<number, () => void>());

  const getRefCallback = (id: number) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (h: EditorPaneHandle | null) => registerRef.current(id, h);
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };
  const getDirtyCallback = (id: number) => {
    let cb = dirtyCallbacks.current.get(id);
    if (!cb) {
      cb = (dirty: boolean) => dirtyRef.current(id, dirty);
      dirtyCallbacks.current.set(id, cb);
    }
    return cb;
  };
  const getCloseCallback = (id: number) => {
    let cb = closeCallbacks.current.get(id);
    if (!cb) {
      cb = () => closeRef.current(id);
      closeCallbacks.current.set(id, cb);
    }
    return cb;
  };

  // Drop callback entries for closed tabs to avoid unbounded growth.
  useEffect(() => {
    const live = new Set(editors.map((t) => t.id));
    for (const id of refCallbacks.current.keys()) {
      if (!live.has(id)) refCallbacks.current.delete(id);
    }
    for (const id of dirtyCallbacks.current.keys()) {
      if (!live.has(id)) dirtyCallbacks.current.delete(id);
    }
    for (const id of closeCallbacks.current.keys()) {
      if (!live.has(id)) closeCallbacks.current.delete(id);
    }
  }, [editors]);

  if (editors.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {editors.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <div className="h-full overflow-hidden rounded-md border border-border/60 bg-background">
              {t.path.startsWith("gear-er://") ? (
                <ErPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-db://") ? (
                <ConsolePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-docker://") ? (
                <DockerPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-procs://") ? (
                <ProcsPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-loadtest://") ? (
                <LoadTestPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-slides://") ? (
                <SlidesPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-imports://") ? (
                <ImportGraphPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-codeimage://") ? (
                <CodeImagePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-qr://") ? (
                <QrPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-zip://") ? (
                <ZipPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-i18n://") ? (
                <I18nPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-env://") ? (
                <EnvPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-har://") || (/\.har$/i.test(t.path) && !t.languageOverride) ? (
                <HarPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-licenses://") ? (
                <LicensePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-datagen://") ? (
                <DataGenPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-sarif://") || (/\.sarif$/i.test(t.path) && !t.languageOverride) ? (
                <SarifPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-codeowners://") ? (
                <CodeownersPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-migrations://") ? (
                <MigrationPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-metrics://") ? (
                <MetricsPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-apidiff://") ? (
                <ApiDiffPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-tfplan://") ? (
                <PlanPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-bundle://") ? (
                <BundlePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-links://") ? (
                <LinkCheckPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-tls://") ? (
                <TlsPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-image://") ? (
                <ImagePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-codestats://") ? (
                <CodeStatsPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-color://") ? (
                <ColorPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-unicode://") ? (
                <UnicodePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-cron://") ? (
                <CronPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-chart://") ? (
                <ChartPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-dircmp://") ? (
                <DirComparePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-disk://") ? (
                <DiskUsagePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-mock://") ? (
                <MockPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-board://") ? (
                <BoardPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-time://") ? (
                <TimePane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-hex://") ? (
                <HexPane ref={getRefCallback(t.id)} path={t.path} onDirtyChange={getDirtyCallback(t.id)} />
              ) : t.path.startsWith("gear-table://") ? (
                <TablePane ref={getRefCallback(t.id)} path={t.path} onDirtyChange={getDirtyCallback(t.id)} />
              ) : t.path.startsWith("gear-ws://") ? (
                <WsPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-regex://") ? (
                <RegexPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-secrets://") ? (
                <SecretsPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-deps://") ? (
                <DepsPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-log://") || (isLogFile(t.path) && !t.languageOverride) ? (
                <LogPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-k8s://") ? (
                <K8sPane ref={getRefCallback(t.id)} path={t.path} />
              ) : t.path.startsWith("gear-ext://") ? (
                <ExtLogPane ref={getRefCallback(t.id)} path={t.path} />
              ) : /\.heapsnapshot$/i.test(t.path) && !t.languageOverride ? (
                <HeapPane ref={getRefCallback(t.id)} path={t.path} />
              ) : /\.(cpuprofile|speedscope\.json|folded|collapsed)$/i.test(t.path) && !t.languageOverride ? (
                <ProfilePane ref={getRefCallback(t.id)} path={t.path} />
              ) : /\.ipynb$/i.test(t.path) && !t.languageOverride ? (
                <NotebookPane ref={getRefCallback(t.id)} path={t.path} onDirtyChange={getDirtyCallback(t.id)} onClose={getCloseCallback(t.id)} />
              ) : /\.(http|rest)$/i.test(t.path) && !t.languageOverride ? (
                <HttpSplit path={t.path}>
                  <EditorPane
                    ref={getRefCallback(t.id)}
                    path={t.path}
                    languageOverride={t.languageOverride}
                    onDirtyChange={getDirtyCallback(t.id)}
                    onClose={getCloseCallback(t.id)}
                  />
                </HttpSplit>
              ) : (
                <EditorPane
                  ref={getRefCallback(t.id)}
                  path={t.path}
                  languageOverride={t.languageOverride}
                  onDirtyChange={getDirtyCallback(t.id)}
                  onClose={getCloseCallback(t.id)}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
