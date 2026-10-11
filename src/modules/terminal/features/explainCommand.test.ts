import { describe, expect, it } from "vitest";
import { explainCommand } from "./explainCommand";

const brief = (line: string) => explainCommand(line).map((p) => [p.text, p.kind]);

describe("explainCommand", () => {
  it("explains a pipeline with redirects and bundled flags", () => {
    const parts = explainCommand("tar -xzvf archive.tgz -C /tmp 2>&1 | grep -i error > out.txt");
    expect(parts.map((p) => [p.text, p.kind])).toEqual([
      ["tar", "program"],
      ["-xzvf", "flag"],
      ["archive.tgz", "argument"],
      ["-C", "flag"],
      ["/tmp", "argument"],
      ["2>&1", "redirect"],
      ["|", "operator"],
      ["grep", "program"],
      ["-i", "flag"],
      ["error", "argument"],
      [">", "redirect"],
      ["out.txt", "argument"],
    ]);
    expect(parts[1].explanation).toBe("-x: extract an archive; -z: gzip compression; -v: verbose: list files processed; -f: archive file name");
    expect(parts[2].explanation).toBe("value for -f");
  });

  it("explains subcommands, env vars, sudo-wrapped programs and chains", () => {
    expect(brief("NODE_ENV=prod sudo -E git push --force-with-lease && echo done")).toEqual([
      ["NODE_ENV=prod", "env"],
      ["sudo", "program"],
      ["-E", "flag"],
      ["git", "program"],
      ["push", "subcommand"],
      ["--force-with-lease", "flag"],
      ["&&", "operator"],
      ["echo", "program"],
      ["done", "argument"],
    ]);
  });

  it("is honest about unknown flags and programs", () => {
    const parts = explainCommand("mytool --frob x");
    expect(parts[0].explanation).toBe("program (no built-in description)");
    expect(parts[1].explanation).toMatch(/not in the built-in manual/);
  });

  it("handles inline flag values and special arguments", () => {
    const parts = explainCommand("ps aux; chmod 755 run.sh");
    expect(parts[1].explanation).toMatch(/all processes/);
    expect(parts.find((p) => p.text === "755")?.explanation).toMatch(/rwx for owner/);
    expect(explainCommand("grep --include=*.ts -r foo .")[1].explanation).toBe("only search files matching a glob = *.ts");
  });
});
