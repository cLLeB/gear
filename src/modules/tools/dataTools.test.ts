import { describe, expect, it } from "vitest";
import {
  barrelFor,
  columnAt,
  csvColumnStats,
  csvFilter,
  csvSort,
  duplicateKeys,
  editTable,
  endpointCurl,
  lintDockerfile,
  lintK8s,
  lintWorkflow,
  openApiBase,
  openApiEndpoints,
  queryPath,
  reindentPaste,
  splitYamlDocs,
  tableBounds,
  toggleArrow,
} from "./dataTools";
import { parseYaml } from "@/modules/editor/lib/textTools/yaml";

const store = {
  store: {
    book: [
      { title: "A", price: 8, tags: ["x"] },
      { title: "B", price: 12 },
      { title: "C", price: 5, isbn: "1" },
    ],
    bike: { color: "red", price: 20 },
  },
  "odd key": 1,
};

describe("JSONPath", () => {
  it("selects with keys, wildcards, slices and unions", () => {
    expect(queryPath(store, "$.store.book[0].title").map((h) => h.value)).toEqual(["A"]);
    expect(queryPath(store, "store.book[*].title").map((h) => h.value)).toEqual(["A", "B", "C"]);
    expect(queryPath(store, "$.store.book[-1:]").map((h) => h.path)).toEqual(["$.store.book[2]"]);
    expect(queryPath(store, "$.store.book[0,2].price").map((h) => h.value)).toEqual([8, 5]);
    expect(queryPath(store, "$['odd key']").map((h) => h.path)).toEqual(["$['odd key']"]);
    expect(queryPath(store, "$.store.book.length")[0].value).toBe(3);
  });

  it("descends and filters", () => {
    expect(queryPath(store, "$..price").map((h) => h.value).sort()).toEqual([12, 20, 5, 8]);
    expect(queryPath(store, "$.store.book[?(@.price < 10)].title").map((h) => h.value)).toEqual(["A", "C"]);
    expect(queryPath(store, "$.store.book[?(@.isbn)].title").map((h) => h.value)).toEqual(["C"]);
    expect(queryPath(store, "$..book[?(@.price > 6 && @.title != 'B')].title").map((h) => h.value)).toEqual(["A"]);
    expect(queryPath(store, "$..book[?(@.title =~ /^[bc]$/i)].price").map((h) => h.value)).toEqual([12, 5]);
  });
});

describe("OpenAPI", () => {
  it("lists endpoints and builds curl", () => {
    const doc = {
      openapi: "3.0.0",
      servers: [{ url: "https://api.x.dev/v1" }],
      paths: { "/users/{id}": { parameters: [{ name: "id", in: "path" }], get: { summary: "Get user", tags: ["users"] }, patch: { requestBody: {} } } },
    };
    const eps = openApiEndpoints(doc);
    expect(eps.map((e) => `${e.method} ${e.path}`)).toEqual(["GET /users/{id}", "PATCH /users/{id}"]);
    expect(eps[0].params).toEqual(["id (path)"]);
    expect(endpointCurl(eps[1], openApiBase(doc))).toBe("curl -X PATCH 'https://api.x.dev/v1/users/:id' \\\n  -H 'Accept: application/json' \\\n  -H 'Content-Type: application/json' \\\n  -d '{}'");
    expect(() => openApiEndpoints({})).toThrow();
  });
});

describe("linters", () => {
  it("lints a Dockerfile", () => {
    const rules = lintDockerfile("FROM node\nRUN apt-get update && \\\n  apt-get install curl\nADD . /app\nENV API_KEY=abc\nCMD node app.js\n").map((i) => `${i.line}:${i.rule}`);
    expect(rules).toEqual(expect.arrayContaining(["1:DL3006", "2:DL3014", "4:DL3020", "5:SEC-env", "6:DL3025", "6:DL3002"]));
    expect(lintDockerfile("FROM node:20-slim\nUSER node\nHEALTHCHECK CMD true\nCMD [\"node\"]\n")).toEqual([]);
  });

  it("lints a workflow", () => {
    const text = "on: push\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v2\n      - uses: foo/bar@main\n      - run: echo \"::set-output name=x::1\"\n  test:\n    runs-on: ubuntu-latest\n    needs: nope\n";
    const rules = lintWorkflow(parseYaml(text), text).map((i) => `${i.line}:${i.rule}`);
    expect(rules).toEqual(expect.arrayContaining(["3:runs-on", "5:uses-old", "6:uses-branch", "7:set-output", "8:needs", "1:permissions"]));
  });

  it("lints Kubernetes", () => {
    const text = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 1\n  template:\n    spec:\n      containers:\n        - name: app\n          image: nginx\n          securityContext:\n            privileged: true\n          env:\n            - name: DB_PASSWORD\n              value: hunter2\n";
    const docs = splitYamlDocs(text).map((d) => parseYaml(d));
    const rules = lintK8s(docs, text).map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["replicas", "image-tag", "limits", "privileged", "secret-env", "readiness"]));
  });
});

describe("CSV", () => {
  const csv = "name,age,city\nAda,36,London\nBob,,Paris\nCy,25,london\n";
  it("computes stats", () => {
    const s = csvColumnStats(csv);
    expect(s[1]).toMatchObject({ name: "age", type: "integer", empty: 1, min: "25", max: "36", mean: 30.5 });
    expect(s[2].unique).toBe(3);
  });

  it("filters and sorts", () => {
    expect(csvFilter(csv, "city = london").text).toBe("name,age,city\nAda,36,London\nCy,25,london\n");
    expect(csvFilter(csv, "age > 30 or name startswith B").kept).toBe(2);
    expect(csvFilter(csv, "age empty").kept).toBe(1);
    expect(() => csvFilter(csv, "zip = 1")).toThrow(/zip/);
    expect(csvSort(csv, "age", true).split("\n")[1]).toBe("Ada,36,London");
    expect(csvSort(csv, "age").split("\n").slice(1, 4)).toEqual(["Cy,25,london", "Ada,36,London", "Bob,,Paris"]);
  });
});

describe("Markdown tables", () => {
  const t = "| a | b |\n| - | -: |\n| 2 | x |\n| 10 | y |";
  it("finds bounds and columns", () => {
    const lines = ["text", ...t.split("\n"), ""];
    expect(tableBounds(lines, 3)).toEqual({ start: 1, end: 4 });
    expect(tableBounds(lines, 0)).toBeNull();
    expect(columnAt("| 2 | x |", 6)).toBe(1);
    expect(columnAt("| 2 | x |", 2)).toBe(0);
  });

  it("edits columns", () => {
    expect(editTable(t, 0, "sortDesc")).toBe("| a   |   b |\n| --- | --: |\n| 10  |   y |\n| 2   |   x |");
    expect(editTable(t, 0, "delete")).toBe("|   b |\n| --: |\n|   x |\n|   y |");
    expect(editTable(t, 0, "insertRight").split("\n")[0]).toBe("| a   |     |   b |");
    expect(editTable(t, 1, "moveLeft").split("\n")[0]).toBe("|   b | a   |");
  });
});

describe("code helpers", () => {
  it("re-indents pasted code", () => {
    expect(reindentPaste("if (x) {\n        y();\n    }", "  ")).toBe("if (x) {\n      y();\n  }");
    expect(reindentPaste("a\n\tb\nc", "    ", false)).toBe("    a\n    \tb\n    c".replace("\t", "    "));
  });

  it("builds barrels", () => {
    expect(barrelFor(["src/a.ts", "src/index.ts", "src/b.test.ts", "src/C.tsx", "src/x.css"])).toBe('export * from "./C";\nexport * from "./a";\n');
    expect(barrelFor(["a.ts"], "named", { a: ["x", "y"] })).toBe('export { x, y } from "./a";\n');
  });

  it("toggles arrow functions", () => {
    expect(toggleArrow("export function add(a: number, b: number): number {\n  return a + b;\n}")).toBe("export const add = (a: number, b: number): number => a + b;");
    expect(toggleArrow("const add = (a, b) => a + b;")).toBe("function add(a, b) {\n  return a + b;\n}");
    expect(toggleArrow("async function go() {\n  await x();\n  y();\n}")).toBe("const go = async () => {\n  await x();\n  y();\n};");
    expect(toggleArrow("const go = async () => {\n  await x();\n};")).toBe("async function go() {\n  await x();\n}");
    expect(() => toggleArrow("let x = 1;")).toThrow();
  });

  it("finds duplicate keys", () => {
    expect(duplicateKeys('{\n  "a": 1,\n  "b": { "a": 2 },\n  "a": 3\n}', false)).toEqual([{ key: "a", line: 4, first: 2 }]);
    expect(duplicateKeys("a: 1\nb:\n  a: 2\n  c: 1\n  c: 2\nitems:\n  - x: 1\n  - x: 2\na: 3\n", true)).toEqual([
      { key: "c", line: 5, first: 4 },
      { key: "a", line: 9, first: 1 },
    ]);
  });
});
