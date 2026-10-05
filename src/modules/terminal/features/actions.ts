// Palette actions contributed by terminal intelligence features.

import type { TerminalActionDescriptor } from "../actions/terminalActions";
import { applyPendingCorrection } from "./corrections";
import { quickSelectInTerminal } from "./quickSelectAction";
import { copyScrollbackAsHtml, saveScrollback } from "./exportScrollback";
import { explainLastCommandWithAi } from "../ai/explainFailure";
import { suggestCommandWithAi } from "../ai/suggestCommand";
import { armMonitor } from "./monitor";
import { pasteClipboardImage, pasteSpecial } from "./pasteSpecial";
import { searchHistory } from "./historySearch";
import { explainCommandAction } from "./explainCommand";
import { forgetDirectoryHistory, jumpToDirectory } from "./dirJump";
import {
  deleteSavedWorkflow,
  runWorkflow,
  saveLastCommandAsWorkflow,
} from "../workflows/runner";
import { pickProblem, stepProblem } from "./terminalProblems";
import {
  commandLog,
  dockerContainers,
  listeningPorts,
  runSelectionInTerminal,
  showEnvironment,
  sshConnect,
  toggleRecording,
  toggleRerunOnSave,
} from "./sessionTools";
import { TERMINAL_EXTRA_ACTIONS } from "./terminalExtrasActions";

export const TERMINAL_FEATURE_ACTIONS: TerminalActionDescriptor[] = [
  ...TERMINAL_EXTRA_ACTIONS,
  {
    id: "terminal.commandLog",
    label: "Terminal: Command log for this pane…",
    keywords: ["history", "commands", "exit code", "duration", "timeline", "rerun", "output", "jump"],
    run: commandLog,
  },
  {
    id: "terminal.runSelection",
    label: "Terminal: Run selected text / current line in terminal",
    keywords: ["send", "execute", "repl", "selection", "line", "editor", "script", "eval"],
    run: runSelectionInTerminal,
  },
  {
    id: "terminal.ssh",
    label: "Terminal: SSH to host…",
    keywords: ["ssh", "remote", "server", "connect", "ssh config", "host"],
    run: sshConnect,
  },
  {
    id: "terminal.docker",
    label: "Terminal: Docker containers…",
    keywords: ["docker", "container", "exec", "shell", "logs", "compose", "stop", "restart"],
    run: dockerContainers,
  },
  {
    id: "terminal.ports",
    label: "Terminal: Listening ports (open, kill)…",
    keywords: ["port", "lsof", "netstat", "kill", "process", "address in use", "eaddrinuse", "server"],
    run: listeningPorts,
  },
  {
    id: "terminal.rerunOnSave",
    label: "Terminal: Re-run last command on save (toggle)",
    keywords: ["watch", "nodemon", "entr", "auto", "rerun", "tests", "save", "live"],
    run: toggleRerunOnSave,
  },
  {
    id: "terminal.environment",
    label: "Terminal: Show environment variables…",
    keywords: ["env", "environment", "variables", "path", "printenv", "set"],
    run: showEnvironment,
  },
  {
    id: "terminal.record",
    label: "Terminal: Start / stop recording (asciinema)",
    keywords: ["record", "asciinema", "cast", "screencast", "demo", "replay"],
    run: toggleRecording,
  },
  {
    id: "terminal.explainCommand",
    label: "Terminal: Explain a command (offline)…",
    keywords: ["explain", "explainshell", "flags", "options", "man", "what does", "help"],
    run: explainCommandAction,
  },
  {
    id: "terminal.searchHistory",
    label: "Terminal: Search command history…",
    keywords: ["history", "atuin", "ctrl-r", "reverse search", "previous", "commands", "recall"],
    run: searchHistory,
  },
  {
    id: "terminal.pasteSpecial",
    label: "Terminal: Paste special…",
    keywords: ["paste", "one line", "quote", "escape", "heredoc", "join", "clipboard", "&&"],
    run: pasteSpecial,
  },
  {
    id: "terminal.pasteImage",
    label: "Terminal: Paste clipboard image as file path",
    keywords: ["screenshot", "image", "picture", "png", "claude", "attach", "clipboard", "files"],
    run: pasteClipboardImage,
  },
  {
    id: "terminal.monitor",
    label: "Terminal: Monitor pane for activity / silence…",
    keywords: ["monitor", "watch", "notify", "silence", "activity", "tmux", "alert", "done"],
    run: armMonitor,
  },
  {
    id: "terminal.aiSuggestCommand",
    label: "Terminal: Generate a command with AI…",
    keywords: ["ai", "natural language", "suggest", "how do i", "warp", "copilot", "#"],
    run: suggestCommandWithAi,
  },
  {
    id: "terminal.aiExplainLast",
    label: "Terminal: Ask AI about the last command",
    keywords: ["ai", "explain", "error", "failed", "fix", "why", "debug", "warp"],
    run: explainLastCommandWithAi,
  },
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
  {
    id: "terminal.workflows",
    label: "Terminal: Run workflow…",
    keywords: ["template", "snippet", "recipe", "command library", "warp", "cheatsheet"],
    run: runWorkflow,
  },
  {
    id: "terminal.saveWorkflow",
    label: "Terminal: Save last command as workflow…",
    keywords: ["template", "snippet", "bookmark", "favorite"],
    run: saveLastCommandAsWorkflow,
  },
  {
    id: "terminal.deleteWorkflow",
    label: "Terminal: Delete saved workflow…",
    keywords: ["template", "snippet", "remove"],
    run: deleteSavedWorkflow,
  },
];
