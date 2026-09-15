import { describe, expect, it } from "vitest";
import {
  buildOccurrenceDates,
  mentorAssignmentInput,
  normalizeAssignmentValue,
} from "../../src/application/mentor-operations-service";

const base = {
  group_id: "00000000-0000-4000-8000-000000000001",
  title: "ورد الصلاة",
  instructions: "سجل أداء الطالب",
  category: "عبادات",
  custom_category: null,
  scope: "GROUP" as const,
  enrollment_ids: [],
  measurement_mode: "SCORE" as const,
  starts_on: "2026-09-14",
  ends_on: "2026-09-20",
  due_time: "20:00",
  timezone: "Africa/Cairo",
  recurrence: {
    kind: "DAILY" as const,
    weekdays: [],
    times_per_week: null,
    dates: [],
  },
  mandatory: true,
  requires_note: false,
  requires_evidence: false,
  max_score: 10,
  pass_score: 5,
  weight: 1,
  completion_rules: {},
  choices: [],
  rubric: [],
};

describe("mentor assignment contracts", () => {
  it.each([
    "BOOLEAN",
    "SCORE",
    "PERCENT",
    "COUNT",
    "DURATION",
    "CHOICE",
    "LEVEL",
    "TEXT",
    "ATTENDANCE",
    "RUBRIC",
  ] as const)("accepts the %s measurement mode", (measurement_mode) => {
    expect(
      mentorAssignmentInput.safeParse({ ...base, measurement_mode }).success,
    ).toBe(true);
  });

  it.each([
    ["BOOLEAN", true, 1],
    ["BOOLEAN", false, 0],
    ["SCORE", 8, 0.8],
    ["PERCENT", 75, 0.75],
    ["COUNT", 4, 0.4],
    ["DURATION", 5, 0.5],
    ["CHOICE", { score: 7 }, 0.7],
    ["LEVEL", { score: 6 }, 0.6],
    ["RUBRIC", { score: 9 }, 0.9],
    ["TEXT", "تم الإنجاز", 1],
    ["ATTENDANCE", "PRESENT", 1],
    ["ATTENDANCE", "LATE", 0.75],
    ["ATTENDANCE", "ABSENT", 0],
    ["ATTENDANCE", "EXCUSED", null],
  ] as const)("normalizes %s safely", (mode, value, expected) => {
    expect(normalizeAssignmentValue(mode, value, 10)).toBe(expected);
  });

  it("builds one occurrence", () => {
    expect(
      buildOccurrenceDates({
        ...base,
        ends_on: null,
        recurrence: { ...base.recurrence, kind: "ONCE" },
      }),
    ).toEqual(["2026-09-14"]);
  });

  it("builds a bounded daily range", () => {
    expect(buildOccurrenceDates(base)).toHaveLength(7);
  });

  it("keeps weekdays only", () => {
    const dates = buildOccurrenceDates({
      ...base,
      recurrence: { ...base.recurrence, kind: "WEEKDAYS" },
    });
    expect(dates).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  it("builds exactly three weekly opportunities", () => {
    const dates = buildOccurrenceDates({
      ...base,
      recurrence: {
        kind: "TIMES_WEEKLY",
        weekdays: [],
        times_per_week: 3,
        dates: [],
      },
    });
    expect(dates).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
  });

  it("deduplicates custom dates", () => {
    const dates = buildOccurrenceDates({
      ...base,
      recurrence: {
        kind: "CUSTOM",
        weekdays: [],
        times_per_week: null,
        dates: ["2026-09-16", "2026-09-15", "2026-09-16"],
      },
    });
    expect(dates).toEqual(["2026-09-15", "2026-09-16"]);
  });

  it("rejects an inverted date range", () => {
    expect(() =>
      buildOccurrenceDates({ ...base, ends_on: "2026-09-01" }),
    ).toThrow();
  });

  it("rejects invalid scores", () => {
    expect(Number.isNaN(normalizeAssignmentValue("SCORE", -1, 10))).toBe(true);
    expect(Number.isNaN(normalizeAssignmentValue("SCORE", "bad", 10))).toBe(
      true,
    );
  });

  it("distinguishes missing values from a zero score", () => {
    expect(normalizeAssignmentValue("SCORE", null, 10)).toBeNull();
    expect(normalizeAssignmentValue("SCORE", 0, 10)).toBe(0);
  });
});
