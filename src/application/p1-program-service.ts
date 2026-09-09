import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import type { RequestActor } from "../server/authenticated-db";

const id = z.uuid();
const key = z.string().min(1).max(128);
const shortText = z.string().trim().min(1).max(160);
const week = z
  .object({
    week_number: z.number().int().positive(),
    week_type: z.enum(["STANDARD", "BREAK", "EXAM", "CUSTOM"]),
    title: shortText,
    objectives: z.array(z.string().trim().min(1).max(300)).max(20),
  })
  .strict();
const sessionMetric = z
  .object({
    name: z.string().trim().min(1).max(120),
    value_type: z.enum([
      "BOOLEAN",
      "COUNT",
      "PERCENT",
      "SCORE",
      "DURATION",
      "NUMBER",
      "ENUM",
      "SHORT_TEXT",
    ]),
    required: z.boolean(),
    applies_to: z
      .array(
        z.enum(["PRESENT", "LATE", "EXCUSED_ABSENCE", "UNEXCUSED_ABSENCE"]),
      )
      .min(1),
    constraints: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const sessionDefinition = z
  .object({
    week_number: z.number().int().positive(),
    name: shortText,
    session_type: z.string().trim().min(1).max(80),
    day_offset: z.number().int().min(0).max(6),
    starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    duration_minutes: z.number().int().min(5).max(720),
    attendance_required: z.boolean(),
    metrics: z.array(sessionMetric).max(30),
  })
  .strict();

function responsible(actor: RequestActor) {
  if (actor.role !== "RESPONSIBLE") throw new AppError("FORBIDDEN");
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR");
  return result.data;
}
export async function atStage<T>(name: string, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (typeof error === "object" && error && !("technicalStage" in error))
      Object.assign(error, { technicalStage: name });
    throw error;
  }
}

export async function idempotent<T extends { id: string }>(input: {
  tx: postgres.TransactionSql;
  actor: RequestActor;
  command: string;
  key: string;
  payload: unknown;
  work: () => Promise<T>;
}) {
  const requestHash = hash(input.payload);
  const context = await input.tx<{ matches: boolean; allowed: boolean }[]>`
    select app.request_account_id()=${input.actor.accountId}::uuid as matches,
      app.actor_allows(${input.actor.workspaceId}::uuid,NULL,false) as allowed`;
  if (!context[0]?.matches || !context[0]?.allowed)
    throw new AppError("UNAUTHENTICATED");
  await atStage(
    "idempotency_reserve",
    () => input.tx`insert into app.idempotency_records(workspace_id,actor_account_id,command,key,request_hash,status,expires_at)
    values(${input.actor.workspaceId}::uuid,${input.actor.accountId}::uuid,${input.command},${input.key},${requestHash},'IN_PROGRESS',clock_timestamp()+interval '7 days')
    on conflict(workspace_id,actor_account_id,command,key) do nothing`,
  );
  const records = await atStage(
    "idempotency_read",
    () => input.tx<
      { request_hash: string; status: string; safe_result: T | null }[]
    >`select request_hash,status,safe_result from app.idempotency_records
    where workspace_id=${input.actor.workspaceId}::uuid and actor_account_id=${input.actor.accountId}::uuid
      and command=${input.command} and key=${input.key} for update`,
  );
  const record = records[0];
  if (!record || record.request_hash !== requestHash)
    throw new AppError("IDEMPOTENCY_CONFLICT");
  if (record.status === "SUCCEEDED" && record.safe_result)
    return record.safe_result;
  const result = await atStage("command_work", input.work);
  await atStage(
    "idempotency_finish",
    () => input.tx`update app.idempotency_records set status='SUCCEEDED',safe_result=${input.tx.json(result)},
    updated_at=clock_timestamp() where workspace_id=${input.actor.workspaceId}::uuid
    and actor_account_id=${input.actor.accountId}::uuid and command=${input.command} and key=${input.key}`,
  );
  return result;
}

export async function audit(
  tx: postgres.TransactionSql,
  actor: RequestActor,
  requestId: string,
  action: string,
  resourceType: string,
  resourceId: string,
) {
  await tx`insert into app.audit_events(workspace_id,actor_account_id,actor_role,action,resource_type,resource_id,request_id)
    values(${actor.workspaceId}::uuid,${actor.accountId}::uuid,${actor.role},${action},${resourceType},${resourceId}::uuid,${requestId}::uuid)`;
}

export class P1ProgramService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  createTemplate(value: unknown, idempotencyKey: unknown) {
    responsible(this.actor);
    const body = parse(
      z
        .object({ name: shortText, level: z.string().trim().min(1).max(80) })
        .strict(),
      value,
    );
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P1_CREATE_TEMPLATE",
      key: stableKey,
      payload: body,
      work: async () => {
        const resourceId = randomUUID();
        await this
          .tx`insert into app.program_templates(id,workspace_id,name,level)
          values(${resourceId}::uuid,${this.actor.workspaceId}::uuid,${body.name},${body.level})`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "PROGRAM_TEMPLATE_CREATED",
          "program_template",
          resourceId,
        );
        return { id: resourceId };
      },
    });
  }

  publishTemplatePlan(
    templateId: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    responsible(this.actor);
    const template = parse(id, templateId);
    const body = parse(
      z
        .object({
          name: shortText,
          weeks: z.array(week).min(1).max(104),
          sessions: z.array(sessionDefinition).max(500).default([]),
        })
        .strict(),
      value,
    );
    if (
      new Set(body.weeks.map((item) => item.week_number)).size !==
      body.weeks.length
    )
      throw new AppError("VALIDATION_ERROR");
    if (
      body.sessions.some(
        (session) =>
          !body.weeks.some((item) => item.week_number === session.week_number),
      )
    )
      throw new AppError("VALIDATION_ERROR");
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P1_PUBLISH_TEMPLATE_PLAN",
      key: stableKey,
      payload: { template, ...body },
      work: async () => {
        const templateRows = await this
          .tx`select id from app.program_templates where id=${template}::uuid for update`;
        if (!templateRows[0]) throw new AppError("NOT_FOUND");
        const versions = await this.tx<
          { next: number }[]
        >`select coalesce(max(version),0)+1 as next from app.program_plans where template_id=${template}::uuid`;
        const planId = randomUUID();
        await this
          .tx`insert into app.program_plans(id,workspace_id,template_id,version,name)
          values(${planId}::uuid,${this.actor.workspaceId}::uuid,${template}::uuid,${versions[0].next},${body.name})`;
        for (const item of body.weeks)
          await this
            .tx`insert into app.plan_weeks(workspace_id,plan_id,week_number,week_type,title,objectives)
            values(${this.actor.workspaceId}::uuid,${planId}::uuid,${item.week_number},${item.week_type},${item.title},${this.tx.json(item.objectives)})`;
        for (const item of body.sessions) {
          const definitionId = randomUUID();
          await this
            .tx`insert into app.session_definitions(id,workspace_id,plan_week_id,name,session_type,day_offset,starts_at,duration_minutes,attendance_required)
            select ${definitionId}::uuid,${this.actor.workspaceId}::uuid,pw.id,${item.name},${item.session_type},${item.day_offset},${item.starts_at}::time,${item.duration_minutes},${item.attendance_required}
            from app.plan_weeks pw where pw.plan_id=${planId}::uuid and pw.week_number=${item.week_number}`;
          for (const metric of item.metrics)
            await this
              .tx`insert into app.session_metric_definitions(workspace_id,session_definition_id,name,value_type,required,applies_to,constraints)
              values(${this.actor.workspaceId}::uuid,${definitionId}::uuid,${metric.name},${metric.value_type},${metric.required},${this.tx.json(metric.applies_to)},${this.tx.json(metric.constraints as postgres.JSONValue)})`;
        }
        await this
          .tx`update app.program_plans set status='PUBLISHED' where id=${planId}::uuid`;
        await this
          .tx`update app.program_templates set status='ACTIVE',updated_at=clock_timestamp(),row_version=row_version+1 where id=${template}::uuid`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "PROGRAM_PLAN_PUBLISHED",
          "program_plan",
          planId,
        );
        return { id: planId, version: versions[0].next };
      },
    });
  }

  createCohort(value: unknown, idempotencyKey: unknown) {
    responsible(this.actor);
    const body = parse(
      z
        .object({
          name: shortText,
          source_plan_id: id,
          starts_on: z.iso.date(),
          ends_on: z.iso.date(),
          groups: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
        })
        .strict(),
      value,
    );
    if (
      body.ends_on < body.starts_on ||
      new Set(body.groups).size !== body.groups.length
    )
      throw new AppError("VALIDATION_ERROR");
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P1_CREATE_COHORT",
      key: stableKey,
      payload: body,
      work: async () => {
        const sourceRows = await this.tx<
          {
            id: string;
            template_id: string;
            name: string;
            scoring_rules: postgres.JSONValue;
            attention_rules: postgres.JSONValue;
          }[]
        >`
          select id,template_id,name,scoring_rules,attention_rules from app.program_plans
          where id=${body.source_plan_id}::uuid and status='PUBLISHED' and template_id is not null`;
        const source = sourceRows[0];
        if (!source) throw new AppError("NOT_FOUND");
        const cohortId = randomUUID();
        const planId = randomUUID();
        await this
          .tx`insert into app.cohorts(id,workspace_id,name,source_template_id,starts_on,ends_on)
          values(${cohortId}::uuid,${this.actor.workspaceId}::uuid,${body.name},${source.template_id}::uuid,${body.starts_on}::date,${body.ends_on}::date)`;
        await this
          .tx`insert into app.program_plans(id,workspace_id,cohort_id,copied_from_plan_id,version,name,scoring_rules,attention_rules)
          values(${planId}::uuid,${this.actor.workspaceId}::uuid,${cohortId}::uuid,${source.id}::uuid,1,${source.name},${this.tx.json(source.scoring_rules)},${this.tx.json(source.attention_rules)})`;
        await this
          .tx`insert into app.plan_weeks(workspace_id,plan_id,week_number,week_type,title,objectives)
          select workspace_id,${planId}::uuid,week_number,week_type,title,objectives from app.plan_weeks where plan_id=${source.id}::uuid order by week_number`;
        const sourceDefinitions = await this.tx<
          {
            id: string;
            week_number: number;
            name: string;
            session_type: string;
            day_offset: number;
            starts_at: string;
            duration_minutes: number;
            attendance_required: boolean;
          }[]
        >`
          select sd.id,pw.week_number,sd.name,sd.session_type,sd.day_offset,sd.starts_at::text,sd.duration_minutes,sd.attendance_required
          from app.session_definitions sd join app.plan_weeks pw on pw.id=sd.plan_week_id where pw.plan_id=${source.id}::uuid order by pw.week_number,sd.id`;
        for (const definition of sourceDefinitions) {
          const copiedId = randomUUID();
          await this
            .tx`insert into app.session_definitions(id,workspace_id,plan_week_id,name,session_type,day_offset,starts_at,duration_minutes,attendance_required)
            select ${copiedId}::uuid,${this.actor.workspaceId}::uuid,pw.id,${definition.name},${definition.session_type},${definition.day_offset},${definition.starts_at}::time,${definition.duration_minutes},${definition.attendance_required}
            from app.plan_weeks pw where pw.plan_id=${planId}::uuid and pw.week_number=${definition.week_number}`;
          await this
            .tx`insert into app.session_metric_definitions(workspace_id,session_definition_id,name,value_type,required,applies_to,constraints)
            select workspace_id,${copiedId}::uuid,name,value_type,required,applies_to,constraints from app.session_metric_definitions where session_definition_id=${definition.id}::uuid`;
        }
        await this
          .tx`update app.program_plans set status='PUBLISHED' where id=${planId}::uuid`;
        await this
          .tx`update app.cohorts set current_plan_id=${planId}::uuid,status='ACTIVE',updated_at=clock_timestamp(),row_version=row_version+1 where id=${cohortId}::uuid`;
        const groups: { id: string; name: string }[] = [];
        for (const name of body.groups) {
          const groupId = randomUUID();
          await this
            .tx`insert into app.groups(id,workspace_id,cohort_id,name) values(${groupId}::uuid,${this.actor.workspaceId}::uuid,${cohortId}::uuid,${name})`;
          groups.push({ id: groupId, name });
        }
        await this
          .tx`insert into app.session_occurrences(workspace_id,session_definition_id,group_id,starts_at,ends_at)
          select ${this.actor.workspaceId}::uuid,sd.id,g.id,
            ((c.starts_on + ((pw.week_number-1)*7 + sd.day_offset)) + sd.starts_at) at time zone w.timezone,
            (((c.starts_on + ((pw.week_number-1)*7 + sd.day_offset)) + sd.starts_at) at time zone w.timezone) + make_interval(mins=>sd.duration_minutes)
          from app.session_definitions sd join app.plan_weeks pw on pw.id=sd.plan_week_id
          join app.cohorts c on c.current_plan_id=pw.plan_id join app.groups g on g.cohort_id=c.id join app.workspaces w on w.id=c.workspace_id
          where c.id=${cohortId}::uuid`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "COHORT_CREATED",
          "cohort",
          cohortId,
        );
        return { id: cohortId, plan_id: planId, groups };
      },
    });
  }

  enrollStudent(value: unknown, idempotencyKey: unknown) {
    responsible(this.actor);
    const body = parse(
      z
        .object({
          student_profile_id: id,
          cohort_id: id,
          group_id: id,
          effective_from: z.iso.datetime({ offset: true }),
        })
        .strict(),
      value,
    );
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P1_ENROLL_STUDENT",
      key: stableKey,
      payload: body,
      work: async () => {
        const enrollmentId = randomUUID();
        const membershipId = randomUUID();
        await this
          .tx`insert into app.enrollments(id,workspace_id,student_profile_id,cohort_id,effective_from)
          values(${enrollmentId}::uuid,${this.actor.workspaceId}::uuid,${body.student_profile_id}::uuid,
            ${body.cohort_id}::uuid,${body.effective_from}::timestamptz)`;
        await this
          .tx`insert into app.group_memberships(id,workspace_id,enrollment_id,group_id,effective_from)
          values(${membershipId}::uuid,${this.actor.workspaceId}::uuid,${enrollmentId}::uuid,
            ${body.group_id}::uuid,${body.effective_from}::timestamptz)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "STUDENT_ENROLLED",
          "enrollment",
          enrollmentId,
        );
        return { id: enrollmentId, membership_id: membershipId };
      },
    });
  }

  moveEnrollment(value: unknown, idempotencyKey: unknown) {
    responsible(this.actor);
    const body = parse(
      z
        .object({
          enrollment_id: id,
          group_id: id,
          effective_at: z.iso.datetime({ offset: true }),
        })
        .strict(),
      value,
    );
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P1_MOVE_ENROLLMENT",
      key: stableKey,
      payload: body,
      work: async () => {
        const current = await this.tx<
          { id: string; effective_from: Date }[]
        >`select id,effective_from from app.group_memberships
          where enrollment_id=${body.enrollment_id}::uuid and effective_to is null for update`;
        if (!current[0]) throw new AppError("NOT_FOUND");
        if (current[0].effective_from >= new Date(body.effective_at))
          throw new AppError("INVALID_STATE_TRANSITION");
        await this
          .tx`update app.group_memberships set effective_to=${body.effective_at}::timestamptz,
          row_version=row_version+1 where id=${current[0].id}::uuid`;
        const membershipId = randomUUID();
        await this
          .tx`insert into app.group_memberships(id,workspace_id,enrollment_id,group_id,effective_from)
          values(${membershipId}::uuid,${this.actor.workspaceId}::uuid,${body.enrollment_id}::uuid,
            ${body.group_id}::uuid,${body.effective_at}::timestamptz)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "STUDENT_GROUP_MOVED",
          "group_membership",
          membershipId,
        );
        return { id: membershipId };
      },
    });
  }

  assignMentor(value: unknown, idempotencyKey: unknown) {
    responsible(this.actor);
    const body = parse(
      z
        .object({
          group_id: id,
          mentor_person_id: id,
          effective_at: z.iso.datetime({ offset: true }),
        })
        .strict(),
      value,
    );
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P1_ASSIGN_MENTOR",
      key: stableKey,
      payload: body,
      work: async () => {
        const mentor = await this
          .tx`select id from app.login_accounts where person_id=${body.mentor_person_id}::uuid
          and role='MENTOR' and status='ACTIVE'`;
        if (!mentor[0]) throw new AppError("NOT_FOUND");
        const current = await this.tx<
          { id: string; effective_from: Date }[]
        >`select id,effective_from from app.mentor_assignments
          where group_id=${body.group_id}::uuid and effective_to is null for update`;
        if (current[0]) {
          if (current[0].effective_from >= new Date(body.effective_at))
            throw new AppError("INVALID_STATE_TRANSITION");
          await this
            .tx`update app.mentor_assignments set effective_to=${body.effective_at}::timestamptz,
            row_version=row_version+1 where id=${current[0].id}::uuid`;
        }
        const assignmentId = randomUUID();
        await this
          .tx`insert into app.mentor_assignments(id,workspace_id,group_id,mentor_person_id,effective_from)
          values(${assignmentId}::uuid,${this.actor.workspaceId}::uuid,${body.group_id}::uuid,
            ${body.mentor_person_id}::uuid,${body.effective_at}::timestamptz)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "MENTOR_ASSIGNED",
          "mentor_assignment",
          assignmentId,
        );
        return { id: assignmentId };
      },
    });
  }

  async overview() {
    const [templates, plans, cohorts] = await Promise.all([
      this
        .tx`select id,name,level,status,row_version from app.program_templates order by name,id`,
      this
        .tx`select id,template_id,cohort_id,version,name,status,row_version from app.program_plans order by created_at desc,id`,
      this
        .tx`select c.id,c.name,c.starts_on,c.ends_on,c.status,c.current_plan_id,
        coalesce(json_agg(json_build_object('id',g.id,'name',g.name)) filter(where g.id is not null),'[]') as groups
        from app.cohorts c left join app.groups g on g.cohort_id=c.id
        group by c.id order by c.starts_on desc,c.id`,
    ]);
    return { templates, plans, cohorts };
  }
}
