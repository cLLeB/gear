import { describe, expect, it } from "vitest";
import type { MockRequest } from "@/modules/tools/paneHandle";
import { curlFor, examplePath, mergeLog, parseRoutes, routeProblem, SAMPLE_ROUTES, serializeRoutes, shadowed, statusTone } from "./model";

const req = (seq: number): MockRequest => ({ seq, atMs: seq, method: "GET", path: "/", query: "", headers: [], body: "", status: 200, route: 0 });

describe("mock server model", () => {
  it("accepts the sample routes and rejects bad ones", () => {
    for (const r of SAMPLE_ROUTES) expect(routeProblem(r)).toBeNull();
    expect(routeProblem({ method: "FETCH", path: "/x" })).toMatch(/unknown method/);
    expect(routeProblem({ method: "GET", path: "x" })).toMatch(/start with/);
    expect(routeProblem({ method: "GET", path: "/a b" })).toMatch(/spaces/);
    expect(routeProblem({ method: "GET", path: "/a/*/b" })).toMatch(/last segment/);
    expect(routeProblem({ method: "GET", path: "/a/:" })).toMatch(/name/);
    expect(routeProblem({ method: "GET", path: "/a", status: 99 })).toMatch(/status/);
    expect(routeProblem({ method: "GET", path: "/a", delayMs: 70000 })).toMatch(/delay/);
  });

  it("finds routes hidden behind an earlier one", () => {
    expect(shadowed([{ method: "GET", path: "/users/:id" }, { method: "GET", path: "/users/:name" }, { method: "POST", path: "/users/:id" }, { method: "*", path: "/x" }, { method: "PUT", path: "/x/" }])).toEqual([1, 4]);
  });

  it("round-trips a route file, keeping JSON bodies as JSON", () => {
    const text = serializeRoutes(SAMPLE_ROUTES);
    expect(JSON.parse(text).routes[1].body).toEqual([{ id: 1, name: "Ada" }, { id: 2, name: "Linus" }]);
    // A templated body is not valid JSON on its own, so it stays text.
    expect(typeof JSON.parse(text).routes[2].body).toBe("string");
    const back = parseRoutes(text);
    expect(back.error).toBeNull();
    expect(back.routes.map((r) => `${r.method} ${r.path} ${r.status}`)).toEqual(SAMPLE_ROUTES.map((r) => `${r.method} ${r.path} ${r.status}`));
    expect(JSON.parse(back.routes[0].body ?? "")).toEqual({ ok: true });
  });

  it("reads a bare array, header maps and reports problems", () => {
    const r = parseRoutes('[{"path":"/a","headers":{"X-A":1},"body":{"k":1}}]');
    expect(r.routes[0]).toMatchObject({ method: "GET", path: "/a", status: 200, headers: [["X-A", "1"]] });
    expect(parseRoutes("{").error).toMatch(/Not valid JSON/);
    expect(parseRoutes('{"x":1}').error).toMatch(/array/);
    expect(parseRoutes('[{"method":"GET","path":"nope"}]').error).toMatch(/Route 1 \(GET nope\)/);
    expect(parseRoutes("[1]").error).toMatch(/not an object/);
  });

  it("builds example requests", () => {
    expect(examplePath("/users/:id/files/*")).toBe("/users/1/files/anything");
    expect(examplePath("/tags/:slug")).toBe("/tags/slug");
    expect(curlFor({ method: "GET", path: "/users/:id" }, 4010)).toBe("curl -i http://127.0.0.1:4010/users/1");
    expect(curlFor({ method: "POST", path: "/users" }, 4010)).toContain("-X POST -H");
  });

  it("merges the log newest first without duplicates", () => {
    const log = mergeLog([req(2), req(1)], [req(2), req(3), req(4)]);
    expect(log.map((r) => r.seq)).toEqual([4, 3, 2, 1]);
    expect(mergeLog(log, [], 2)).toBe(log);
    expect(mergeLog(log, [req(5)], 2).map((r) => r.seq)).toEqual([5, 4]);
    expect([200, 302, 404, 503].map(statusTone)).toEqual(["ok", "redirect", "client", "server"]);
  });
});
