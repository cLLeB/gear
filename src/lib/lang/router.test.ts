import { describe, expect, it } from "vitest";
import { createRouter } from "./router";

const router = () =>
  createRouter([
    "/",
    "/users",
    "/users/me",
    "/users/:id",
    "/users/:id/posts/:postId",
    "/files/*",
  ]);

describe("Router", () => {
  it("matches the root path", () => {
    expect(router().match("/")).toEqual({ route: "/", params: {} });
  });

  it("matches a static route", () => {
    expect(router().match("/users")).toEqual({ route: "/users", params: {} });
  });

  it("extracts a named parameter", () => {
    expect(router().match("/users/42")).toEqual({ route: "/users/:id", params: { id: "42" } });
  });

  it("extracts multiple parameters", () => {
    expect(router().match("/users/7/posts/99")).toEqual({
      route: "/users/:id/posts/:postId",
      params: { id: "7", postId: "99" },
    });
  });

  it("prefers a static segment over a parameter", () => {
    expect(router().match("/users/me")).toEqual({ route: "/users/me", params: {} });
  });

  it("captures the rest of the path with a wildcard", () => {
    expect(router().match("/files/a/b/c.txt")).toEqual({
      route: "/files/*",
      params: { "*": "a/b/c.txt" },
    });
  });

  it("returns null for an unmatched path", () => {
    expect(router().match("/nope")).toBeNull();
    expect(router().match("/users/1/comments")).toBeNull();
  });

  it("backtracks from a dead-end static branch to a parameter route", () => {
    const r = createRouter(["/a/b/c", "/a/:x/d"]);
    // /a/b/d cannot complete the static b->c branch, must fall back to :x->d.
    expect(r.match("/a/b/d")).toEqual({ route: "/a/:x/d", params: { x: "b" } });
  });

  it("supports a named wildcard", () => {
    const r = createRouter(["/static/*path"]);
    expect(r.match("/static/css/app.css")).toEqual({
      route: "/static/*path",
      params: { path: "css/app.css" },
    });
  });
});
