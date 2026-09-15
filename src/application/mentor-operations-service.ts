import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import type { RequestActor } from "../server/authenticated-db";
import { audit, idempotent } from "./p1-program-service";

const uuid = z.uuid();
const key = z.string().min(1).max(128);
const measurement = z.enum([
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
]);
export const mentorAssignmentInput = z
  .object({
    group_id: uuid,
    title: z.string().trim().min(1).max(160),
    instructions: z.string().trim().min(1).max(5000),
    category: z.string().trim().min(1).max(80),
    custom_category: z.string().trim().max(80).nullable().default(null),
    scope: z.enum(["GROUP", "INDIVIDUAL"]).default("GROUP"),
    enrollment_ids: z.array(uuid).max(300).default([]),
    measurement_mode: measurement,
    starts_on: z.iso.date(),
    ends_on: z.iso.date().nullable().default(null),
    due_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    timezone: z.string().trim().min(1).max(80).default("Africa/Cairo"),
    recurrence: z
      .object({
        kind: z.enum([
          "ONCE",
          "DAILY",
          "WEEKDAYS",
          "TIMES_WEEKLY",
          "WEEKLY",
          "RANGE",
          "CUSTOM",
        ]),
        weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
        times_per_week: z.number().int().min(1).max(7).nullable().default(null),
        dates: z.array(z.iso.date()).max(366).default([]),
      })
      .strict(),
    mandatory: z.boolean().default(true),
    requires_note: z.boolean().default(false),
    requires_evidence: z.boolean().default(false),
    max_score: z.number().positive().max(100000),
    pass_score: z.number().min(0).nullable().default(null),
    weight: z.number().min(0).max(1000).default(1),
    completion_rules: z.record(z.string(), z.unknown()).default({}),
    choices: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(80),
          score: z.number().min(0),
        }),
      )
      .max(30)
      .default([]),
    rubric: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(120),
          max_score: z.number().positive(),
        }),
      )
      .max(30)
      .default([]),
  })
  .strict();
const evaluationInput = z
  .object({
    occurrence_id: uuid,
    enrollment_id: uuid,
    value: z.unknown().nullable(),
    note: z.string().trim().max(5000).nullable().default(null),
    note_visibility: z.enum(["STAFF", "STUDENT"]).default("STAFF"),
    evidence_url: z.string().url().max(2000).nullable().default(null),
    row_version: z.number().int().positive().nullable().default(null),
    reason: z.string().trim().min(3).max(500).nullable().default(null),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR");
  return result.data;
}
function staff(actor: RequestActor) {
  if (actor.role === "STUDENT") throw new AppError("FORBIDDEN");
}
function number(value: unknown) {
  return Number(value);
}
function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as never;
}
function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function buildOccurrenceDates(
  input: z.infer<typeof mentorAssignmentInput>,
) {
  const start = new Date(`${input.starts_on}T12:00:00Z`);
  const end = new Date(`${input.ends_on ?? input.starts_on}T12:00:00Z`);
  if (end < start) throw new AppError("VALIDATION_ERROR");
  const explicit =
    input.recurrence.kind === "CUSTOM" ? input.recurrence.dates : [];
  if (explicit.length) return [...new Set(explicit)].sort();
  const dates: string[] = [];
  for (
    let cursor = new Date(start), guard = 0;
    cursor <= end && guard < 366;
    cursor.setUTCDate(cursor.getUTCDate() + 1), guard++
  ) {
    const day = cursor.getUTCDay();
    const kind = input.recurrence.kind;
    const dayOffset = Math.floor(
      (cursor.getTime() - start.getTime()) / 86_400_000,
    );
    const selected =
      kind === "DAILY" ||
      kind === "RANGE" ||
      (kind === "WEEKDAYS" && day >= 1 && day <= 5) ||
      (kind === "WEEKLY" &&
        (input.recurrence.weekdays.length
          ? input.recurrence.weekdays.includes(day)
          : day === start.getUTCDay())) ||
      (kind === "TIMES_WEEKLY" &&
        (input.recurrence.weekdays.length
          ? input.recurrence.weekdays.includes(day)
          : dayOffset % 7 < (input.recurrence.times_per_week ?? 1))) ||
      kind === "ONCE";
    if (selected) dates.push(isoDate(cursor));
    if (kind === "ONCE") break;
  }
  if (!dates.length || dates.length > 366)
    throw new AppError("VALIDATION_ERROR");
  return dates;
}

export function normalizeAssignmentValue(
  mode: z.infer<typeof measurement>,
  value: unknown,
  max: number,
) {
  if (value === null || value === undefined || value === "") return null;
  if (mode === "BOOLEAN") return value === true ? 1 : value === false ? 0 : NaN;
  if (mode === "TEXT")
    return typeof value === "string" && value.trim() ? 1 : NaN;
  if (mode === "ATTENDANCE") {
    if (value === "EXCUSED") return null;
    return value === "PRESENT"
      ? 1
      : value === "LATE"
        ? 0.75
        : value === "ABSENT"
          ? 0
          : NaN;
  }
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "object" && value && "score" in value
        ? Number((value as { score: unknown }).score)
        : NaN;
  if (!Number.isFinite(raw) || raw < 0) return NaN;
  const denominator = mode === "PERCENT" ? 100 : max;
  return Math.min(1, raw / denominator);
}

export class MentorOperationsService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  async overview() {
    staff(this.actor);
    const [groups, assignments, students, evaluations] = await Promise.all([
      this
        .tx`select g.id,g.name,g.cohort_id,c.name cohort_name from app.groups g join app.cohorts c on c.id=g.cohort_id
        where g.workspace_id=${this.actor.workspaceId}::uuid and g.status='ACTIVE' and app.actor_can_read_group(g.workspace_id,g.id) order by c.name,g.name`,
      this
        .tx`select d.id,d.group_id,d.title,d.instructions,d.category,d.custom_category,d.scope,d.measurement_mode,d.recurrence,
        d.starts_on,d.ends_on,d.due_time,d.timezone,d.mandatory,d.requires_note,d.requires_evidence,d.max_score,d.pass_score,d.weight,d.choices,d.rubric,d.status,d.row_version,
        count(distinct o.id)::int occurrence_count,count(distinct t.enrollment_id)::int target_count
        from app.assignment_definitions d left join app.assignment_occurrences o on o.assignment_definition_id=d.id
        left join app.assignment_targets t on t.assignment_definition_id=d.id
        where d.workspace_id=${this.actor.workspaceId}::uuid and d.group_id is not null
        group by d.id order by d.created_at desc`,
      this
        .tx`select e.id enrollment_id,sp.id student_id,p.id person_id,p.display_name,g.id group_id,g.name group_name
        from app.enrollments e join app.student_profiles sp on sp.id=e.student_profile_id join app.persons p on p.id=sp.person_id
        join app.group_memberships gm on gm.enrollment_id=e.id and gm.effective_to is null join app.groups g on g.id=gm.group_id
        where e.workspace_id=${this.actor.workspaceId}::uuid and e.effective_to is null and app.actor_can_read_person(p.workspace_id,p.id) order by p.display_name`,
      this
        .tx`select o.id occurrence_id,o.assignment_definition_id,o.due_at,o.status occurrence_status,t.enrollment_id,
        e.id evaluation_id,e.value,e.normalized_score,e.status,e.evidence_url,e.row_version,e.updated_at
        from app.assignment_occurrences o join app.assignment_definitions d on d.id=o.assignment_definition_id
        join app.assignment_targets t on t.assignment_definition_id=d.id
        left join app.assignment_evaluations e on e.occurrence_id=o.id and e.enrollment_id=t.enrollment_id
        where o.workspace_id=${this.actor.workspaceId}::uuid order by o.due_at desc`,
    ]);
    return {
      actor_role: this.actor.role,
      groups,
      assignments,
      students,
      evaluations,
    };
  }

  createAssignment(value: unknown, idempotencyKey: unknown) {
    staff(this.actor);
    const body = parse(mentorAssignmentInput, value);
    if (body.pass_score !== null && body.pass_score > body.max_score)
      throw new AppError("VALIDATION_ERROR");
    if (body.scope === "INDIVIDUAL" && !body.enrollment_ids.length)
      throw new AppError("VALIDATION_ERROR");
    if (
      body.measurement_mode === "RUBRIC" &&
      (!body.rubric.length ||
        Math.abs(
          body.rubric.reduce((sum, item) => sum + item.max_score, 0) -
            body.max_score,
        ) > 0.001)
    )
      throw new AppError("VALIDATION_ERROR");
    if (
      ["CHOICE", "LEVEL"].includes(body.measurement_mode) &&
      !body.choices.length
    )
      throw new AppError("VALIDATION_ERROR");
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "MENTOR_CREATE_ASSIGNMENT",
      key: stableKey,
      payload: body,
      work: async () => {
        const allowed = await this.tx<
          { id: string }[]
        >`select id from app.groups where id=${body.group_id}::uuid and workspace_id=${this.actor.workspaceId}::uuid and app.actor_can_read_group(workspace_id,id)`;
        if (!allowed[0]) throw new AppError("FORBIDDEN");
        const targets =
          body.scope === "GROUP"
            ? await this.tx<
                { enrollment_id: string }[]
              >`select e.id enrollment_id from app.enrollments e join app.group_memberships gm on gm.enrollment_id=e.id
            where gm.group_id=${body.group_id}::uuid and e.effective_to is null and gm.effective_to is null order by e.id`
            : await this.tx<
                { enrollment_id: string }[]
              >`select e.id enrollment_id from app.enrollments e join app.group_memberships gm on gm.enrollment_id=e.id
            where gm.group_id=${body.group_id}::uuid and e.effective_to is null and gm.effective_to is null and e.id in ${this.tx(body.enrollment_ids)} order by e.id`;
        if (!targets.length) throw new AppError("VALIDATION_ERROR");
        const id = randomUUID();
        await this
          .tx`insert into app.assignment_definitions(id,workspace_id,group_id,created_by_account_id,title,instructions,category,custom_category,scope,measurement_mode,recurrence,starts_on,ends_on,due_time,timezone,mandatory,requires_note,requires_evidence,max_score,pass_score,weight,completion_rules,choices,rubric)
        values(${id}::uuid,${this.actor.workspaceId}::uuid,${body.group_id}::uuid,${this.actor.accountId}::uuid,${body.title},${body.instructions},${body.category},${body.custom_category},${body.scope},${body.measurement_mode},${this.tx.json(json(body.recurrence))},${body.starts_on}::date,${body.ends_on}::date,${body.due_time}::time,${body.timezone},${body.mandatory},${body.requires_note},${body.requires_evidence},${body.max_score},${body.pass_score},${body.weight},${this.tx.json(json(body.completion_rules))},${this.tx.json(json(body.choices))},${this.tx.json(json(body.rubric))})`;
        for (const target of targets)
          await this
            .tx`insert into app.assignment_targets(workspace_id,assignment_definition_id,enrollment_id) values(${this.actor.workspaceId}::uuid,${id}::uuid,${target.enrollment_id}::uuid)`;
        for (const date of buildOccurrenceDates(body)) {
          const dueAt = `${date}T${body.due_time ?? "23:59"}:00`;
          await this
            .tx`insert into app.assignment_occurrences(workspace_id,assignment_definition_id,due_at) values(${this.actor.workspaceId}::uuid,${id}::uuid,${dueAt}::timestamp at time zone ${body.timezone})`;
        }
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "MENTOR_ASSIGNMENT_CREATED",
          "assignment_definition",
          id,
        );
        return { id };
      },
    });
  }

  saveEvaluations(value: unknown, idempotencyKey: unknown) {
    staff(this.actor);
    const body = parse(
      z
        .object({
          assignment_id: uuid,
          entries: z.array(evaluationInput).min(1).max(300),
        })
        .strict(),
      value,
    );
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "MENTOR_SAVE_EVALUATIONS",
      key: stableKey,
      payload: body,
      work: async () => {
        const definition = await this.tx<
          {
            max_score: unknown;
            measurement_mode: z.infer<typeof measurement>;
            requires_note: boolean;
            requires_evidence: boolean;
          }[]
        >`
        select max_score,measurement_mode,requires_note,requires_evidence from app.assignment_definitions where id=${body.assignment_id}::uuid and workspace_id=${this.actor.workspaceId}::uuid and app.actor_can_manage_assignment(workspace_id,id)`;
        if (!definition[0]) throw new AppError("FORBIDDEN");
        for (const entry of body.entries) {
          const validTarget = await this.tx<
            { ok: boolean }[]
          >`select exists(select 1 from app.assignment_occurrences o join app.assignment_targets t on t.assignment_definition_id=o.assignment_definition_id
          where o.id=${entry.occurrence_id}::uuid and o.assignment_definition_id=${body.assignment_id}::uuid and t.enrollment_id=${entry.enrollment_id}::uuid) ok`;
          if (!validTarget[0]?.ok) throw new AppError("VALIDATION_ERROR");
          const score = normalizeAssignmentValue(
            definition[0].measurement_mode,
            entry.value,
            number(definition[0].max_score),
          );
          if (
            Number.isNaN(score) ||
            (definition[0].requires_note && !entry.note) ||
            (definition[0].requires_evidence && !entry.evidence_url)
          )
            throw new AppError("VALIDATION_ERROR");
          const current = await this.tx<
            { id: string; row_version: unknown; current_revision: number }[]
          >`select id,row_version,current_revision from app.assignment_evaluations where occurrence_id=${entry.occurrence_id}::uuid and enrollment_id=${entry.enrollment_id}::uuid for update`;
          const status =
            entry.value === null
              ? "MISSING"
              : definition[0].measurement_mode === "ATTENDANCE" &&
                  entry.value === "EXCUSED"
                ? "EXCUSED"
                : "COMPLETED";
          const evaluationId = current[0]?.id ?? randomUUID();
          let revision = 1;
          if (current[0]) {
            if (
              entry.row_version !== number(current[0].row_version) ||
              !entry.reason
            )
              throw new AppError("VERSION_CONFLICT");
            revision = current[0].current_revision + 1;
            const changed = await this.tx<
              { id: string }[]
            >`update app.assignment_evaluations set value=${this.tx.json(json(entry.value))},normalized_score=${score},status=${status},evidence_url=${entry.evidence_url},recorded_by_account_id=${this.actor.accountId}::uuid,evaluated_at=clock_timestamp(),current_revision=${revision},row_version=row_version+1,updated_at=clock_timestamp() where id=${evaluationId}::uuid and row_version=${entry.row_version} returning id`;
            if (!changed[0]) throw new AppError("VERSION_CONFLICT");
          } else {
            if (entry.row_version !== null)
              throw new AppError("VERSION_CONFLICT");
            await this
              .tx`insert into app.assignment_evaluations(id,workspace_id,occurrence_id,enrollment_id,value,normalized_score,status,evidence_url,recorded_by_account_id,evaluated_at,current_revision) values(${evaluationId}::uuid,${this.actor.workspaceId}::uuid,${entry.occurrence_id}::uuid,${entry.enrollment_id}::uuid,${this.tx.json(json(entry.value))},${score},${status},${entry.evidence_url},${this.actor.accountId}::uuid,clock_timestamp(),1)`;
          }
          await this
            .tx`insert into app.assignment_evaluation_revisions(workspace_id,evaluation_id,revision,snapshot,actor_account_id,reason) values(${this.actor.workspaceId}::uuid,${evaluationId}::uuid,${revision},${this.tx.json(json({ value: entry.value, normalized_score: score, status, evidence_url: entry.evidence_url }))},${this.actor.accountId}::uuid,${entry.reason})`;
          if (entry.note)
            await this
              .tx`insert into app.assignment_evaluation_notes(workspace_id,evaluation_id,body,visibility,author_account_id) values(${this.actor.workspaceId}::uuid,${evaluationId}::uuid,${entry.note},${entry.note_visibility},${this.actor.accountId}::uuid)`;
        }
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "ASSIGNMENT_EVALUATIONS_SAVED",
          "assignment_definition",
          body.assignment_id,
        );
        return { id: body.assignment_id, saved: body.entries.length };
      },
    });
  }

  async intelligence() {
    staff(this.actor);
    const rows = await this.tx<
      Array<{
        enrollment_id: string;
        student_id: string;
        display_name: string;
        group_id: string;
        group_name: string;
        evaluated_count: unknown;
        missing_count: unknown;
        average_score: unknown;
        evidence: unknown;
        notes: unknown;
        attendance_rate: unknown;
      }>
    >`
      select e.id enrollment_id,sp.id student_id,p.display_name,g.id group_id,g.name group_name,
        count(v.id)::int evaluated_count,count(*) filter(where o.due_at<clock_timestamp() and v.id is null)::int missing_count,
        round(coalesce(sum(v.normalized_score*d.weight)/nullif(sum(d.weight) filter(where v.id is not null),0)*100,0),1) average_score,
        coalesce(json_agg(json_build_object('category',d.category,'score',round(v.normalized_score*100,1),'assignment',d.title,'due_at',o.due_at)) filter(where v.id is not null),'[]') evidence,
        (select coalesce(json_agg(json_build_object('body',n.body,'visibility',n.visibility,'created_at',n.created_at,'assignment',nd.title) order by n.created_at desc),'[]')
          from app.assignment_evaluation_notes n join app.assignment_evaluations nv on nv.id=n.evaluation_id
          join app.assignment_occurrences no on no.id=nv.occurrence_id join app.assignment_definitions nd on nd.id=no.assignment_definition_id
          where nv.enrollment_id=e.id) notes,
        (select round(100.0*count(*) filter(where a.status in ('PRESENT','LATE'))/nullif(count(*) filter(where a.status<>'NOT_RECORDED'),0),1)
          from app.session_roster sr join app.attendance a on a.roster_id=sr.id where sr.enrollment_id=e.id) attendance_rate
      from app.enrollments e join app.student_profiles sp on sp.id=e.student_profile_id join app.persons p on p.id=sp.person_id
      join app.group_memberships gm on gm.enrollment_id=e.id and gm.effective_to is null join app.groups g on g.id=gm.group_id
      left join app.assignment_targets t on t.enrollment_id=e.id left join app.assignment_definitions d on d.id=t.assignment_definition_id and d.status='ACTIVE'
      left join app.assignment_occurrences o on o.assignment_definition_id=d.id left join app.assignment_evaluations v on v.occurrence_id=o.id and v.enrollment_id=e.id
      where e.workspace_id=${this.actor.workspaceId}::uuid and e.effective_to is null and app.actor_can_read_person(p.workspace_id,p.id)
      group by e.id,sp.id,p.id,g.id order by p.display_name`;
    const students = rows.map((row) => {
      const count = number(row.evaluated_count),
        average = number(row.average_score),
        missing = number(row.missing_count);
      const classification =
        count < 2
          ? "INSUFFICIENT_DATA"
          : average >= 80 && missing === 0
            ? "DISTINGUISHED"
            : average >= 50
              ? "AVERAGE"
              : "NEEDS_SUPPORT";
      const evidence = Array.isArray(row.evidence)
        ? (row.evidence as Array<{ category: string; score: number }>)
        : [];
      const byCategory = new Map<string, number[]>();
      for (const item of evidence) {
        const list = byCategory.get(item.category) ?? [];
        list.push(Number(item.score));
        byCategory.set(item.category, list);
      }
      const weaknesses = [...byCategory]
        .filter(
          ([, scores]) => scores.filter((score) => score < 50).length >= 2,
        )
        .map(([category, scores]) => ({
          category,
          low_count: scores.filter((score) => score < 50).length,
          reason: "أقل من 50% مرتين أو أكثر",
        }));
      return { ...row, classification, weaknesses };
    });
    const ranked = students
      .filter((s) => number(s.evaluated_count) >= 2)
      .sort((a, b) => number(b.average_score) - number(a.average_score));
    let last: number | null = null,
      rank = 0;
    const leaderboard = ranked.map((student, index) => {
      const score = number(student.average_score);
      if (score !== last) rank = index + 1;
      last = score;
      return {
        rank,
        student_id: student.student_id,
        display_name: student.display_name,
        group_name: student.group_name,
        score,
        evaluated_count: student.evaluated_count,
      };
    });
    const alerts = students.flatMap((student) => [
      ...(number(student.missing_count) > 0
        ? [
            {
              kind: "MISSING_GRADE",
              severity: "HIGH",
              student_id: student.student_id,
              student_name: student.display_name,
              count: student.missing_count,
              target: `student:${student.student_id}`,
              reason: "توجد استحقاقات انتهت بلا تقييم",
            },
          ]
        : []),
      ...student.weaknesses.map((weakness) => ({
        kind: "REPEATED_WEAKNESS",
        severity: "MEDIUM",
        student_id: student.student_id,
        student_name: student.display_name,
        target: `student:${student.student_id}`,
        reason: `ضعف متكرر في ${weakness.category}`,
      })),
    ]);
    const groupSizes = new Map<string, number>();
    const weaknessCounts = new Map<
      string,
      {
        group_id: string;
        group_name: string;
        category: string;
        affected: number;
      }
    >();
    for (const student of students) {
      groupSizes.set(
        student.group_id,
        (groupSizes.get(student.group_id) ?? 0) + 1,
      );
      for (const weakness of student.weaknesses) {
        const key = `${student.group_id}:${weakness.category}`;
        const current = weaknessCounts.get(key);
        weaknessCounts.set(key, {
          group_id: student.group_id,
          group_name: student.group_name,
          category: weakness.category,
          affected: (current?.affected ?? 0) + 1,
        });
      }
    }
    const collective = [...weaknessCounts.values()]
      .filter(
        (item) =>
          item.affected >= 2 &&
          item.affected / (groupSizes.get(item.group_id) ?? 1) >= 0.5,
      )
      .map((item) => ({
        ...item,
        kind: "COLLECTIVE_SHORTFALL",
        reason: `تقصير جماعي في ${item.category}: ${item.affected} طلاب`,
      }));
    return { students, leaderboard, alerts, collective };
  }
}

export const mentorOperationsCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("CREATE_ASSIGNMENT"),
      payload: mentorAssignmentInput,
    })
    .strict(),
  z
    .object({
      action: z.literal("SAVE_EVALUATIONS"),
      payload: z
        .object({
          assignment_id: uuid,
          entries: z.array(evaluationInput).min(1).max(300),
        })
        .strict(),
    })
    .strict(),
]);
