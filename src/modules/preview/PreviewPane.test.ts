import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The browser pane shows arbitrary sites in native webviews inside Gear's
 * window. That is safe because Tauri refuses IPC from remote origins unless a
 * capability grants it. If a capability ever adds a `remote` section, every
 * site in the browser pane could call Gear's commands — this test fails first.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const capDir = path.join(here, "../../../src-tauri/capabilities");

describe("browser pane security", () => {
  it("no capability lets remote pages reach Gear's commands", () => {
    const files = readdirSync(capDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const cap = JSON.parse(readFileSync(path.join(capDir, f), "utf8"));
      expect(cap.remote, `${f} grants IPC to remote URLs`).toBeUndefined();
    }
  });

  it("pages render in a native view, not an iframe inside Gear's own document", () => {
    const src = readFileSync(path.join(here, "PreviewPane.tsx"), "utf8");
    expect(src).not.toMatch(/<iframe/);
    expect(src).toContain("useNativeView");
  });
});
