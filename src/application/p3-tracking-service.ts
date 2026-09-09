import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import type { RequestActor } from "../server/authenticated-db";
import { audit, idempotent } from "./p1-program-service";

const id = z.uuid();
const key = z.string().min(1).max(128);
const date = z.iso.date();
const source = z.enum(["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"]);
const entry = z
  .object({
    enrollment_id: id,
    definition_id: id,
    period_start: date,
    period_end: date,
    state: z.enum(["RECORDED", "EXEMPT"]).default("RECORDED"),
    value: z.unknown().nullable().default(null),
    source,
    occurred_at: z.iso.datetime({ offset: true }),
    exemption_reason: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .nullable()
      .default(null),
    row_version: z.number().int().positive().nullable().default(null),
    reason: z.string().trim().min(3).max(500).nullable().default(null),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR");
  return result.data;
}
function isoDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function plusDays(value: string, amount: number) {
  const result = isoDay(value);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}
function dayDistance(start: string, end: string) {
  return Math.floor(
    (isoDay(end).getTime() - isoDay(start).getTime()) / 86_400_000,
  );
}

type DefinitionRow = {
  enrollment_id: string;
  display_name: string;
  cohort_starts_on: string;
  cohort_ends_on: string;
  definition_id: string;
  name: string;
  meaning: string;
  unit: string | null;
  value_type: string;
  constraints: postgres.JSONValue;
  target: postgres.JSONValue;
  period_kind: "DAILY" | "WEEKLY";
  start_week: number;
  end_week: number | null;
  days_of_week: number[];
  due_time: string | null;
  requires_review: boolean;
};

export class P3TrackingService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  async expected(query: URLSearchParams) {
    const input = parse(
      z
        .object({
          from: date,
          to: date,
          enrollment_id: id.optional(),
        })
        .strict(),
      Object.fromEntries(query.entries()),
    );
    const span = dayDistance(input.from, input.to);
    if (span < 0 || span > 31) throw new AppError("VALIDATION_ERROR");
    const definitions = await this.tx<DefinitionRow[]>`
      select e.id enrollment_id,p.display_name,c.starts_on::text cohort_starts_on,
        c.ends_on::text cohort_ends_on,d.id definition_id,d.name,d.meaning,d.unit,
        d.value_type,d.constraints,d.target,s.period_kind,s.start_week,s.end_week,
        s.days_of_week,s.due_time::text,d.requires_review
      from app.enrollments e
      join app.student_profiles sp on sp.id=e.student_profile_id
      join app.persons p on p.id=sp.person_id
      join app.cohorts c on c.id=e.cohort_id
      join app.tracking_definitions d on d.plan_id=c.current_plan_id
      join app.tracking_schedules s on s.tracking_definition_id=d.id
      where e.workspace_id=${this.actor.workspaceId}::uuid
        and (${this.actor.role}<>'STUDENT' or sp.person_id=${this.actor.personId}::uuid)
        and (${input.enrollment_id ?? null}::uuid is null or e.id=${input.enrollment_id ?? null}::uuid)
        and e.effective_from::date<=${input.to}::date
        and (e.effective_to is null or e.effective_to::date>${input.from}::date)
      order by p.display_name,d.name`;
    const expected: Array<Record<string, unknown>> = [];
    for (const row of definitions) {
      for (let offset = 0; offset <= span; offset++) {
        const current = plusDays(input.from, offset);
        if (current < row.cohort_starts_on || current > row.cohort_ends_on)
          continue;
        const delta = dayDistance(row.cohort_starts_on, current);
        const weekNumber = Math.floor(delta / 7) + 1;
        if (
          weekNumber < row.start_week ||
          (row.end_week !== null && weekNumber > row.end_week)
        )
          continue;
        const periodStart =
          row.period_kind === "DAILY"
            ? current
            : plusDays(row.cohort_starts_on, (weekNumber - 1) * 7);
        if (
          row.period_kind === "DAILY" &&
          !row.days_of_week.includes(isoDay(current).getUTCDay())
        )
          continue;
        if (row.period_kind === "WEEKLY" && current !== periodStart) continue;
        expected.push({
          enrollment_id: row.enrollment_id,
          student_name: row.display_name,
          definition_id: row.definition_id,
          name: row.name,
          meaning: row.meaning,
          unit: row.unit,
          value_type: row.value_type,
          constraints: row.constraints,
          target: row.target,
          period_kind: row.period_kind,
          period_start: periodStart,
          period_end:
            row.period_kind === "DAILY"
              ? periodStart
              : plusDays(periodStart, 6),
          due_time: row.due_time,
          requires_review: row.requires_review,
        });
      }
    }
    if (!expected.length) return { actor_role: this.actor.role, expected: [] };
    const enrollmentIds = [
      ...new Set(expected.map((x) => String(x.enrollment_id))),
    ];
    const definitionIds = [
      ...new Set(expected.map((x) => String(x.definition_id))),
    ];
    const currentEntries = await this.tx<
      {
        id: string;
        enrollment_id: string;
        tracking_definition_id: string;
        period_start: string;
        period_end: string;
        state: string;
        value: postgres.JSONValue | null;
        source: string;
        occurred_at: string;
        current_version: number;
        review_status: string;
        row_version: number;
      }[]
    >`select id,enrollment_id,tracking_definition_id,period_start::text,period_end::text,
        state,value,source,occurred_at::text,current_version,review_status,row_version
      from app.tracking_entries
      where enrollment_id=any(${enrollmentIds}::uuid[])
        and tracking_definition_id=any(${definitionIds}::uuid[])
        and period_start>=${input.from}::date and period_start<=${input.to}::date`;
    const byKey = new Map(
      currentEntries.map((item) => [
        `${item.enrollment_id}:${item.tracking_definition_id}:${item.period_start}:${item.period_end}`,
        item,
      ]),
    );
    return {
      actor_role: this.actor.role,
      expected: expected.map((item) => {
        const found = byKey.get(
          `${item.enrollment_id}:${item.definition_id}:${item.period_start}:${item.period_end}`,
        );
        return {
          ...item,
          status: found
            ? found.state === "EXEMPT"
              ? "EXEMPT"
              : found.review_status
            : "MISSING",
          entry: found ?? null,
        };
      }),
    };
  }

  save(value: unknown, idempotencyKey: unknown, batch: boolean) {
    const body = parse(
      z
        .object({
          entries: z
            .array(entry)
            .min(1)
            .max(batch ? 200 : 1),
        })
        .strict(),
      value,
    );
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: batch ? "P3_BATCH_TRACKING" : "P3_SAVE_TRACKING",
      key: stableKey,
      payload: body,
      work: async () => {
        const definitionIds = [
          ...new Set(body.entries.map((x) => x.definition_id)),
        ];
        const definitions = await this.tx<
          {
            id: string;
            allows_batch: boolean;
            allows_weekly_summary: boolean;
          }[]
        >`select id,allows_batch,allows_weekly_summary from app.tracking_definitions
          where id=any(${definitionIds}::uuid[])`;
        if (definitions.length !== definitionIds.length)
          throw new AppError("NOT_FOUND");
        if (batch && definitions.some((x) => !x.allows_batch))
          throw new AppError("ENTRY_MODE_NOT_ALLOWED");
        const results: Array<{
          id: string;
          version: number;
          row_version: number;
        }> = [];
        for (const item of body.entries) {
          if (
            (this.actor.role === "STUDENT" && item.source !== "STUDENT") ||
            (this.actor.role === "MENTOR" && item.source === "STUDENT")
          )
            throw new AppError("ENTRY_MODE_NOT_ALLOWED");
          if (
            item.source === "PAPER_TRANSCRIBED" &&
            dayDistance(item.period_start, item.period_end) === 6 &&
            !definitions.find((x) => x.id === item.definition_id)
              ?.allows_weekly_summary
          )
            throw new AppError("ENTRY_MODE_NOT_ALLOWED");
          const existing = await this.tx<
            { id: string; row_version: number }[]
          >`select id,row_version from app.tracking_entries
            where enrollment_id=${item.enrollment_id}::uuid
              and tracking_definition_id=${item.definition_id}::uuid
              and period_start=${item.period_start}::date and period_end=${item.period_end}::date
            for update`;
          let resourceId: string;
          if (existing[0]) {
            if (
              item.row_version !== existing[0].row_version ||
              item.reason === null
            )
              throw new AppError("VERSION_CONFLICT");
            resourceId = existing[0].id;
            const updated = await this.tx<
              { current_version: number; row_version: number }[]
            >`update app.tracking_entries set state=${item.state},value=${this.tx.json(item.value as postgres.JSONValue)},
                source=${item.source},occurred_at=${item.occurred_at}::timestamptz,
                recorded_by_account_id=${this.actor.accountId}::uuid,exemption_reason=${item.exemption_reason},
                row_version=row_version+1
              where id=${resourceId}::uuid and row_version=${item.row_version}
              returning current_version,row_version`;
            if (!updated[0]) throw new AppError("VERSION_CONFLICT");
            results.push({
              id: resourceId,
              version: updated[0].current_version,
              row_version: updated[0].row_version,
            });
          } else {
            if (item.row_version !== null)
              throw new AppError("VERSION_CONFLICT");
            resourceId = randomUUID();
            const inserted = await this.tx<
              { current_version: number; row_version: number }[]
            >`insert into app.tracking_entries(id,workspace_id,enrollment_id,tracking_definition_id,
                period_start,period_end,state,value,source,occurred_at,recorded_by_account_id,exemption_reason)
              values(${resourceId}::uuid,${this.actor.workspaceId}::uuid,${item.enrollment_id}::uuid,
                ${item.definition_id}::uuid,${item.period_start}::date,${item.period_end}::date,
                ${item.state},${this.tx.json(item.value as postgres.JSONValue)},${item.source},
                ${item.occurred_at}::timestamptz,${this.actor.accountId}::uuid,${item.exemption_reason})
              returning current_version,row_version`;
            results.push({
              id: resourceId,
              version: inserted[0].current_version,
              row_version: inserted[0].row_version,
            });
          }
          await audit(
            this.tx,
            this.actor,
            this.requestId,
            existing[0]
              ? "TRACKING_ENTRY_CORRECTED"
              : "TRACKING_ENTRY_RECORDED",
            "tracking_entry",
            resourceId,
          );
        }
        return { id: results[0].id, entries: results };
      },
    });
  }

  review(entryId: unknown, value: unknown, idempotencyKey: unknown) {
    if (this.actor.role === "STUDENT") throw new AppError("FORBIDDEN");
    const targetId = parse(id, entryId);
    const body = parse(
      z
        .object({
          entry_version: z.number().int().positive(),
          row_version: z.number().int().positive(),
          decision: z.enum(["VERIFIED", "NEEDS_CORRECTION"]),
          reason: z.string().trim().min(3).max(500).nullable().default(null),
        })
        .strict(),
      value,
    );
    if (body.decision === "NEEDS_CORRECTION" && !body.reason)
      throw new AppError("VALIDATION_ERROR");
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P3_REVIEW_TRACKING",
      key: stableKey,
      payload: { targetId, ...body },
      work: async () => {
        const rows = await this.tx<
          {
            workspace_id: string;
            current_version: number;
            row_version: number;
          }[]
        >`select workspace_id,current_version,row_version from app.tracking_entries
          where id=${targetId}::uuid for update`;
        const current = rows[0];
        if (!current) throw new AppError("NOT_FOUND");
        if (
          current.current_version !== body.entry_version ||
          current.row_version !== body.row_version
        )
          throw new AppError("VERSION_CONFLICT");
        const reviewId = randomUUID();
        await this
          .tx`insert into app.tracking_reviews(id,workspace_id,tracking_entry_id,entry_version,
            decision,reviewer_account_id,reason,request_id)
          values(${reviewId}::uuid,${this.actor.workspaceId}::uuid,${targetId}::uuid,
            ${body.entry_version},${body.decision},${this.actor.accountId}::uuid,${body.reason},${this.requestId}::uuid)`;
        const updated = await this.tx<{ row_version: number | null }[]>`
          select app.apply_tracking_review_status(${targetId}::uuid,${body.entry_version},
            ${body.row_version}::bigint,${body.decision}::app.tracking_review_status) as row_version`;
        if (updated[0]?.row_version === null) throw new AppError("NOT_FOUND");
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "TRACKING_ENTRY_REVIEWED",
          "tracking_entry",
          targetId,
        );
        return {
          id: reviewId,
          entry_id: targetId,
          entry_version: body.entry_version,
          status: body.decision,
          row_version: updated[0].row_version,
        };
      },
    });
  }

  async correct(entryId: unknown, value: unknown, idempotencyKey: unknown) {
    const targetId = parse(id, entryId);
    const body = parse(z.object({ entry }).strict(), value);
    const current = await this.tx<
      {
        enrollment_id: string;
        tracking_definition_id: string;
        period_start: string;
        period_end: string;
      }[]
    >`select enrollment_id,tracking_definition_id,period_start::text,period_end::text
      from app.tracking_entries where id=${targetId}::uuid`;
    const row = current[0];
    if (!row) throw new AppError("NOT_FOUND");
    if (
      row.enrollment_id !== body.entry.enrollment_id ||
      row.tracking_definition_id !== body.entry.definition_id ||
      row.period_start !== body.entry.period_start ||
      row.period_end !== body.entry.period_end
    )
      throw new AppError("VALIDATION_ERROR");
    return this.save({ entries: [body.entry] }, idempotencyKey, false);
  }
}
