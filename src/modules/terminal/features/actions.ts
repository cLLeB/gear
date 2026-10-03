// Palette actions contributed by terminal intelligence features.

import type { TerminalActionDescriptor } from "../actions/terminalActions";
import { applyPendingCorrection } from "./corrections";
import { quickSelectInTerminal } from "./quickSelectAction";
import { copyScrollbackAsHtml, saveScrollback } from "./exportScrollback";
import { forgetDirectoryHistory, jumpToDirectory } from "./dirJump";
import { pickProblem, stepProblem } from "./terminalProblems";

export const TERMINAL_FEATURE_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "terminal.problems",
    label: "Terminal: Show problems from last command",
    keywords: ["errors", "warnings", "build", "compile", "lint", "test", "problem matcher"],
    run: pickProblem,
  },
  {
    id: "terminal.nextProblem",
    label: "Terminal: Go to next problem",
    keywords: ["error", "jump", "build", "compile"],
    run: () => stepProblem(1),
  },
  {
    id: "terminal.prevProblem",
    label: "Terminal: Go to previous problem",
    keywords: ["error", "jump", "build", "compile"],
    run: () => stepProblem(-1),
  },
  {
    id: "terminal.applyCorrection",
    label: "Terminal: Run suggested correction",
    keywords: ["typo", "did you mean", "fix", "thefuck", "correct"],
    run: applyPendingCorrection,
  },
  {
    id: "terminal.quickSelect",
    label: "Terminal: Quick select (URLs, paths, hashes…)",
    keywords: ["hints", "copy", "url", "path", "sha", "ip", "uuid", "pick", "wezterm", "kitty"],
    run: quickSelectInTerminal,
  },
  {
    id: "terminal.saveScrollback",
    label: "Terminal: Save scrollback to file…",
    keywords: ["export", "log", "contents", "html", "text", "ansi", "save"],
    run: saveScrollback,
  },
  {
    id: "terminal.copyScrollbackHtml",
    label: "Terminal: Copy scrollback with colours",
    keywords: ["export", "html", "rich", "clipboard", "share"],
    run: copyScrollbackAsHtml,
  },
  {
    id: "terminal.jumpToDirectory",
    label: "Terminal: Jump to directory…",
    keywords: ["cd", "zoxide", "z", "frecent", "recent", "folder", "navigate"],
    run: jumpToDirectory,
  },
  {
    id: "terminal.forgetDirectories",
    label: "Terminal: Clear directory history",
    keywords: ["zoxide", "privacy", "forget", "frecency"],
    run: forgetDirectoryHistory,
  },
];
