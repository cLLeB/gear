import { beforeEach, describe, expect, it } from "vitest";
import { clearNotificationHistory, notificationHistory, recordNotification } from "./history";

describe("notification history", () => {
  beforeEach(() => clearNotificationHistory());

  it("keeps newest first and skips non-text titles", () => {
    recordNotification("info", "one", undefined, 1000);
    recordNotification("error", "two", "why", 20_000);
    recordNotification("info", { jsx: true }, undefined, 30_000);
    expect(notificationHistory().map((e) => e.title)).toEqual(["two", "one"]);
    expect(notificationHistory()[0].description).toBe("why");
  });

  it("collapses quick repeats", () => {
    recordNotification("info", "same", undefined, 1000);
    recordNotification("info", "same", undefined, 3000);
    expect(notificationHistory()).toHaveLength(1);
    expect(notificationHistory()[0].at).toBe(3000);
  });
});
