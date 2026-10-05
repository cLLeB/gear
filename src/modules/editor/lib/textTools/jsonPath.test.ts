import { describe, expect, it } from "vitest";
import { formatPath, jsonPathAt, yamlPathAt } from "./jsonPath";

const at = (doc: string) => {
  const offset = doc.indexOf("|");
  return { text: doc.replace("|", ""), offset };
};

describe("jsonPathAt", () => {
  it("follows objects and arrays", () => {
    const { text, offset } = at(`{"a": {"b": [1, {"c": "x|y"}]}}`);
    expect(jsonPathAt(text, offset)).toEqual(["a", "b", 1, "c"]);
  });

  it("works on keys, JSON5 bare keys and with comments", () => {
    const { text, offset } = at(`{\n  // note: {"z": 1}\n  foo: 1,\n  'bar': [0, 1, 2|]\n}`);
    expect(jsonPathAt(text, offset)).toEqual(["bar", 2]);
    const k = at(`{"first": 1, "sec|ond": 2}`);
    expect(jsonPathAt(k.text, k.offset)).toEqual(["second"]);
  });

  it("returns the container path before any key", () => {
    const { text, offset } = at(`{"a": {|}}`);
    expect(jsonPathAt(text, offset)).toEqual(["a"]);
  });

  it("handles escaped quotes and closed siblings", () => {
    const { text, offset } = at(`{"a": "x\\"}", "b": {"c": 1}, "d": [[], [|]]}`);
    expect(jsonPathAt(text, offset)).toEqual(["d", 1, 0]);
  });
});

describe("yamlPathAt", () => {
  it("follows nested keys and list items", () => {
    const doc = `name: app\nspec:\n  containers:\n    - name: web\n      image: nginx\n    - name: sidecar\n      ports:\n        - containerPort: 80|80\n`;
    const { text, offset } = at(doc);
    expect(yamlPathAt(text, offset)).toEqual(["spec", "containers", 1, "ports", 0, "containerPort"]);
  });

  it("handles sequences at the parent's indent and quoted keys", () => {
    const { text, offset } = at(`jobs:\n  build:\n    steps:\n    - uses: x\n    - "run it": |y\n`);
    expect(yamlPathAt(text, offset)).toEqual(["jobs", "build", "steps", 1, "run it"]);
  });

  it("ignores comments and blank lines", () => {
    const { text, offset } = at(`a:\n  # c: 1\n\n  b: 2|\n`);
    expect(yamlPathAt(text, offset)).toEqual(["a", "b"]);
  });
});

describe("formatPath", () => {
  const path = ["users", 0, "first-name"];
  it("renders each syntax", () => {
    expect(formatPath(path, "jsonpath")).toBe("$.users[0]['first-name']");
    expect(formatPath(path, "jq")).toBe('.users[0]["first-name"]');
    expect(formatPath(path, "js")).toBe('data.users[0]["first-name"]');
    expect(formatPath(["a/b", "~"], "pointer")).toBe("/a~1b/~0");
    expect(formatPath(path, "dotted")).toBe("users.0.first-name");
    expect(formatPath([0], "jq")).toBe(".[0]");
  });
});
