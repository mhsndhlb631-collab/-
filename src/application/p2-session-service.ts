import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import type { RequestActor } from "../server/authenticated-db";
import { atStage, audit, idempotent } from "./p1-program-service";

const id = z.uuid(),
  key = z.string().min(1).max(128);
const attendanceStatus = z.enum([
  "PRESENT",
  "LATE",
  "EXCUSED_ABSENCE",
  "UNEXCUSED_ABSENCE",
]);
const record = z
  .object({
    roster_id: id,
    attendance: z
      .object({
        status: attendanceStatus,
        reason: z.string().trim().min(3).max(500).nullable(),
        row_version: z.number().int().positive(),
      })
      .strict(),
    metrics: z
      .array(
        z
          .object({
            definition_id: id,
            value: z.unknown(),
            row_version: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
const recordsBody = z
  .object({
    occurrence_row_version: z.number().int().positive(),
    records: z.array(record).min(1).max(200),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR");
  return parsed.data;
}

export class P2SessionService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  async list() {
    const sessions = await this
      .tx`select so.id,so.group_id,g.name as group_name,sd.name,sd.session_type,so.starts_at,so.ends_at,so.status,so.row_version::integer as row_version
      from app.session_occurrences so join app.groups g on g.id=so.group_id join app.session_definitions sd on sd.id=so.session_definition_id
      order by so.starts_at,so.id limit 100`;
    return { sessions };
  }
  async detail(sessionId: unknown) {
    const session = parse(id, sessionId);
    const rows = await this
      .tx`select so.id,so.group_id,g.name as group_name,sd.name,sd.session_type,sd.attendance_required,
      so.starts_at,so.ends_at,so.status,so.responsible_mentor_person_id,so.row_version::integer as row_version
      from app.session_occurrences so join app.groups g on g.id=so.group_id join app.session_definitions sd on sd.id=so.session_definition_id where so.id=${session}::uuid`;
    if (!rows[0]) throw new AppError("NOT_FOUND");
    const roster = await this
      .tx`select id,enrollment_id,display_name,eligibility,attendance_status,reason,attendance_row_version::integer as attendance_row_version from app.read_session_roster(${session}::uuid)`;
    for (const row of roster)
      row.metrics = await this
        .tx`select smd.id as definition_id,smd.name,smd.value_type,smd.required,smd.applies_to,smd.constraints,smr.value,smr.row_version::integer as row_version
        from app.session_occurrences so join app.session_metric_definitions smd on smd.session_definition_id=so.session_definition_id
        left join app.session_metric_records smr on smr.metric_definition_id=smd.id and smr.roster_id=${row.id}::uuid
        where so.id=${session}::uuid order by smd.id`;
    return { session: rows[0], roster };
  }
  open(sessionId: unknown, idempotencyKey: unknown) {
    const session = parse(id, sessionId),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P2_OPEN_SESSION",
      key: stableKey,
      payload: { session },
      work: async () => {
        const rows = await this.tx<
          {
            status: string;
            starts_at: Date;
            group_id: string;
            row_version: number;
          }[]
        >`select status,starts_at,group_id,row_version from app.session_occurrences where id=${session}::uuid for update`;
        const current = rows[0];
        if (!current) throw new AppError("NOT_FOUND");
        if (current.status !== "PLANNED")
          throw new AppError("INVALID_STATE_TRANSITION");
        const mentors = await this.tx<
          { mentor_person_id: string }[]
        >`select mentor_person_id from app.mentor_assignments where group_id=${current.group_id}::uuid and effective_from<=${current.starts_at} and (effective_to is null or effective_to>${current.starts_at})`;
        if (!mentors[0]) throw new AppError("INVALID_STATE_TRANSITION");
        await this
          .tx`update app.session_occurrences set status='OPEN',responsible_mentor_person_id=${mentors[0].mentor_person_id}::uuid,opened_at=clock_timestamp(),opened_by_account_id=${this.actor.accountId}::uuid,updated_at=clock_timestamp(),row_version=row_version+1 where id=${session}::uuid`;
        await this.tx`select app.freeze_session_roster(${session}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "SESSION_OPENED",
          "session_occurrence",
          session,
        );
        return { id: session };
      },
    });
  }
  private async applyRecords(
    session: string,
    body: z.infer<typeof recordsBody>,
    allowed: string[],
  ) {
    const occurrences = await this.tx<
      { status: string; row_version: number; session_definition_id: string }[]
    >`select status,row_version::integer as row_version,session_definition_id from app.session_occurrences where id=${session}::uuid for update`;
    const occurrence = occurrences[0];
    if (!occurrence) throw new AppError("NOT_FOUND");
    if (!allowed.includes(occurrence.status))
      throw new AppError(
        occurrence.status === "CLOSED"
          ? "PERIOD_LOCKED"
          : "INVALID_STATE_TRANSITION",
      );
    if (occurrence.row_version !== body.occurrence_row_version)
      throw new AppError("VERSION_CONFLICT");
    for (const item of body.records) {
      const attendance = await this.tx<
        { row_version: number }[]
      >`select a.row_version::integer as row_version from app.attendance a where a.roster_id=${item.roster_id}::uuid and app.roster_in_session(a.roster_id,${session}::uuid) for update`;
      if (!attendance[0]) throw new AppError("NOT_FOUND");
      if (attendance[0].row_version !== item.attendance.row_version)
        throw new AppError("VERSION_CONFLICT");
      if (
        ["EXCUSED_ABSENCE", "UNEXCUSED_ABSENCE"].includes(
          item.attendance.status,
        ) &&
        !item.attendance.reason
      )
        throw new AppError("VALIDATION_ERROR");
      await this
        .tx`update app.attendance set status=${item.attendance.status},reason=${item.attendance.reason},recorded_by_account_id=${this.actor.accountId}::uuid,updated_at=clock_timestamp(),row_version=row_version+1 where roster_id=${item.roster_id}::uuid`;
      for (const metric of item.metrics) {
        const definitions = await this.tx<
          { value_type: string; constraints: Record<string, unknown> }[]
        >`select smd.value_type,smd.constraints from app.session_metric_definitions smd join app.session_definitions sd on sd.id=smd.session_definition_id where smd.id=${metric.definition_id}::uuid and sd.id=${occurrence.session_definition_id}::uuid`;
        const definition = definitions[0];
        if (
          !definition ||
          !this.validValue(
            definition.value_type,
            definition.constraints,
            metric.value,
          )
        )
          throw new AppError("VALIDATION_ERROR");
        const existing = await this.tx<
          { row_version: number }[]
        >`select row_version::integer as row_version from app.session_metric_records where roster_id=${item.roster_id}::uuid and metric_definition_id=${metric.definition_id}::uuid for update`;
        if (existing[0]) {
          if (metric.row_version !== existing[0].row_version)
            throw new AppError("VERSION_CONFLICT");
          await this
            .tx`update app.session_metric_records set value=${this.tx.json(metric.value as postgres.JSONValue)},recorded_by_account_id=${this.actor.accountId}::uuid,updated_at=clock_timestamp(),row_version=row_version+1 where roster_id=${item.roster_id}::uuid and metric_definition_id=${metric.definition_id}::uuid`;
        } else {
          if (metric.row_version !== null)
            throw new AppError("VERSION_CONFLICT");
          await this
            .tx`insert into app.session_metric_records(workspace_id,roster_id,metric_definition_id,value,recorded_by_account_id) values(${this.actor.workspaceId}::uuid,${item.roster_id}::uuid,${metric.definition_id}::uuid,${this.tx.json(metric.value as postgres.JSONValue)},${this.actor.accountId}::uuid)`;
        }
      }
    }
    await this
      .tx`update app.session_occurrences set updated_at=clock_timestamp(),row_version=row_version+1 where id=${session}::uuid`;
  }
  private validValue(
    type: string,
    constraints: Record<string, unknown>,
    value: unknown,
  ) {
    if (type === "BOOLEAN") return typeof value === "boolean";
    if (type === "SHORT_TEXT")
      return (
        typeof value === "string" && value.length > 0 && value.length <= 300
      );
    if (type === "ENUM")
      return (
        typeof value === "string" &&
        Array.isArray(constraints.options) &&
        constraints.options.includes(value)
      );
    if (
      !["COUNT", "PERCENT", "SCORE", "DURATION", "NUMBER"].includes(type) ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    )
      return false;
    if (type === "COUNT" && (!Number.isInteger(value) || value < 0))
      return false;
    if (type === "PERCENT" && (value < 0 || value > 100)) return false;
    return (
      !(typeof constraints.min === "number" && value < constraints.min) &&
      !(typeof constraints.max === "number" && value > constraints.max)
    );
  }
  save(sessionId: unknown, value: unknown, idempotencyKey: unknown) {
    const session = parse(id, sessionId),
      body = parse(recordsBody, value),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P2_SAVE_SESSION",
      key: stableKey,
      payload: { session, ...body },
      work: async () => {
        await this.applyRecords(session, body, ["OPEN"]);
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "SESSION_RECORDS_SAVED",
          "session_occurrence",
          session,
        );
        return { id: session };
      },
    });
  }
  close(sessionId: unknown, value: unknown, idempotencyKey: unknown) {
    const session = parse(id, sessionId),
      body = parse(
        z.object({ row_version: z.number().int().positive() }).strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P2_CLOSE_SESSION",
      key: stableKey,
      payload: { session, ...body },
      work: async () => {
        const rows = await this.tx<
          {
            status: string;
            row_version: number;
            attendance_required: boolean;
          }[]
        >`select so.status,so.row_version::integer as row_version,sd.attendance_required from app.session_occurrences so join app.session_definitions sd on sd.id=so.session_definition_id where so.id=${session}::uuid for update of so`;
        const current = rows[0];
        if (!current) throw new AppError("NOT_FOUND");
        if (current.status !== "OPEN")
          throw new AppError("INVALID_STATE_TRANSITION");
        if (current.row_version !== body.row_version)
          throw new AppError("VERSION_CONFLICT");
        const [missing] = await atStage(
          "session_close_completeness",
          () =>
            this.tx<
              { count: number }[]
            >`select count(*)::integer as count from app.session_roster sr join app.attendance a on a.roster_id=sr.id join app.session_occurrences so on so.id=sr.session_occurrence_id where sr.session_occurrence_id=${session}::uuid and sr.eligibility='EXPECTED' and ((${current.attendance_required} and a.status='NOT_RECORDED') or exists(select 1 from app.session_metric_definitions d where d.session_definition_id=so.session_definition_id and d.required and d.applies_to ? a.status::text and not exists(select 1 from app.session_metric_records r where r.roster_id=sr.id and r.metric_definition_id=d.id)))`,
        );
        if (missing.count > 0) throw new AppError("INCOMPLETE_SESSION");
        await atStage(
          "session_close_update",
          () =>
            this
              .tx`update app.session_occurrences set status='CLOSED',closed_at=clock_timestamp(),closed_by_account_id=${this.actor.accountId}::uuid,updated_at=clock_timestamp(),row_version=row_version+1 where id=${session}::uuid`,
        );
        await atStage("session_close_audit", () =>
          audit(
            this.tx,
            this.actor,
            this.requestId,
            "SESSION_CLOSED",
            "session_occurrence",
            session,
          ),
        );
        return { id: session };
      },
    });
  }
  cancel(sessionId: unknown, value: unknown, idempotencyKey: unknown) {
    const session = parse(id, sessionId),
      body = parse(
        z
          .object({
            reason: z.string().trim().min(3).max(500),
            row_version: z.number().int().positive(),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P2_CANCEL_SESSION",
      key: stableKey,
      payload: { session, ...body },
      work: async () => {
        const updated = await this
          .tx`update app.session_occurrences set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by_account_id=${this.actor.accountId}::uuid,cancellation_reason=${body.reason},updated_at=clock_timestamp(),row_version=row_version+1 where id=${session}::uuid and status in ('PLANNED','OPEN') and row_version=${body.row_version} returning id`;
        if (!updated[0]) throw new AppError("VERSION_CONFLICT");
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "SESSION_CANCELLED",
          "session_occurrence",
          session,
        );
        return { id: session };
      },
    });
  }
  correct(sessionId: unknown, value: unknown, idempotencyKey: unknown) {
    const session = parse(id, sessionId),
      body = parse(
        recordsBody.extend({ reason: z.string().trim().min(3).max(500) }),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P2_CORRECT_SESSION",
      key: stableKey,
      payload: { session, ...body },
      work: async () => {
        const before = await this.snapshot(session);
        await this.applyRecords(session, body, ["CLOSED"]);
        const after = await this.snapshot(session);
        const correctionId = randomUUID();
        await this
          .tx`insert into app.session_corrections(id,workspace_id,session_occurrence_id,actor_account_id,reason,before_snapshot,after_snapshot,request_id) values(${correctionId}::uuid,${this.actor.workspaceId}::uuid,${session}::uuid,${this.actor.accountId}::uuid,${body.reason},${this.tx.json(before)},${this.tx.json(after)},${this.requestId}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "SESSION_CORRECTED",
          "session_occurrence",
          session,
        );
        return { id: correctionId };
      },
    });
  }
  private async snapshot(session: string) {
    const records = await this
      .tx`select sr.id as roster_id,a.status,a.reason,coalesce(jsonb_object_agg(smr.metric_definition_id,smr.value) filter(where smr.id is not null),'{}') as metrics from app.session_roster sr join app.attendance a on a.roster_id=sr.id left join app.session_metric_records smr on smr.roster_id=sr.id where sr.session_occurrence_id=${session}::uuid group by sr.id,a.id order by sr.id`;
    return { records };
  }
}
