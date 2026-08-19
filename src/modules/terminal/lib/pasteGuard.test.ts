import { describe, expect, it } from "vitest";
import {
  analyzePaste,
  pasteLineCount,
  pasteNeedsConfirmation,
  sanitizePaste,
} from "./pasteGuard";

describe("sanitizePaste", () => {
  it("leaves ordinary text alone", () => {
    expect(sanitizePaste("git status")).toBe("git status");
  });

  it("strips the bracketed-paste terminator that would break out of the bracket", () => {
    expect(sanitizePaste("echo hi\x1b[201~\nrm -rf ~\n")).toBe(
      "echo hi\nrm -rf ~\n",
    );
  });

  it("strips the 8-bit CSI form of the markers", () => {
    expect(sanitizePaste("a\x9b200~b\x9b201~c")).toBe("abc");
  });

  it("strips escape sequences that would steer the emulator", () => {
    expect(sanitizePaste("ls\x1b]0;pwned\x07")).toBe("ls]0;pwned");
  });

  it("strips NUL, DEL and backspace", () => {
    expect(sanitizePaste("a\x00b\x08c\x7fd")).toBe("abcd");
  });

  it("keeps tabs", () => {
    expect(sanitizePaste("a\tb")).toBe("a\tb");
  });

  it("normalizes CRLF and lone CR to LF", () => {
    expect(sanitizePaste("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("pasteLineCount", () => {
  it("counts nothing for an empty paste", () => {
    expect(pasteLineCount("")).toBe(0);
  });

  it("counts a single line without a trailing newline", () => {
    expect(pasteLineCount("one")).toBe(1);
  });

  it("does not count a single trailing newline as another line", () => {
    expect(pasteLineCount("one\n")).toBe(1);
  });

  it("counts interior newlines", () => {
    expect(pasteLineCount("one\ntwo\nthree")).toBe(3);
  });

  it("counts a blank final line when there are two trailing newlines", () => {
    expect(pasteLineCount("one\n\n")).toBe(2);
  });
});

describe("analyzePaste", () => {
  it("reports a plain one-liner as safe", () => {
    const a = analyzePaste("npm test");
    expect(a.risk).toBe("safe");
    expect(a.lineCount).toBe(1);
    expect(a.submits).toBe(false);
    expect(a.modified).toBe(false);
  });

  it("flags a paste that ends in a newline because the shell will run it", () => {
    const a = analyzePaste("npm test\n");
    expect(a.risk).toBe("multiline");
    expect(a.submits).toBe(true);
    expect(a.lineCount).toBe(1);
  });

  it("flags multiple lines", () => {
    expect(analyzePaste("a\nb").risk).toBe("multiline");
  });

  it("does not treat CRLF normalization alone as a control payload", () => {
    const a = analyzePaste("a\r\nb");
    expect(a.risk).toBe("multiline");
    expect(a.modified).toBe(false);
  });

  it("escalates to control when bytes were stripped", () => {
    const a = analyzePaste("echo hi\x1b[201~\nrm -rf ~\n");
    expect(a.risk).toBe("control");
    expect(a.modified).toBe(true);
    expect(a.text).toBe("echo hi\nrm -rf ~\n");
  });
});

describe("pasteNeedsConfirmation", () => {
  const alt = { isAlternateScreen: true };
  const normal = { isAlternateScreen: false };

  it("never asks for a safe paste", () => {
    expect(pasteNeedsConfirmation(analyzePaste("ls"), normal)).toBe(false);
    expect(pasteNeedsConfirmation(analyzePaste("ls"), alt)).toBe(false);
  });

  it("asks before a multiline paste on the normal screen", () => {
    expect(pasteNeedsConfirmation(analyzePaste("a\nb"), normal)).toBe(true);
  });

  it("stays quiet about multiline pastes inside a full-screen app", () => {
    expect(pasteNeedsConfirmation(analyzePaste("a\nb"), alt)).toBe(false);
  });

  it("still asks about control payloads inside a full-screen app", () => {
    expect(pasteNeedsConfirmation(analyzePaste("a\x1b[201~b"), alt)).toBe(true);
  });
});
