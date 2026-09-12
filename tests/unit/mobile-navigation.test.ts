import { describe, expect, it } from "vitest";
import { mobileDestinations } from "../../src/app/mobile-navigation";

describe("role-aware mobile navigation", () => {
  it("keeps every role focused on four frequent destinations", () => {
    for (const role of ["RESPONSIBLE", "MENTOR", "STUDENT"] as const)
      expect(mobileDestinations(role)).toHaveLength(4);
  });

  it("does not expose staff-only destinations to students", () => {
    const studentViews = mobileDestinations("STUDENT").map((item) => item.view);
    expect(studentViews).not.toContain("people");
    expect(studentViews).not.toContain("sessions");
    expect(studentViews).not.toContain("followup");
  });

  it("puts session capture in the mentor primary navigation", () => {
    expect(mobileDestinations("MENTOR").map((item) => item.view)).toContain(
      "sessions",
    );
  });
});
