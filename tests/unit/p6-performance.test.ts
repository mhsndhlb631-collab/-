import { describe, expect, it } from "vitest";
import { summarizeOpportunities } from "../../src/application/p6-reporting-service";

const due = new Date("2026-09-10T00:00:00Z");
function opportunity(
  dimension: "operational" | "followup" | "data" | "case_response",
  achieved: boolean,
  index: number,
) {
  return {
    dimension,
    achieved,
    resource_type: dimension,
    resource_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    due_at: due,
  };
}

describe("P6 mentor performance rules", () => {
  it("excludes zero-denominator dimensions and uses only applicable weights", () => {
    const result = summarizeOpportunities([
      opportunity("operational", true, 1),
      opportunity("operational", false, 2),
      opportunity("followup", true, 3),
    ]);
    expect(result.dimensions.data.applicable).toBe(false);
    expect(result.dimensions.case_response.score).toBeNull();
    expect(result.score).toBeCloseTo((50 * 35 + 100 * 30) / 65, 3);
  });

  it("returns no score when there are no evaluation opportunities", () => {
    const result = summarizeOpportunities([]);
    expect(result.score).toBeNull();
    expect(result.dataState).toBe("NO_EVALUATION_DATA");
  });

  it("marks fewer than five opportunities as limited data", () => {
    const limited = summarizeOpportunities([
      opportunity("data", true, 1),
      opportunity("data", true, 2),
      opportunity("data", true, 3),
      opportunity("data", true, 4),
    ]);
    const sufficient = summarizeOpportunities([
      opportunity("data", true, 1),
      opportunity("data", true, 2),
      opportunity("data", true, 3),
      opportunity("data", true, 4),
      opportunity("data", true, 5),
    ]);
    expect(limited.dataState).toBe("LIMITED_DATA");
    expect(sufficient.dataState).toBe("SUFFICIENT_DATA");
  });
});
