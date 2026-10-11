import { describe, expect, it } from "vitest";
import { matchTriggers, parseTriggers, substituteGroups, triggerColor } from "./triggers";

describe("parseTriggers", () => {
  it("parses rules, flags and arguments and reports errors", () => {
    const { rules, errors } = parseTriggers(
      [
        "# comment",
        "ERROR|FATAL => highlight:red",
        "/deploy (\\w+) done/i => notify:Deployed $1",
        "\\a{2} => bell",
        "bad( => highlight",
        "x => explode",
        ".* => highlight",
        "no arrow",
      ].join("\n"),
    );
    expect(rules.map((r) => [r.action, r.arg, r.re.flags])).toEqual([
      ["highlight", "red", "g"],
      ["notify", "Deployed $1", "gi"],
      ["bell", null, "g"],
    ]);
    expect(errors).toHaveLength(4);
  });
});

describe("matchTriggers", () => {
  it("finds every highlight match but one notification per line", () => {
    const { rules } = parseTriggers("ERROR => highlight\n/deploy (\\w+) done/i => notify:Deployed $1");
    const hits = matchTriggers("ERROR one ERROR two; Deploy api done", rules);
    expect(hits.map((h) => [h.rule.action, h.start, h.end])).toEqual([
      ["highlight", 0, 5],
      ["highlight", 10, 15],
      ["notify", 21, 36],
    ]);
    expect(substituteGroups(hits[2].rule.arg!, hits[2].groups)).toBe("Deployed api");
  });
});

describe("triggerColor", () => {
  it("maps names and passes hex through", () => {
    expect(triggerColor("red")).toBe("#ef444466");
    expect(triggerColor("#123456")).toBe("#123456");
    expect(triggerColor("nonsense")).toBe("#eab30866");
  });
});
