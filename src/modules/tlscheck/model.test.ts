import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkChain, daysLeft, derToPem, explainTrustError, fingerprint, matchesHost, parseCertificate, pemToDer, type Certificate } from "./model";

const fx = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf8");
const rsa = parseCertificate(pemToDer(fx("rsa-leaf.pem"))[0]);
const ec = parseCertificate(pemToDer(fx("ec-ca.pem"))[0]);
const at = (iso: string) => Date.parse(iso);

describe("certificate reader", () => {
  it("reads an RSA server certificate", () => {
    expect(rsa.version).toBe(3);
    expect(rsa.serial).toBe("644980B4E222DB13A95F56C7A269DB48E848C8D0");
    expect(rsa.signatureAlgorithm).toBe("SHA-256 with RSA");
    expect(rsa.subject.text).toBe("CN=test.example, O=Gear Test, C=GB");
    expect(rsa.subject.cn).toBe("test.example");
    expect(rsa.subject.org).toBe("Gear Test");
    expect(rsa.notBefore.toISOString()).toBe("2026-10-14T21:43:47.000Z");
    expect(rsa.notAfter.toISOString()).toBe("2026-11-13T21:43:47.000Z");
    expect(rsa.key).toEqual({ type: "RSA", bits: 2048 });
    expect(rsa.sans).toEqual({ dns: ["test.example", "*.test.example"], ip: ["127.0.0.1"], email: [], uri: [] });
    expect(rsa.extendedKeyUsage).toEqual(["Server authentication"]);
    expect(rsa.selfSigned).toBe(true);
  });

  it("reads an EC CA certificate", () => {
    expect(ec.key).toEqual({ type: "EC", bits: 256, curve: "P-256" });
    expect(ec.signatureAlgorithm).toBe("ECDSA with SHA-256");
    expect(ec.isCa).toBe(true);
    expect(ec.subject.cn).toBe("Gear EC CA");
  });

  it("computes fingerprints and round-trips PEM", async () => {
    expect(await fingerprint(rsa.der)).toBe("5D:36:8E:BF:B1:ED:80:1C:F3:67:34:E0:C4:39:AB:B2:27:A7:03:81:D9:86:7F:87:05:65:C0:7F:B0:84:57:F5");
    expect(await fingerprint(ec.der)).toBe("DC:D7:78:7F:34:12:0F:51:F9:E2:04:7F:3A:7F:CB:5F:78:37:8B:14:28:79:40:7B:E2:79:A9:63:30:87:FB:71");
    expect(pemToDer(derToPem(rsa.der))[0]).toEqual(rsa.der);
    expect(pemToDer(fx("rsa-leaf.pem") + fx("ec-ca.pem"))).toHaveLength(2);
    expect(pemToDer("nothing here")).toEqual([]);
    expect(() => parseCertificate(new Uint8Array([0x30, 0x82, 0x10]))).toThrow();
  });

  it("matches host names like a browser", () => {
    expect(matchesHost(rsa, "test.example")).toBe(true);
    expect(matchesHost(rsa, "api.test.example")).toBe(true);
    expect(matchesHost(rsa, "API.Test.Example.")).toBe(true);
    expect(matchesHost(rsa, "a.b.test.example")).toBe(false);
    expect(matchesHost(rsa, "other.example")).toBe(false);
    expect(matchesHost(rsa, "127.0.0.1")).toBe(true);
    expect(matchesHost(rsa, "127.0.0.2")).toBe(false);
  });

  it("checks a chain", () => {
    const during = at("2026-10-20T00:00:00Z");
    const f = (c: Certificate[], host: string | null, now = during) => checkChain(c, host, now).map((x) => `${x.severity}: ${x.message}`);
    expect(f([rsa], "test.example")).toEqual(["info: Expires in 24 days.", "warning: Self-signed: only machines that were told to trust it will accept it."]);
    expect(f([rsa], "wrong.example").some((m) => m.startsWith("error: Not valid for wrong.example. It covers: test.example, *.test.example, 127.0.0.1."))).toBe(true);
    expect(f([rsa], null, at("2026-11-20T00:00:00Z"))[0]).toBe("error: Expired 7 days ago, on 2026-11-13.");
    expect(f([rsa], null, at("2026-11-05T00:00:00Z"))[0]).toBe("warning: Expires in 8 days. Renew it now.");
    expect(f([rsa], null, at("2026-10-01T00:00:00Z"))[0]).toMatch(/^error: Not valid yet/);
    // Leaf + unrelated CA: out of order, and the root is sent.
    const both = f([rsa, ec], "test.example");
    expect(both).toContain("warning: The chain is out of order: certificate 1 was not issued by certificate 2.");
    expect(both).toContain("info: The server also sends the root certificate; clients already have it, so it only adds bytes to every handshake.");
    expect(checkChain([], null)[0].severity).toBe("error");
    expect(daysLeft(rsa, during)).toBe(24);
  });

  it("explains verifier errors", () => {
    expect(explainTrustError("invalid peer certificate: UnknownIssuer")).toMatch(/intermediate/);
    expect(explainTrustError("invalid peer certificate: NotValidForName")).toMatch(/host name/);
    expect(explainTrustError("something else")).toBe("something else");
  });
});
