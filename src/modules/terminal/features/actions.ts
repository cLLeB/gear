// Palette actions contributed by terminal intelligence features.

import type { TerminalActionDescriptor } from "../actions/terminalActions";
import { applyPendingCorrection } from "./corrections";
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
];
