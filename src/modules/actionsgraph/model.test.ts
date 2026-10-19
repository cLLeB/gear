import { describe, expect, it } from "vitest";
import { evalIf, expandMatrix, filterRegex, levels, matchesList, parseWorkflow, simulate, triggerFires, type ExprContext, type SimEvent } from "./model";

const ci = `
name: CI
on:
  push:
    branches: [main, "release/**"]
    paths-ignore: ["docs/**", "**.md"]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      level: { type: string }
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint
  test:
    needs: lint
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [18, 20]
        exclude:
          - os: windows-latest
            node: 18
    steps:
      - run: npm test
  deploy:
    needs: [test]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: ./deploy.sh
  notify:
    needs: deploy
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo done
`;

const release = `
on:
  push:
    tags: ["v*.*.*"]
jobs:
  build:
    uses: ./.github/workflows/build.yml
`;

const ev = (over: Partial<SimEvent>): SimEvent => ({ name: "push", branch: "main", tag: null, type: "opened", changedFiles: ["src/a.ts"], ...over });

describe("GitHub Actions", () => {
  it("parses triggers, jobs and steps", () => {
    const w = parseWorkflow(ci, ".github/workflows/ci.yml");
    expect(w.name).toBe("CI");
    expect(w.triggers.map((t) => t.event)).toEqual(["push", "pull_request", "workflow_dispatch"]);
    expect(w.triggers[0].filters).toEqual({ branches: ["main", "release/**"], pathsIgnore: ["docs/**", "**.md"] });
    expect(w.triggers[2].details).toEqual(["level"]);
    expect(w.jobs.map((j) => [j.id, j.needs, j.matrix?.length])).toEqual([
      ["lint", [], 0],
      ["test", ["lint"], 3],
      ["deploy", ["test"], 0],
      ["notify", ["deploy"], 0],
    ]);
    expect(w.jobs[2].environment).toBe("production");
    expect(w.problems).toEqual([]);
    expect(levels(w.jobs)).toEqual([["lint"], ["test"], ["deploy"], ["notify"]]);
  });

  it("reports structural problems", () => {
    const w = parseWorkflow("on: push\njobs:\n  a:\n    needs: [b, ghost]\n    runs-on: x\n  b:\n    needs: a\n    runs-on: x\n", "w.yml");
    expect(w.problems).toEqual(["Job a needs ghost, which does not exist.", "Jobs depend on each other in a cycle: a → b → a."]);
    expect(parseWorkflow("on: [push, pull_request]\njobs:\n  a:\n    runs-on: x\n", "w.yml").triggers.map((t) => t.event)).toEqual(["push", "pull_request"]);
  });

  it("expands matrices like GitHub's documented example", () => {
    const m = expandMatrix({
      fruit: ["apple", "pear"],
      animal: ["cat", "dog"],
      include: [{ color: "green" }, { color: "pink", animal: "cat" }, { fruit: "apple", shape: "circle" }, { fruit: "banana" }, { fruit: "banana", animal: "cat" }],
    });
    expect(m).toEqual([
      { fruit: "apple", animal: "cat", color: "pink", shape: "circle" },
      { fruit: "apple", animal: "dog", color: "green", shape: "circle" },
      { fruit: "pear", animal: "cat", color: "pink" },
      { fruit: "pear", animal: "dog", color: "green" },
      { fruit: "banana" },
      { fruit: "banana", animal: "cat" },
    ]);
    expect(expandMatrix("${{ fromJSON(needs.a.outputs.m) }}")).toBeNull();
    expect(expandMatrix({ include: [{ a: 1 }, { a: 2 }] })).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("matches filter patterns with GitHub's glob rules", () => {
    expect(filterRegex("release/**").test("release/1.0/hotfix")).toBe(true);
    expect(filterRegex("feature/*").test("feature/a/b")).toBe(false);
    expect(filterRegex("v[12].[0-9]+.[0-9]+").test("v1.10.3")).toBe(true);
    expect(filterRegex("*.jsx?").test("app.js")).toBe(true);
    expect(filterRegex("**.md").test("docs/a/README.md")).toBe(true);
    expect(matchesList("releases/10-beta", ["releases/**", "!releases/**-alpha"])).toBe(true);
    expect(matchesList("releases/10-alpha", ["releases/**", "!releases/**-alpha"])).toBe(false);
    expect(matchesList("sub/a.js", ["**.js", "!sub/**", "sub/a.js"])).toBe(true);
  });

  it("decides whether a trigger fires, with reasons", () => {
    const [push, pr] = parseWorkflow(ci, "ci.yml").triggers;
    expect(triggerFires(push, ev({}))).toEqual({ fires: true, reason: "" });
    expect(triggerFires(push, ev({ branch: "release/2.0" })).fires).toBe(true);
    expect(triggerFires(push, ev({ branch: "feature/x" })).reason).toBe("branch feature/x is not in branches: main, release/**");
    expect(triggerFires(push, ev({ changedFiles: ["docs/a.txt", "README.md"] })).reason).toBe("every changed file is in paths-ignore");
    expect(triggerFires(push, ev({ changedFiles: ["docs/a.txt", "src/x.ts"] })).fires).toBe(true);
    expect(triggerFires(push, ev({ tag: "v1.0.0" })).reason).toBe("only branch pushes (branches filter without tags)");
    expect(triggerFires(pr, ev({ name: "pull_request", branch: "main", type: "closed" })).reason).toBe("only for pull_request types opened, synchronize, reopened");
    const [tags] = parseWorkflow(release, "r.yml").triggers;
    expect(triggerFires(tags, ev({ tag: "v1.2.3" })).fires).toBe(true);
    expect(triggerFires(tags, ev({ tag: "nightly" })).reason).toBe("tag nightly is not in tags: v*.*.*");
    expect(triggerFires(tags, ev({})).reason).toBe("only tag pushes (tags filter without branches)");
  });

  it("evaluates if: expressions with unknowns", () => {
    const ctx: ExprContext = { event_name: "push", ref: "refs/heads/main", ref_name: "main", base_ref: "", head_ref: "", ref_type: "branch" };
    expect(evalIf("github.ref == 'refs/heads/main'", ctx)).toBe(true);
    expect(evalIf("${{ github.event_name != 'push' }}", ctx)).toBe(false);
    expect(evalIf("startsWith(github.ref, 'refs/tags/')", ctx)).toBe(false);
    expect(evalIf("contains(github.ref, 'MAIN')", ctx)).toBe(true);
    expect(evalIf("github.actor == 'bot'", ctx)).toBeUndefined();
    expect(evalIf("github.actor == 'bot' && github.event_name == 'pull_request'", ctx)).toBe(false);
    expect(evalIf("github.actor == 'bot' || github.ref_name == 'main'", ctx)).toBe(true);
    expect(evalIf("!(github.event_name == 'push') || always()", ctx)).toBe(true);
    expect(evalIf("failure()", ctx)).toBe(false);
  });

  it("simulates which workflows and jobs run", () => {
    const flows = [parseWorkflow(ci, "ci.yml"), parseWorkflow(release, "release.yml")];
    const push = simulate(flows, ev({}));
    expect(push.map((o) => [o.workflow.file, o.runs, o.reason])).toEqual([
      ["ci.yml", true, ""],
      ["release.yml", false, "only tag pushes (tags filter without branches)"],
    ]);
    expect(push[0].jobs.map((j) => `${j.job.id}:${j.verdict}`)).toEqual(["lint:runs", "test:runs", "deploy:runs", "notify:runs"]);
    const pr = simulate(flows, ev({ name: "pull_request", branch: "main", type: "synchronize" }));
    expect(pr[0].jobs.map((j) => `${j.job.id}:${j.verdict}`)).toEqual(["lint:runs", "test:runs", "deploy:skipped", "notify:runs"]);
    expect(pr[1].reason).toBe("not triggered by pull_request (on: push)");
    const tag = simulate(flows, ev({ tag: "v2.0.0" }));
    expect(tag.map((o) => o.runs)).toEqual([false, true]);
  });
});
