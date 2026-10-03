import { describe, expect, it } from "vitest";
import { paramLabel, parseTemplate, renderTemplate } from "./template";

describe("parseTemplate", () => {
  it("collects unique params with defaults and choices", () => {
    const t = "git log --since={{since:1 week ago}} --author={{author}} --format={{fmt|oneline|short|full}} {{author}}";
    expect(parseTemplate(t)).toEqual([
      { name: "since", defaultValue: "1 week ago", choices: null },
      { name: "author", defaultValue: null, choices: null },
      { name: "fmt", defaultValue: "oneline", choices: ["oneline", "short", "full"] },
    ]);
  });

  it("skips escaped placeholders", () => {
    expect(parseTemplate("echo \\{{literal}} {{x}}").map((p) => p.name)).toEqual(["x"]);
  });
});

describe("renderTemplate", () => {
  it("substitutes every occurrence and unescapes literals", () => {
    expect(
      renderTemplate("cp {{src}} {{dst:out}} && ls {{dst}} \\{{keep}}", { src: "a.txt", dst: "b/" }),
    ).toBe("cp a.txt b/ && ls b/ {{keep}}");
  });

  it("leaves unknown placeholders intact", () => {
    expect(renderTemplate("echo {{missing}}", {})).toBe("echo {{missing}}");
  });
});

describe("paramLabel", () => {
  it("humanises names", () => {
    expect(paramLabel("branch_name")).toBe("Branch name");
    expect(paramLabel("remoteURL")).toBe("Remote url");
  });
});
