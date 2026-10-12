import { describe, expect, it } from "vitest";
import { buildPayload, contrastRatio, EMPTY, payloadWarning, suggestName } from "./payload";

describe("QR payloads", () => {
  it("builds Wi-Fi strings with escaping", () => {
    expect(buildPayload("wifi", { ...EMPTY, ssid: "Home; Net", password: 'p:a"ss\\', security: "WPA" })).toBe('WIFI:T:WPA;S:Home\\; Net;P:p\\:a\\"ss\\\\;;');
    expect(buildPayload("wifi", { ...EMPTY, ssid: "Cafe", security: "nopass", password: "ignored", hidden: true })).toBe("WIFI:T:nopass;S:Cafe;H:true;;");
    expect(buildPayload("wifi", EMPTY)).toBe("");
  });

  it("builds a vCard", () => {
    expect(buildPayload("contact", { ...EMPTY, name: "Ada King Lovelace", phone: "+44 20 1234", mail: "ada@example.org", org: "Engines, Ltd", url: "https://example.org" })).toBe(
      ["BEGIN:VCARD", "VERSION:3.0", "N:Lovelace;Ada King;;;", "FN:Ada King Lovelace", "ORG:Engines\\, Ltd", "TEL;TYPE=CELL:+44 20 1234", "EMAIL:ada@example.org", "URL:https://example.org", "END:VCARD"].join("\n"),
    );
    expect(buildPayload("contact", { ...EMPTY, name: "Cher" })).toContain("N:;Cher;;;");
    expect(buildPayload("contact", EMPTY)).toBe("");
  });

  it("builds mailto links and passes text through", () => {
    expect(buildPayload("email", { ...EMPTY, to: "a@b.co", subject: "Hi there", body: "Line 1\nLine 2 & more" })).toBe("mailto:a@b.co?subject=Hi%20there&body=Line%201%0ALine%202%20%26%20more");
    expect(buildPayload("email", { ...EMPTY, to: "a@b.co" })).toBe("mailto:a@b.co");
    expect(buildPayload("text", { ...EMPTY, text: " keep spaces " })).toBe(" keep spaces ");
  });

  it("warns about likely mistakes", () => {
    expect(payloadWarning("wifi", { ...EMPTY, ssid: "x", password: "short" })).toMatch(/8 characters/);
    expect(payloadWarning("wifi", { ...EMPTY, ssid: "x", password: "longenough" })).toBeNull();
    expect(payloadWarning("email", { ...EMPTY, to: "nope" })).toMatch(/e-mail/);
    expect(payloadWarning("text", { ...EMPTY, text: "example.com/page" })).toMatch(/https/);
    expect(payloadWarning("text", { ...EMPTY, text: "https://example.com" })).toBeNull();
  });

  it("suggests file names and measures contrast", () => {
    expect(suggestName("text", { ...EMPTY, text: "https://Example.org/Some Page?x=1" })).toBe("qr-example-org-some-page-x-1");
    expect(suggestName("wifi", { ...EMPTY, ssid: "My Net" })).toBe("qr-wifi-my-net");
    expect(suggestName("text", EMPTY)).toBe("qr-code");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(1.5);
  });
});
