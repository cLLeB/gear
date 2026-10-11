import { describe, expect, it } from "vitest";
import { detectServer, ServerAnnouncer } from "./portDetect";

describe("detectServer", () => {
  it.each([
    ["  ➜  Local:   http://localhost:5173/", "http://localhost:5173/", 5173],
    ["- Local:        http://localhost:3000", "http://localhost:3000/", 3000],
    ["Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)", "http://127.0.0.1:8000/", 8000],
    ["Starting development server at http://0.0.0.0:8000/admin/", "http://localhost:8000/admin/", 8000],
    ["* Listening on http://[::1]:3000", "http://[::1]:3000/", 3000],
    ["Server listening on port 4000", "http://localhost:4000/", 4000],
    ["[info] Running MyAppWeb.Endpoint with cowboy at :4001 (http)", "http://localhost:4001/", 4001],
    ["Listening on :8080", "http://localhost:8080/", 8080],
  ])("%s", (line, url, port) => {
    expect(detectServer(line)).toEqual({ url, port });
  });

  it("ignores errors and unrelated text", () => {
    expect(detectServer("Error: connect ECONNREFUSED http://localhost:5432")).toBeNull();
    expect(detectServer("Error: listen EADDRINUSE: address already in use :::3000 on port 3000")).toBeNull();
    expect(detectServer("see https://example.com:443/docs")).toBeNull();
    expect(detectServer("compiled 12 modules")).toBeNull();
  });
});

describe("ServerAnnouncer", () => {
  it("announces each port once per pane until reset", () => {
    const a = new ServerAnnouncer();
    expect(a.firstSighting(1, 3000)).toBe(true);
    expect(a.firstSighting(1, 3000)).toBe(false);
    expect(a.firstSighting(2, 3000)).toBe(true);
    a.reset(1);
    expect(a.firstSighting(1, 3000)).toBe(true);
  });
});
