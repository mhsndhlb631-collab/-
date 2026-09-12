import { describe, expect, it } from "vitest";
import { selectTodayFocus } from "../../src/app/today-focus";

const session = {
  name: "حلقة الجمعة",
  group_name: "المجموعة الأولى",
  starts_at: "2026-09-12T10:00:00.000Z",
  status: "PLANNED",
};

describe("role-first daily focus", () => {
  it("puts responsible attention ahead of a scheduled session", () => {
    expect(
      selectTodayFocus("RESPONSIBLE", { attentions: 2, actions: 1 }, [session]),
    ).toMatchObject({ view: "reports", tone: "attention" });
  });

  it("puts an open session first for a mentor", () => {
    expect(
      selectTodayFocus("MENTOR", {}, [{ ...session, status: "OPEN" }]),
    ).toMatchObject({
      view: "sessions",
      tone: "live",
      action: "متابعة الجلسة",
    });
  });

  it("puts assignments first for a student", () => {
    expect(
      selectTodayFocus("STUDENT", { assignments: 2, tracking: 3 }, [session]),
    ).toMatchObject({ view: "learning", action: "فتح التكاليف" });
  });

  it("never sends an idle student to a staff screen", () => {
    expect(selectTodayFocus("STUDENT", {}, []).view).toBe("progress");
  });
});
