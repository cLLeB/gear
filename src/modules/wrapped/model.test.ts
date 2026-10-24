import { describe, expect, it } from "vitest";
import { commandLabel, favorites, formatHour, formatWait, parseHistory, parseLog, personaFor, prune, rangeFor, recordCommand, summarize, type Log } from "./model";

describe("Gear Wrapped", () => {
  it("labels commands without keeping their arguments", () => {
    expect(commandLabel("git commit -m 'secret token abc'")).toBe("git commit");
    expect(commandLabel("cargo build --release")).toBe("cargo build");
    expect(commandLabel("FOO=1 BAR=2 sudo -E npm install")).toBe("npm install");
    expect(commandLabel("npx vitest run")).toBe("vitest");
    expect(commandLabel('& "C:\\Program Files\\Git\\bin\\git.exe" status')).toBe("git status");
    expect(commandLabel(".\\scripts\\deploy.ps1 prod")).toBe("deploy");
    expect(commandLabel("ssh user@host.example.com")).toBe("ssh");
    expect(commandLabel("git --version")).toBe("git");
    expect(commandLabel("   ")).toBeNull();
    expect(commandLabel("{ echo hi; }")).toBeNull();
  });

  it("records commands per day, hour and label", () => {
    const empty: Log = {};
    let log = recordCommand(empty, "2026-03-01", 23, "cargo build", 0, 90_000);
    log = recordCommand(log, "2026-03-01", 23, "cargo test", 101, 5_000);
    log = recordCommand(log, "2026-03-01", 9, "cd src", 0, 1);
    log = recordCommand(log, "2026-03-01", 9, "", 0, 1);
    expect(empty).toEqual({});
    const d = log["2026-03-01"];
    expect(d.n).toBe(3);
    expect(d.fail).toBe(1);
    expect(d.hours[23]).toBe(2);
    expect(d.hours[9]).toBe(1);
    expect(d.labels).toEqual({ "cargo build": 1, "cargo test": 1, cd: 1 });
    expect(d.longest).toEqual({ label: "cargo build", ms: 90_000 });
    expect(parseLog(JSON.stringify(log))).toEqual(log);
    expect(parseLog("{oops")).toEqual({});
    expect(parseLog(JSON.stringify({ nope: d, "2026-01-01": { n: 1 } }))).toEqual({});
    expect(Object.keys(prune({ ...log, "2024-01-01": d }, "2026-03-02"))).toEqual(["2026-03-01"]);
  });

  it("reads every shell's history format", () => {
    const text = [
      "git status",
      "#1700000000",
      "git status",
      ": 1700000000:0;cargo run",
      "- cmd: docker compose up",
      "  when: 1700000000",
      "cd ..",
    ].join("\n");
    expect(parseHistory(text)).toEqual({ "git status": 2, "cargo run": 1, "docker compose": 1, cd: 1 });
  });

  it("names the range", () => {
    const today = new Date(2026, 9, 24);
    expect(rangeFor("year", today)).toMatchObject({ from: "2026-01-01", to: "2026-10-24", title: "Your 2026 in Gear" });
    expect(rangeFor("month", today)).toMatchObject({ from: "2026-10-01", to: "2026-10-24", label: "October" });
    expect(rangeFor("lastMonth", today)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "September" });
    expect(rangeFor("lastMonth", new Date(2026, 0, 5))).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("sums a range into a recap", () => {
    let log: Log = {};
    for (let i = 0; i < 5; i++) log = recordCommand(log, "2026-10-22", 23, "cargo build", 0, 1000 * i);
    log = recordCommand(log, "2026-10-23", 1, "git commit -m x", 0, 300);
    log = recordCommand(log, "2026-10-23", 1, "cd ..", 0, 10);
    log = recordCommand(log, "2026-10-24", 2, "cargo test", 1, 60_000);
    log = recordCommand(log, "2026-09-01", 10, "npm test", 0, 999_999);
    const time = { "2026-10-23": { total: 3600, projects: { "/w/gear": 3600 }, languages: { rust: 3000, markdown: 600 }, files: {}, kinds: {} } };
    const s = summarize(log, rangeFor("month", new Date(2026, 9, 24)), "2026-10-24", time, { "git push": 40, cd: 500, "cargo build": 12 });
    expect(s.commands).toBe(8);
    expect(s.failed).toBe(1);
    expect(s.activeDays).toBe(3);
    expect(s.top[0]).toEqual(["cargo build", 5]);
    expect(s.top.some(([l]) => l === "cd")).toBe(false);
    expect(s.wandering).toBe(1);
    expect(s.commits).toBe(1);
    expect(s.peakHour).toBe(23);
    expect(s.longest).toEqual({ label: "cargo test", ms: 60_000, day: "2026-10-24" });
    expect(s.busiest).toEqual({ day: "2026-10-22", count: 5 });
    expect(s.streak).toBe(3);
    expect(s.time?.languages[0]).toEqual(["rust", 3000]);
    expect(s.history).toEqual({ total: 552, top: [["git push", 40], ["cargo build", 12]] });
    expect(s.persona.title).toBe("The Night Owl Rustacean");
  });

  it("celebrates shell-history favourites until the log has enough", () => {
    let log: Log = {};
    log = recordCommand(log, "2026-10-24", 10, "echo hi", 0, 5);
    const range = rangeFor("month", new Date(2026, 9, 24));
    const thin = summarize(log, range, "2026-10-24", null, { "git push": 40 });
    expect(favorites(thin)).toEqual({ rows: [["git push", 40]], fromHistory: true });
    for (let i = 0; i < 60; i++) log = recordCommand(log, "2026-10-24", 10, "cargo test", 0, 5);
    expect(favorites(summarize(log, range, "2026-10-24", null, { "git push": 40 })).fromHistory).toBe(false);
    expect(favorites(summarize(log, range, "2026-10-24", null, null)).rows[0]).toEqual(["cargo test", 60]);
    // Sub-second waits are not trophies.
    expect(thin.longest).toBeNull();
  });

  it("finds a persona even with little to go on", () => {
    const hours = new Array(24).fill(0);
    expect(personaFor(hours, null, []).title).toBe("The Fresh-Start Terminal Tamer");
    hours[7] = 10;
    expect(personaFor(hours, null, [["docker compose", 3]]).title).toBe("The Early Bird Container Captain");
    hours[14] = 30;
    expect(personaFor(hours, "python", []).title).toBe("The Daylight Pythonista");
  });

  it("formats hours and waits", () => {
    expect([0, 9, 12, 23].map(formatHour)).toEqual(["midnight", "9 AM", "noon", "11 PM"]);
    expect([4_000, 125_000, 3_725_000].map(formatWait)).toEqual(["4s", "2m 05s", "1h 02m"]);
  });
});
