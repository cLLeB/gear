// Palette commands for the tool panes that have no actions file of their own,
// plus the list of every tool-pane command, registered in one place.

import { BOARD_ACTIONS } from "@/modules/board/BoardPane";
import { CHART_ACTIONS } from "@/modules/charts/ChartPane";
import { CODEIMAGE_ACTIONS } from "@/modules/codeimage/CodeImagePane";
import { CRON_ACTIONS } from "@/modules/cronlab/CronPane";
import { ENV_ACTIONS } from "@/modules/envmatrix/EnvPane";
import { HAR_ACTIONS } from "@/modules/harview/HarPane";
import { UNICODE_ACTIONS } from "@/modules/unicode/UnicodePane";
import { COLOR_ACTIONS } from "@/modules/colors/ColorPane";
import { CODESTATS_ACTIONS } from "@/modules/codestats/CodeStatsPane";
import { IMAGE_ACTIONS } from "@/modules/imagetools/ImagePane";
import { I18N_ACTIONS } from "@/modules/i18nkeys/I18nPane";
import { openImportGraph } from "@/modules/importgraph/ImportGraphPane";
import { openLoadTest } from "@/modules/loadtest/LoadTestPane";
import { QR_ACTIONS } from "@/modules/qrcode/QrPane";
import { SLIDES_ACTIONS } from "@/modules/slides/SlidesPane";
import { ZIP_ACTIONS } from "@/modules/ziparchive/ZipPane";
import { openDirCompare } from "@/modules/dircompare/DirComparePane";
import { openDiskUsage, openDiskUsageFor } from "@/modules/diskusage/DiskUsagePane";
import { HEX_ACTIONS } from "@/modules/hexedit/HexPane";
import { MACRO_ACTIONS } from "@/modules/macros/recorder";
import { openMock, startMock, stopMock } from "@/modules/mockserver/MockPane";
import { REGEX_ACTIONS } from "@/modules/regexlab/RegexPane";
import { TABLE_ACTIONS } from "@/modules/table/TablePane";
import { TIME_ACTIONS } from "@/modules/timetrack/TimePane";
import { WS_ACTIONS } from "@/modules/wsclient/WsPane";

export const TOOL_PANE_ACTIONS = [
  { id: "dircompare.open", label: "Compare two folders…", keywords: ["diff", "compare", "folders", "directories", "sync", "what changed", "only in"], run: () => void openDirCompare() },
  { id: "disk.open", label: "Disk usage: What takes up the space in this folder", keywords: ["disk", "size", "space", "treemap", "large", "big", "du", "storage"], run: openDiskUsage },
  { id: "disk.openOther", label: "Disk usage: Of another folder…", keywords: ["disk", "size", "space", "treemap", "folder", "du"], run: () => void openDiskUsageFor() },
  { id: "mock.open", label: "Mock server: Open the mock API server", keywords: ["mock", "api", "server", "fake", "stub", "http", "routes", "backend"], run: openMock },
  { id: "mock.start", label: "Mock server: Start", keywords: ["mock", "api", "server", "start", "run"], run: () => (openMock(), void startMock()) },
  { id: "mock.stop", label: "Mock server: Stop", keywords: ["mock", "api", "server", "stop"], run: () => void stopMock() },
  ...MACRO_ACTIONS,
  ...BOARD_ACTIONS,
  ...TIME_ACTIONS,
  ...HEX_ACTIONS,
  ...TABLE_ACTIONS,
  ...WS_ACTIONS,
  ...REGEX_ACTIONS,
  { id: "loadtest.open", label: "Load test: Measure a local HTTP server under load", keywords: ["load", "test", "benchmark", "stress", "performance", "latency", "requests per second", "rps", "ab", "wrk", "hey"], run: openLoadTest },
  { id: "imports.open", label: "Import graph: What imports what in this workspace", keywords: ["imports", "dependencies", "graph", "cycles", "circular", "unused files", "orphans", "modules", "madge"], run: openImportGraph },
  ...SLIDES_ACTIONS,
  ...CODEIMAGE_ACTIONS,
  ...QR_ACTIONS,
  ...ZIP_ACTIONS,
  ...I18N_ACTIONS,
  ...ENV_ACTIONS,
  ...CRON_ACTIONS,
  ...CHART_ACTIONS,
  ...HAR_ACTIONS,
  ...UNICODE_ACTIONS,
  ...COLOR_ACTIONS,
  ...CODESTATS_ACTIONS,
  ...IMAGE_ACTIONS,
];
