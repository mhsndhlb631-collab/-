import { describe, expect, it } from "vitest";
import { syncStatusCopy } from "../../src/offline/sync-copy";

describe("syncStatusCopy", () => {
  it("reassures the user that offline work remains on the device", () => {
    expect(
      syncStatusCopy("offline", { pending: 3, failed: 0, conflicts: 0 }),
    ).toEqual({
      label: "غير متصل",
      detail: "سيُحفظ عملك على هذا الجهاز",
    });
  });

  it("prioritizes conflicts over ordinary pending work", () => {
    expect(
      syncStatusCopy("online", { pending: 2, failed: 1, conflicts: 1 }).label,
    ).toBe("1 تحتاج مراجعة");
  });

  it("reports a completed state only when every count is clear", () => {
    expect(
      syncStatusCopy("online", { pending: 0, failed: 0, conflicts: 0 }).label,
    ).toBe("تمت المزامنة");
  });
});
