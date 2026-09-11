import { describe, expect, it, vi } from "vitest";
import { P7JourneyService } from "../../src/application/p7-journey-service";
import type { RequestActor } from "../../src/server/authenticated-db";
import type postgres from "postgres";

const actor: RequestActor = {
  accountId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  personId: "00000000-0000-4000-8000-000000000003",
  role: "STUDENT",
  sessionId: "00000000-0000-4000-8000-000000000004",
};

describe("P7 journey read round trips", () => {
  it("uses one database statement for each composite journey", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { sessions: 1, tracking: 2, assignments: 3, attentions: 4, actions: 5 },
      ])
      .mockResolvedValueOnce([{ cohorts: [], groups: [], weeks: [] }])
      .mockResolvedValueOnce([{ recorded: 2, published: 1, weeks: [] }]);
    const service = new P7JourneyService(
      query as unknown as postgres.TransactionSql,
      actor,
    );

    expect((await service.today()).counts).toEqual({
      sessions: 1,
      tracking: 2,
      assignments: 3,
      attentions: undefined,
      actions: undefined,
    });
    expect(await service.program()).toEqual({
      role: "STUDENT",
      cohorts: [],
      groups: [],
      weeks: [],
    });
    expect(query.mock.calls[1]?.slice(1)).toEqual([
      actor.workspaceId,
      actor.workspaceId,
      actor.workspaceId,
    ]);
    expect(await service.progress()).toEqual({
      role: "STUDENT",
      tracking_recorded: 2,
      published_exams: 1,
      weeks: [],
    });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
