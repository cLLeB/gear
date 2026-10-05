import { describe, expect, it } from "vitest";
import {
  chmodInfo,
  cidrInfo,
  convertUnits,
  dateDiff,
  explainSemverRange,
  formatDuration,
  generatePassphrase,
  generatePassword,
  parseDuration,
  parseZonedTime,
  passwordEntropyBits,
  semverSatisfies,
  splitSubnets,
  worldTimes,
} from "./calculators";
import { explainExitCode, explainRegex, signJwtHs256, verifyJwtHs256 } from "./references";

describe("cidr", () => {
  it("describes a network", () => {
    expect(cidrInfo("192.168.1.130/26")).toMatchObject({
      cidr: "192.168.1.128/26",
      netmask: "255.255.255.192",
      wildcard: "0.0.0.63",
      broadcast: "192.168.1.191",
      firstHost: "192.168.1.129",
      lastHost: "192.168.1.190",
      hosts: 62,
      private: true,
    });
    expect(cidrInfo("10.1.2.3 255.255.0.0").cidr).toBe("10.1.0.0/16");
    expect(cidrInfo("8.8.8.8/32")).toMatchObject({ hosts: 1, private: false });
    expect(() => cidrInfo("300.1.1.1/8")).toThrow();
    expect(() => cidrInfo("1.1.1.1 255.0.255.0")).toThrow(/contiguous/);
  });

  it("splits subnets", () => {
    expect(splitSubnets("10.0.0.0/24", 26)).toEqual(["10.0.0.0/26", "10.0.0.64/26", "10.0.0.128/26", "10.0.0.192/26"]);
  });
});

describe("chmod", () => {
  it("converts between forms", () => {
    expect(chmodInfo("755")).toMatchObject({ octal: "755", symbolic: "rwxr-xr-x" });
    expect(chmodInfo("-rw-r-----").octal).toBe("640");
    expect(chmodInfo("u=rwx,g=rx,o=").symbolic).toBe("rwxr-x---");
    expect(chmodInfo("4755")).toMatchObject({ symbolic: "rwsr-xr-x", octal: "4755" });
    expect(chmodInfo("1777").symbolic).toBe("rwxrwxrwt");
    expect(chmodInfo("644").description[0]).toBe("Owner: read, write");
  });
});

describe("semver ranges", () => {
  it("explains npm ranges", () => {
    expect(explainSemverRange("^1.2.3")).toEqual([">=1.2.3 <2.0.0"]);
    expect(explainSemverRange("^0.2.3")).toEqual([">=0.2.3 <0.3.0"]);
    expect(explainSemverRange("^0.0.3")).toEqual([">=0.0.3 <0.0.4"]);
    expect(explainSemverRange("~1.2")).toEqual([">=1.2.0 <1.3.0"]);
    expect(explainSemverRange("1.x || >=2.5.0 <3")).toEqual([">=1.0.0 <2.0.0", ">=2.5.0 <3.0.0"]);
    expect(explainSemverRange("1.2.3 - 2.3")).toEqual([">=1.2.3 <2.4.0"]);
  });

  it("checks satisfaction", () => {
    expect(semverSatisfies("1.9.0", "^1.2.3")).toBe(true);
    expect(semverSatisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(semverSatisfies("2.6.1", "1.x || >=2.5.0 <3")).toBe(true);
    expect(semverSatisfies("1.3.0-beta.1", "^1.2.3")).toBe(false);
    expect(semverSatisfies("1.3.0-beta.2", ">=1.3.0-beta.1")).toBe(true);
  });
});

describe("durations, dates and zones", () => {
  it("parses many duration spellings", () => {
    expect(parseDuration("1h 30m")).toBe(5_400_000);
    expect(parseDuration("2d4h")).toBe(187_200_000);
    expect(parseDuration("1:30:00")).toBe(5_400_000);
    expect(parseDuration("PT1H30M")).toBe(5_400_000);
    expect(parseDuration("90")).toBe(90_000);
    expect(formatDuration(93_784_005)).toBe("1d 2h 3m 4s 5ms");
  });

  it("diffs dates", () => {
    const d = Object.fromEntries(dateDiff("2024-01-01", "2024-03-01").map((x) => [x.label, x.value]));
    expect(d.Days).toBe("60");
    expect(d["Whole months"]).toBe("2");
    expect(d["Business days"]).toBe("44");
  });

  it("converts zoned times", () => {
    const t = parseZonedTime("2024-07-01 09:00 America/New_York");
    expect(t.toISOString()).toBe("2024-07-01T13:00:00.000Z");
    expect(parseZonedTime("2024-01-15 9:30pm Tokyo").toISOString()).toBe("2024-01-15T12:30:00.000Z");
    const row = worldTimes(new Date("2024-07-01T13:00:00Z"), ["Asia/Kolkata"])[0];
    expect(row.offset).toBe("UTC+5:30");
    expect(row.time).toContain("18:30");
  });
});

describe("units", () => {
  it("converts css, temperature and sizes", () => {
    expect(convertUnits("24px")[0].value).toBe("1.5rem");
    expect(convertUnits("2rem", 10)[0].value).toBe("20px");
    expect(convertUnits("100f")[0].value).toBe("37.777778°C");
    expect(convertUnits("1GiB").find((x) => x.label === "mb")!.value).toBe("1073.741824 mb");
    expect(convertUnits("5km").find((x) => x.label === "mi")!.value).toBe("3.106856 mi");
    expect(() => convertUnits("5 parsecs")).toThrow();
  });
});

describe("passwords", () => {
  it("honours sets and length, without ambiguous characters", () => {
    const opts = { length: 24, upper: true, lower: true, digits: true, symbols: false, unambiguous: true };
    for (let i = 0; i < 20; i++) {
      const p = generatePassword(opts);
      expect(p).toHaveLength(24);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/\d/);
      expect(p).not.toMatch(/[0O1lI]/);
      expect(p).not.toMatch(/[!@#]/);
    }
    expect(passwordEntropyBits({ ...opts, unambiguous: false })).toBe(143);
    expect(generatePassphrase(4).split("-")).toHaveLength(4);
    expect(() => generatePassword({ ...opts, upper: false, lower: false, digits: false })).toThrow();
  });
});

describe("references", () => {
  it("explains regexes", () => {
    const parts = explainRegex("^(?<year>\\d{4})-[0-9]+\\b(?!x)$");
    expect(parts.map((p) => p.token)).toEqual(["^", "(?<year>", "\\d", "{4}", ")", "-", "[0-9]", "+", "\\b", "(?!", "x", ")", "$"]);
    expect(parts[1].meaning).toBe('start of capture group 1 named "year"');
    expect(parts[3].meaning).toBe("…repeated exactly 4 times");
    expect(parts[6].meaning).toBe("one of 0–9");
    expect(explainRegex("/ab+/g").map((p) => p.token)).toEqual(["a", "b", "+"]);
  });

  it("explains exit codes", () => {
    expect(explainExitCode(127)).toMatch(/not found/);
    expect(explainExitCode(137)).toMatch(/SIGKILL/);
    expect(explainExitCode(130)).toMatch(/Ctrl\+C/);
    expect(explainExitCode(-1073741819)).toMatch(/ACCESS_VIOLATION/);
  });

  it("signs and verifies HS256 tokens", async () => {
    const t = await signJwtHs256({ sub: "1" }, "secret", 1700000000);
    expect(t.split(".")[0]).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(await verifyJwtHs256(t, "secret")).toBe(true);
    expect(await verifyJwtHs256(t, "wrong")).toBe(false);
  });
});
