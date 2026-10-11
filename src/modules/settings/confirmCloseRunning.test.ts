import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "./store";

describe("confirmCloseRunningTerminal", () => {
  it("asks by default, so a running command is never killed without a prompt until the user opts out", () => {
    expect(DEFAULT_PREFERENCES.confirmCloseRunningTerminal).toBe(true);
  });
});
