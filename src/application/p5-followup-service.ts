import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import type { RequestActor } from "../server/authenticated-db";
import { audit, idempotent } from "./p1-program-service";

const id = z.uuid(),
  key = z.string().min(1).max(128),
  text = z.string().trim().min(3).max(5000),
  reason = z.string().trim().min(3).max(500);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR");
  return result.data;
}
function number(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new AppError("INTERNAL_ERROR");
  return parsed;
}
function operate(actor: RequestActor) {
  if (actor.role === "STUDENT") throw new AppError("FORBIDDEN");
}

export class P5FollowupService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  async overview() {
    operate(this.actor);
    const [attentions, actions, followups, cases] = await Promise.all([
      this
        .tx`select a.id,a.enrollment_id,a.rule_code,a.evidence,a.status,a.owner_account_id,a.original_due_at,a.due_at,a.snoozed_until,a.resolution_reason,a.row_version,p.display_name student_name from app.attentions a join app.enrollments e on e.id=a.enrollment_id join app.student_profiles sp on sp.id=e.student_profile_id join app.persons p on p.id=sp.person_id order by case a.status when 'OPEN' then 0 when 'IN_PROGRESS' then 1 when 'SNOOZED' then 2 else 3 end,a.due_at,a.id`,
      this
        .tx`select id,enrollment_id,attention_id,case_id,owner_account_id,title,status,original_due_at,due_at,completion_note,verification_note,row_version from app.actions order by due_at,id`,
      this
        .tx`select id,enrollment_id,performed_by_account_id,occurred_at,channel,outcome,qualifies,action_id,case_id,current_version,cancelled_at,row_version from app.followups order by occurred_at desc,id`,
      this
        .tx`select id,enrollment_id,title,problem,priority,status,owner_account_id,resolution_summary,opened_at,resolved_at,row_version from app.cases order by case priority when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end,opened_at desc,id`,
    ]);
    return {
      actor_role: this.actor.role,
      attentions,
      actions,
      followups,
      cases,
    };
  }

  evaluate(value: unknown, idempotencyKey: unknown) {
    operate(this.actor);
    const body = parse(
        z
          .object({ as_of: z.iso.datetime({ offset: true }).optional() })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P5_EVALUATE_ATTENTION",
      key: stableKey,
      payload: body,
      work: async () => {
        const asOf = body.as_of ?? new Date().toISOString();
        const candidates = await this.tx<
          {
            enrollment_id: string;
            rule_code: string;
            evidence_key: string;
            due_at: Date;
            evidence: postgres.JSONValue;
          }[]
        >`
        with visible as (
          select e.id,e.effective_from from app.enrollments e where e.workspace_id=${this.actor.workspaceId}::uuid
            and app.actor_can_access_p5_enrollment(e.workspace_id,e.id,${asOf}::timestamptz)
        ), absences as (
          select sr.enrollment_id,so.id,so.starts_at,row_number() over(partition by sr.enrollment_id order by so.starts_at desc) n
          from app.session_roster sr join app.attendance a on a.roster_id=sr.id join app.session_occurrences so on so.id=sr.session_occurrence_id
          join visible v on v.id=sr.enrollment_id where a.status='UNEXCUSED_ABSENCE' and so.starts_at<=${asOf}::timestamptz
        ), two_absent as (
          select enrollment_id,min(starts_at) due_at,string_agg(id::text,':' order by starts_at) evidence_key from absences where n<=2 group by enrollment_id having count(*)=2
        ), last_followup as (select enrollment_id,max(occurred_at) at from app.followups where qualifies and cancelled_at is null group by enrollment_id),
        exam_due as (
          select e.id enrollment_id,ed.id exam_id,(c.starts_on+((pw.week_number-1)*7+ed.day_offset))::timestamptz due_at
          from visible v join app.enrollments e on e.id=v.id join app.cohorts c on c.id=e.cohort_id join app.plan_weeks pw on pw.plan_id=c.current_plan_id
          join app.exam_definitions ed on ed.plan_week_id=pw.id left join app.exam_results er on er.enrollment_id=e.id and er.exam_definition_id=ed.id and er.status='PUBLISHED'
          where er.id is null and (c.starts_on+((pw.week_number-1)*7+ed.day_offset))::timestamptz<${asOf}::timestamptz
        ), assignment_due as (
          select e.id enrollment_id,ad.id assignment_id,(c.starts_on+((pw.week_number-1)*7+ad.due_day_offset))::timestamptz due_at
          from visible v join app.enrollments e on e.id=v.id join app.cohorts c on c.id=e.cohort_id join app.plan_weeks pw on pw.plan_id=c.current_plan_id
          join app.assignment_definitions ad on ad.plan_week_id=pw.id left join app.assignment_submissions s on s.enrollment_id=e.id and s.assignment_definition_id=ad.id and s.status='REVIEWED'
          where s.id is null and (c.starts_on+((pw.week_number-1)*7+ad.due_day_offset))::timestamptz<${asOf}::timestamptz
        )
        select enrollment_id,'CONSECUTIVE_UNEXCUSED_ABSENCE' rule_code,evidence_key,due_at,jsonb_build_object('session_ids',string_to_array(evidence_key,':')) evidence from two_absent
        union all select v.id,'NO_QUALIFIED_FOLLOWUP_14D','followup:'||v.id,coalesce(l.at,v.effective_from)+interval '14 days',jsonb_build_object('last_qualified_at',l.at) from visible v left join last_followup l on l.enrollment_id=v.id where coalesce(l.at,v.effective_from)+interval '14 days'<${asOf}::timestamptz
        union all select v.id,'NEW_STUDENT_NO_CHECKIN_3D','checkin:'||v.id,v.effective_from+interval '3 days',jsonb_build_object('enrolled_at',v.effective_from) from visible v left join last_followup l on l.enrollment_id=v.id where l.at is null and v.effective_from+interval '3 days'<${asOf}::timestamptz
        union all select sr.enrollment_id,'SESSION_OVERDUE_24H','session:'||so.id,so.ends_at+interval '24 hours',jsonb_build_object('session_id',so.id) from app.session_roster sr join visible v on v.id=sr.enrollment_id join app.session_occurrences so on so.id=sr.session_occurrence_id where so.status not in ('CLOSED','CANCELLED') and so.ends_at+interval '24 hours'<${asOf}::timestamptz
        union all select enrollment_id,'EXAM_OR_REVIEW_OVERDUE','exam:'||exam_id,due_at,jsonb_build_object('exam_id',exam_id) from exam_due
        union all select enrollment_id,'EXAM_OR_REVIEW_OVERDUE','assignment:'||assignment_id,due_at,jsonb_build_object('assignment_id',assignment_id) from assignment_due
        union all select c.enrollment_id,'CASE_ACTION_OVERDUE','case:'||c.id,coalesce(min(a.due_at),c.opened_at),jsonb_build_object('case_id',c.id) from app.cases c join visible v on v.id=c.enrollment_id left join app.actions a on a.case_id=c.id and a.status not in ('VERIFIED','CANCELLED') where c.status in ('OPEN','MONITORING') group by c.id,c.enrollment_id,c.opened_at having count(a.id)=0 or min(a.due_at)<${asOf}::timestamptz`;
        let created = 0;
        for (const item of candidates) {
          const attentionId = randomUUID();
          const owners = await this.tx<{ id: string }[]>`
            select a.id from app.group_memberships gm
            join app.mentor_assignments ma on ma.group_id=gm.group_id and ma.workspace_id=gm.workspace_id
            join app.login_accounts a on a.person_id=ma.mentor_person_id and a.workspace_id=ma.workspace_id and a.role='MENTOR' and a.status='ACTIVE'
            where gm.enrollment_id=${item.enrollment_id}::uuid
              and gm.effective_from<=${item.due_at} and (gm.effective_to is null or gm.effective_to>${item.due_at})
              and ma.effective_from<=${item.due_at} and (ma.effective_to is null or ma.effective_to>${item.due_at})
            order by ma.effective_from desc,a.id limit 1`;
          const rows = await this
            .tx`insert into app.attentions(id,workspace_id,enrollment_id,rule_code,evidence_key,evidence,owner_account_id,original_due_at,due_at)
          values(${attentionId}::uuid,${this.actor.workspaceId}::uuid,${item.enrollment_id}::uuid,${item.rule_code},${item.evidence_key},${this.tx.json(item.evidence)},${owners[0]?.id ?? this.actor.accountId}::uuid,${item.due_at},${item.due_at}) on conflict do nothing returning id`;
          if (rows[0]) {
            created++;
            await audit(
              this.tx,
              this.actor,
              this.requestId,
              "ATTENTION_CREATED",
              "attention",
              attentionId,
            );
          }
        }
        return { id: randomUUID(), evaluated: candidates.length, created };
      },
    });
  }

  attentionTransition(
    targetValue: unknown,
    operation: "claim" | "snooze" | "resolve" | "dismiss",
    value: unknown,
    idempotencyKey: unknown,
  ) {
    operate(this.actor);
    const target = parse(id, targetValue),
      body = parse(
        z
          .object({
            row_version: z.number().int().positive(),
            reason: reason.optional(),
            until: z.iso.datetime({ offset: true }).optional(),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: `P5_ATTENTION_${operation.toUpperCase()}`,
      key: stableKey,
      payload: { target, ...body },
      work: async () => {
        const rows = await this.tx<
          {
            status: string;
            row_version: unknown;
            due_at: Date;
            enrollment_id: string;
            rule_code: string;
            evidence: Record<string, string | string[] | null>;
          }[]
        >`select status,row_version,due_at,enrollment_id,rule_code,evidence from app.attentions where id=${target}::uuid for update`;
        const item = rows[0];
        if (!item) throw new AppError("NOT_FOUND");
        if (number(item.row_version) !== body.row_version)
          throw new AppError("VERSION_CONFLICT");
        if (operation === "claim" && !["OPEN", "SNOOZED"].includes(item.status))
          throw new AppError("INVALID_STATE_TRANSITION");
        if (
          operation === "snooze" &&
          !["OPEN", "IN_PROGRESS"].includes(item.status)
        )
          throw new AppError("INVALID_STATE_TRANSITION");
        if (
          operation === "snooze" &&
          (!body.until || new Date(body.until) <= new Date())
        )
          throw new AppError("VALIDATION_ERROR");
        if (
          ["resolve", "dismiss"].includes(operation) &&
          (!body.reason ||
            !["OPEN", "IN_PROGRESS", "SNOOZED"].includes(item.status))
        )
          throw new AppError("INVALID_STATE_TRANSITION");
        if (
          operation === "resolve" &&
          (await this.attentionCauseStillExists(item))
        )
          throw new AppError("INVALID_STATE_TRANSITION");
        const status =
          operation === "claim"
            ? "IN_PROGRESS"
            : operation === "snooze"
              ? "SNOOZED"
              : operation === "resolve"
                ? "RESOLVED"
                : "DISMISSED";
        await this
          .tx`update app.attentions set status=${status}::app.attention_status,owner_account_id=case when ${operation}='claim' then ${this.actor.accountId}::uuid else owner_account_id end,snoozed_until=case when ${operation}='snooze' then ${body.until ?? null}::timestamptz else snoozed_until end,due_at=case when ${operation}='snooze' then ${body.until ?? item.due_at.toISOString()}::timestamptz else due_at end,resolution_reason=${body.reason ?? null},row_version=row_version+1,updated_at=clock_timestamp() where id=${target}::uuid`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          `ATTENTION_${operation.toUpperCase()}`,
          "attention",
          target,
        );
        return { id: target, status, row_version: body.row_version + 1 };
      },
    });
  }

  private async attentionCauseStillExists(item: {
    enrollment_id: string;
    rule_code: string;
    evidence: Record<string, string | string[] | null>;
  }) {
    const e = item.evidence;
    if (item.rule_code === "NO_QUALIFIED_FOLLOWUP_14D") {
      const rows = await this
        .tx`select 1 from app.enrollments en left join lateral (select max(occurred_at) at from app.followups f where f.enrollment_id=en.id and f.qualifies and f.cancelled_at is null) f on true where en.id=${item.enrollment_id}::uuid and coalesce(f.at,en.effective_from)+interval '14 days'<clock_timestamp()`;
      return Boolean(rows[0]);
    }
    if (item.rule_code === "NEW_STUDENT_NO_CHECKIN_3D") {
      const rows = await this
        .tx`select 1 from app.enrollments en where en.id=${item.enrollment_id}::uuid and en.effective_from+interval '3 days'<clock_timestamp() and not exists(select 1 from app.followups f where f.enrollment_id=en.id and f.qualifies and f.cancelled_at is null)`;
      return Boolean(rows[0]);
    }
    if (item.rule_code === "SESSION_OVERDUE_24H" && e.session_id) {
      const rows = await this
        .tx`select 1 from app.session_occurrences where id=${e.session_id}::uuid and status not in ('CLOSED','CANCELLED') and ends_at+interval '24 hours'<clock_timestamp()`;
      return Boolean(rows[0]);
    }
    if (item.rule_code === "EXAM_OR_REVIEW_OVERDUE") {
      if (e.exam_id) {
        const rows = await this
          .tx`select 1 from app.exam_definitions ed join app.plan_weeks pw on pw.id=ed.plan_week_id join app.cohorts c on c.current_plan_id=pw.plan_id join app.enrollments en on en.cohort_id=c.id where en.id=${item.enrollment_id}::uuid and ed.id=${e.exam_id}::uuid and (c.starts_on+((pw.week_number-1)*7+ed.day_offset))::timestamptz<clock_timestamp() and not exists(select 1 from app.exam_results er where er.enrollment_id=en.id and er.exam_definition_id=ed.id and er.status='PUBLISHED')`;
        return Boolean(rows[0]);
      }
      if (e.assignment_id) {
        const rows = await this
          .tx`select 1 from app.assignment_definitions ad join app.plan_weeks pw on pw.id=ad.plan_week_id join app.cohorts c on c.current_plan_id=pw.plan_id join app.enrollments en on en.cohort_id=c.id where en.id=${item.enrollment_id}::uuid and ad.id=${e.assignment_id}::uuid and (c.starts_on+((pw.week_number-1)*7+ad.due_day_offset))::timestamptz<clock_timestamp() and not exists(select 1 from app.assignment_submissions s where s.enrollment_id=en.id and s.assignment_definition_id=ad.id and s.status='REVIEWED')`;
        return Boolean(rows[0]);
      }
    }
    if (item.rule_code === "CASE_ACTION_OVERDUE" && e.case_id) {
      const rows = await this
        .tx`select 1 from app.cases c where c.id=${e.case_id}::uuid and c.status in ('OPEN','MONITORING') and (not exists(select 1 from app.actions a where a.case_id=c.id and a.status not in ('VERIFIED','CANCELLED')) or exists(select 1 from app.actions a where a.case_id=c.id and a.status not in ('VERIFIED','CANCELLED') and a.due_at<clock_timestamp()))`;
      return Boolean(rows[0]);
    }
    if (item.rule_code === "CONSECUTIVE_UNEXCUSED_ABSENCE") {
      const rows = await this
        .tx`select count(*) count from (select 1 from app.session_roster sr join app.attendance a on a.roster_id=sr.id join app.session_occurrences so on so.id=sr.session_occurrence_id where sr.enrollment_id=${item.enrollment_id}::uuid and a.status='UNEXCUSED_ABSENCE' and so.starts_at<=clock_timestamp() order by so.starts_at desc limit 2) x`;
      return Number(rows[0]?.count) === 2;
    }
    return true;
  }

  async followupsForStudent(studentValue: unknown) {
    operate(this.actor);
    const student = parse(id, studentValue);
    return this
      .tx`select f.id,f.enrollment_id,f.performed_by_account_id,f.occurred_at,f.channel,f.outcome,f.qualifies,f.action_id,f.case_id,f.current_version,f.cancelled_at,f.row_version
      from app.followups f join app.enrollments e on e.id=f.enrollment_id
      where e.student_profile_id=${student}::uuid order by f.occurred_at desc,f.id`;
  }

  async caseDetail(caseValue: unknown) {
    operate(this.actor);
    const caseId = parse(id, caseValue);
    const cases = await this
      .tx`select id,enrollment_id,title,problem,priority,status,owner_account_id,resolution_summary,opened_at,resolved_at,row_version from app.cases where id=${caseId}::uuid`;
    if (!cases[0]) throw new AppError("NOT_FOUND");
    const [actions, followups, events] = await Promise.all([
      this
        .tx`select id,enrollment_id,attention_id,case_id,owner_account_id,title,status,original_due_at,due_at,completion_note,verification_note,row_version from app.actions where case_id=${caseId}::uuid order by due_at,id`,
      this
        .tx`select id,enrollment_id,performed_by_account_id,occurred_at,channel,outcome,qualifies,action_id,case_id,current_version,cancelled_at,row_version from app.followups where case_id=${caseId}::uuid order by occurred_at desc,id`,
      this
        .tx`select id,event_type,note,actor_account_id,occurred_at from app.case_events where case_id=${caseId}::uuid order by occurred_at,id`,
    ]);
    return { case: cases[0], actions, followups, events };
  }

  createAction(value: unknown, idempotencyKey: unknown) {
    operate(this.actor);
    const body = parse(
        z
          .object({
            enrollment_id: id,
            attention_id: id.nullable().default(null),
            case_id: id.nullable().default(null),
            owner_account_id: id,
            title: text.max(300),
            due_at: z.iso.datetime({ offset: true }),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P5_CREATE_ACTION",
      key: stableKey,
      payload: body,
      work: async () => {
        const resource = randomUUID();
        await this
          .tx`insert into app.actions(id,workspace_id,enrollment_id,attention_id,case_id,owner_account_id,title,original_due_at,due_at) values(${resource}::uuid,${this.actor.workspaceId}::uuid,${body.enrollment_id}::uuid,${body.attention_id}::uuid,${body.case_id}::uuid,${body.owner_account_id}::uuid,${body.title},${body.due_at},${body.due_at})`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "ACTION_CREATED",
          "action",
          resource,
        );
        return { id: resource, status: "OPEN", row_version: 1 };
      },
    });
  }

  actionTransition(
    targetValue: unknown,
    operation: "start" | "complete" | "verify" | "reschedule" | "cancel",
    value: unknown,
    idempotencyKey: unknown,
  ) {
    operate(this.actor);
    const target = parse(id, targetValue),
      body = parse(
        z
          .object({
            row_version: z.number().int().positive(),
            note: text.optional(),
            due_at: z.iso.datetime({ offset: true }).optional(),
            reason: reason.optional(),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: `P5_ACTION_${operation.toUpperCase()}`,
      key: stableKey,
      payload: { target, ...body },
      work: async () => {
        const rows = await this.tx<
          { status: string; row_version: unknown }[]
        >`select status,row_version from app.actions where id=${target}::uuid for update`;
        const item = rows[0];
        if (!item) throw new AppError("NOT_FOUND");
        if (number(item.row_version) !== body.row_version)
          throw new AppError("VERSION_CONFLICT");
        const allowed =
          operation === "start"
            ? item.status === "OPEN"
            : operation === "complete"
              ? item.status === "IN_PROGRESS"
              : operation === "verify"
                ? item.status === "DONE_PENDING_VERIFICATION"
                : operation === "reschedule"
                  ? ["OPEN", "IN_PROGRESS"].includes(item.status)
                  : !["VERIFIED", "CANCELLED"].includes(item.status);
        if (!allowed) throw new AppError("INVALID_STATE_TRANSITION");
        if (
          (operation === "complete" && !body.note) ||
          (operation === "verify" && !body.note) ||
          (operation === "reschedule" && !body.due_at) ||
          (operation === "cancel" && !body.reason)
        )
          throw new AppError("VALIDATION_ERROR");
        const status =
          operation === "start"
            ? "IN_PROGRESS"
            : operation === "complete"
              ? "DONE_PENDING_VERIFICATION"
              : operation === "verify"
                ? "VERIFIED"
                : operation === "cancel"
                  ? "CANCELLED"
                  : item.status;
        await this
          .tx`update app.actions set status=${status}::app.action_status,due_at=coalesce(${body.due_at ?? null}::timestamptz,due_at),completion_note=case when ${operation}='complete' then ${body.note ?? null} else completion_note end,verification_note=case when ${operation}='verify' then ${body.note ?? null} else verification_note end,completed_at=case when ${operation}='complete' then clock_timestamp() else completed_at end,verified_at=case when ${operation}='verify' then clock_timestamp() else verified_at end,cancelled_at=case when ${operation}='cancel' then clock_timestamp() else cancelled_at end,cancellation_reason=case when ${operation}='cancel' then ${body.reason ?? null} else cancellation_reason end,row_version=row_version+1,updated_at=clock_timestamp() where id=${target}::uuid`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          `ACTION_${operation.toUpperCase()}`,
          "action",
          target,
        );
        return { id: target, status, row_version: body.row_version + 1 };
      },
    });
  }

  createFollowup(
    studentValue: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    operate(this.actor);
    const student = parse(id, studentValue),
      body = parse(
        z
          .object({
            enrollment_id: id,
            occurred_at: z.iso.datetime({ offset: true }),
            channel: z.enum([
              "IN_PERSON",
              "PHONE",
              "MESSAGE",
              "VIDEO",
              "OTHER",
            ]),
            outcome: text,
            qualifies: z.boolean(),
            action_id: id.nullable().default(null),
            case_id: id.nullable().default(null),
          })
          .strict(),
        value,
      );
    if (new Date(body.occurred_at) > new Date())
      throw new AppError("VALIDATION_ERROR");
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P5_CREATE_FOLLOWUP",
      key: stableKey,
      payload: { student, ...body },
      work: async () => {
        const enrollment = await this
          .tx`select e.id from app.enrollments e where e.id=${body.enrollment_id}::uuid and e.student_profile_id=${student}::uuid`;
        if (!enrollment[0]) throw new AppError("NOT_FOUND");
        const resource = randomUUID();
        await this
          .tx`insert into app.followups(id,workspace_id,enrollment_id,performed_by_account_id,occurred_at,channel,outcome,qualifies,action_id,case_id) values(${resource}::uuid,${this.actor.workspaceId}::uuid,${body.enrollment_id}::uuid,${this.actor.accountId}::uuid,${body.occurred_at},${body.channel},${body.outcome},${body.qualifies},${body.action_id}::uuid,${body.case_id}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "FOLLOWUP_RECORDED",
          "followup",
          resource,
        );
        return { id: resource, version: 1, row_version: 1 };
      },
    });
  }

  correctFollowup(
    targetValue: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    operate(this.actor);
    const target = parse(id, targetValue),
      body = parse(
        z
          .object({
            row_version: z.number().int().positive(),
            occurred_at: z.iso.datetime({ offset: true }),
            channel: z.enum([
              "IN_PERSON",
              "PHONE",
              "MESSAGE",
              "VIDEO",
              "OTHER",
            ]),
            outcome: text,
            qualifies: z.boolean(),
            cancel: z.boolean().default(false),
            reason,
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P5_CORRECT_FOLLOWUP",
      key: stableKey,
      payload: { target, ...body },
      work: async () => {
        const rows = await this.tx<
          {
            row_version: unknown;
            current_version: number;
            occurred_at: Date;
            channel: string;
            outcome: string;
            qualifies: boolean;
            cancelled_at: Date | null;
          }[]
        >`select row_version,current_version,occurred_at,channel,outcome,qualifies,cancelled_at from app.followups where id=${target}::uuid for update`;
        const item = rows[0];
        if (!item) throw new AppError("NOT_FOUND");
        if (number(item.row_version) !== body.row_version)
          throw new AppError("VERSION_CONFLICT");
        const version = item.current_version + 1;
        await this
          .tx`insert into app.followup_revisions(workspace_id,followup_id,followup_version,snapshot,actor_account_id,reason,request_id) values(${this.actor.workspaceId}::uuid,${target}::uuid,${item.current_version},${this.tx.json({ occurred_at: item.occurred_at, channel: item.channel, outcome: item.outcome, qualifies: item.qualifies, cancelled_at: item.cancelled_at })},${this.actor.accountId}::uuid,${body.reason},${this.requestId}::uuid)`;
        await this
          .tx`update app.followups set occurred_at=${body.occurred_at},channel=${body.channel},outcome=${body.outcome},qualifies=${body.qualifies},cancelled_at=case when ${body.cancel} then clock_timestamp() else null end,cancellation_reason=case when ${body.cancel} then ${body.reason} else null end,current_version=${version},row_version=row_version+1,updated_at=clock_timestamp() where id=${target}::uuid`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "FOLLOWUP_CORRECTED",
          "followup",
          target,
        );
        return {
          id: target,
          version,
          row_version: body.row_version + 1,
          cancelled: body.cancel,
        };
      },
    });
  }

  createCase(value: unknown, idempotencyKey: unknown) {
    operate(this.actor);
    const body = parse(
        z
          .object({
            enrollment_id: id,
            title: text.max(160),
            problem: text,
            priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
            owner_account_id: id,
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P5_CREATE_CASE",
      key: stableKey,
      payload: body,
      work: async () => {
        const resource = randomUUID();
        await this
          .tx`insert into app.cases(id,workspace_id,enrollment_id,title,problem,priority,owner_account_id) values(${resource}::uuid,${this.actor.workspaceId}::uuid,${body.enrollment_id}::uuid,${body.title},${body.problem},${body.priority}::app.case_priority,${body.owner_account_id}::uuid)`;
        await this
          .tx`insert into app.case_events(workspace_id,case_id,event_type,note,actor_account_id,request_id) values(${this.actor.workspaceId}::uuid,${resource}::uuid,'OPENED',${body.problem},${this.actor.accountId}::uuid,${this.requestId}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "CASE_OPENED",
          "case",
          resource,
        );
        return { id: resource, status: "OPEN", row_version: 1 };
      },
    });
  }

  caseCommand(
    targetValue: unknown,
    operation:
      "event" | "assign" | "escalate" | "resolve" | "reopen" | "archive",
    value: unknown,
    idempotencyKey: unknown,
  ) {
    operate(this.actor);
    const target = parse(id, targetValue),
      body = parse(
        z
          .object({
            row_version: z.number().int().positive(),
            note: text,
            owner_account_id: id.optional(),
            priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: `P5_CASE_${operation.toUpperCase()}`,
      key: stableKey,
      payload: { target, ...body },
      work: async () => {
        const rows = await this.tx<
          { status: string; row_version: unknown }[]
        >`select status,row_version from app.cases where id=${target}::uuid for update`;
        const item = rows[0];
        if (!item) throw new AppError("NOT_FOUND");
        if (number(item.row_version) !== body.row_version)
          throw new AppError("VERSION_CONFLICT");
        if (operation === "resolve") {
          const verified = await this
            .tx`select 1 from app.actions where case_id=${target}::uuid and status='VERIFIED' limit 1`;
          if (!verified[0]) throw new AppError("INVALID_STATE_TRANSITION");
        }
        if (
          (operation === "archive" && item.status !== "RESOLVED") ||
          (operation === "reopen" &&
            !["RESOLVED", "ARCHIVED"].includes(item.status))
        )
          throw new AppError("INVALID_STATE_TRANSITION");
        const status =
          operation === "resolve"
            ? "RESOLVED"
            : operation === "reopen"
              ? "OPEN"
              : operation === "archive"
                ? "ARCHIVED"
                : operation === "escalate"
                  ? "MONITORING"
                  : item.status;
        await this
          .tx`update app.cases set status=${status}::app.case_status,owner_account_id=coalesce(${body.owner_account_id ?? null}::uuid,owner_account_id),priority=coalesce(${body.priority ?? null}::app.case_priority,priority),resolution_summary=case when ${operation}='resolve' then ${body.note} else resolution_summary end,resolved_at=case when ${operation}='resolve' then clock_timestamp() when ${operation}='reopen' then null else resolved_at end,archived_at=case when ${operation}='archive' then clock_timestamp() else archived_at end,row_version=row_version+1,updated_at=clock_timestamp() where id=${target}::uuid`;
        const event =
          operation === "event"
            ? "NOTE"
            : operation === "assign"
              ? "ASSIGNED"
              : operation === "escalate"
                ? "ESCALATED"
                : operation.toUpperCase();
        await this
          .tx`insert into app.case_events(workspace_id,case_id,event_type,note,actor_account_id,request_id) values(${this.actor.workspaceId}::uuid,${target}::uuid,${event},${body.note},${this.actor.accountId}::uuid,${this.requestId}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          `CASE_${event}`,
          "case",
          target,
        );
        return { id: target, status, row_version: body.row_version + 1 };
      },
    });
  }
}
