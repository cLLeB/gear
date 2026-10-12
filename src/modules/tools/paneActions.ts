// Palette commands for the tool panes that have no actions file of their own,
// plus the list of every tool-pane command, registered in one place.

import { BOARD_ACTIONS } from "@/modules/board/BoardPane";
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
];
