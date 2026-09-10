import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import type { RequestActor } from "../server/authenticated-db";
import { audit } from "./p1-program-service";

const id = z.uuid();
const date = z.iso.date();
const periodSchema = z
  .object({ from: date, to: date })
  .strict()
  .refine(
    (value) => value.to >= value.from && days(value.from, value.to) <= 366,
  );
const reportSchema = z
  .object({ subject_id: id, from: date, to: date })
  .strict()
  .refine(
    (value) => value.to >= value.from && days(value.from, value.to) <= 366,
  );
const exportSchema = reportSchema
  .extend({
    report_type: z.enum([
      "STUDENT_WEEK",
      "GROUP_WEEK",
      "MENTOR_WEEK",
      "PROGRAM",
    ]),
    format: z.literal("CSV"),
  })
  .strict();

function days(from: string, to: string) {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  );
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR");
  return result.data;
}
function responsible(actor: RequestActor) {
  if (actor.role !== "RESPONSIBLE") throw new AppError("FORBIDDEN");
}
function csv(value: unknown) {
  const text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

type Opportunity = {
  dimension: "operational" | "followup" | "data" | "case_response";
  resource_type: string;
  resource_id: string;
  due_at: Date;
  achieved: boolean;
};

const rulesVersion = "mentor-performance-v1";
const weights = {
  operational: 35,
  followup: 30,
  data: 20,
  case_response: 15,
} as const;

export function summarizeOpportunities(rows: Opportunity[]) {
  const evidence: Record<
    string,
    {
      resource_type: string;
      resource_id: string;
      due_at: Date;
      achieved: boolean;
    }[]
  > = { operational: [], followup: [], data: [], case_response: [] };
  for (const row of rows)
    evidence[row.dimension].push({
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      due_at: row.due_at,
      achieved: row.achieved,
    });
  const dimensions = Object.fromEntries(
    Object.entries(weights).map(([name, weight]) => {
      const opportunities = evidence[name].length,
        achieved = evidence[name].filter((item) => item.achieved).length;
      return [
        name,
        {
          weight,
          opportunities,
          achieved,
          score: opportunities
            ? Math.round((achieved / opportunities) * 10000) / 100
            : null,
          applicable: opportunities > 0,
        },
      ];
    }),
  );
  const applicable = Object.values(dimensions).filter(
      (item) => item.applicable,
    ),
    weightTotal = applicable.reduce((sum, item) => sum + item.weight, 0),
    score = weightTotal
      ? Math.round(
          (applicable.reduce(
            (sum, item) => sum + (item.score ?? 0) * item.weight,
            0,
          ) /
            weightTotal) *
            1000,
        ) / 1000
      : null,
    opportunityCount = rows.length;
  return {
    evidence,
    dimensions,
    score,
    opportunityCount,
    dataState:
      opportunityCount === 0
        ? "NO_EVALUATION_DATA"
        : opportunityCount < 5
          ? "LIMITED_DATA"
          : "SUFFICIENT_DATA",
  };
}

export class P6ReportingService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  async today() {
    responsible(this.actor);
    const [attentions, actions, sessions, cases] = await Promise.all([
      this
        .tx`select a.id,a.rule_code,a.status,a.due_at,a.owner_account_id,p.display_name student_name from app.attentions a join app.enrollments e on e.id=a.enrollment_id join app.student_profiles sp on sp.id=e.student_profile_id join app.persons p on p.id=sp.person_id where a.workspace_id=${this.actor.workspaceId}::uuid and a.status in ('OPEN','IN_PROGRESS','SNOOZED') order by a.due_at,a.id limit 100`,
      this
        .tx`select a.id,a.title,a.status,a.due_at,a.owner_account_id,p.display_name student_name from app.actions a join app.enrollments e on e.id=a.enrollment_id join app.student_profiles sp on sp.id=e.student_profile_id join app.persons p on p.id=sp.person_id where a.workspace_id=${this.actor.workspaceId}::uuid and a.status not in ('VERIFIED','CANCELLED') and a.due_at<clock_timestamp() order by a.due_at,a.id limit 100`,
      this
        .tx`select so.id,sd.name,so.ends_at,so.status,g.name group_name from app.session_occurrences so join app.session_definitions sd on sd.id=so.session_definition_id join app.groups g on g.id=so.group_id where so.workspace_id=${this.actor.workspaceId}::uuid and so.status not in ('CLOSED','CANCELLED') and so.ends_at+interval '24 hours'<clock_timestamp() order by so.ends_at,so.id limit 100`,
      this
        .tx`select c.id,c.title,c.priority,c.status,c.owner_account_id,p.display_name student_name from app.cases c join app.enrollments e on e.id=c.enrollment_id join app.student_profiles sp on sp.id=e.student_profile_id join app.persons p on p.id=sp.person_id where c.workspace_id=${this.actor.workspaceId}::uuid and c.status in ('OPEN','MONITORING') order by case c.priority when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end,c.opened_at limit 100`,
    ]);
    return {
      counts: {
        active_attentions: attentions.length,
        overdue_actions: actions.length,
        overdue_sessions: sessions.length,
        open_cases: cases.length,
      },
      attentions,
      actions,
      sessions,
      cases,
    };
  }

  async mentors() {
    responsible(this.actor);
    return this.tx`select a.id,p.display_name,
      (select count(distinct ma.group_id)::int from app.mentor_assignments ma where ma.workspace_id=a.workspace_id and ma.mentor_person_id=a.person_id and ma.effective_from<=clock_timestamp() and (ma.effective_to is null or ma.effective_to>clock_timestamp())) group_count,
      (select count(*)::int from app.attentions at where at.workspace_id=a.workspace_id and at.owner_account_id=a.id and at.status in ('OPEN','IN_PROGRESS','SNOOZED')) active_attention_count,
      (select count(*)::int from app.cases c where c.workspace_id=a.workspace_id and c.owner_account_id=a.id and c.status in ('OPEN','MONITORING')) open_case_count
      from app.login_accounts a join app.persons p on p.id=a.person_id
      where a.workspace_id=${this.actor.workspaceId}::uuid and a.role='MENTOR' and a.status='ACTIVE' order by p.display_name,a.id`;
  }

  async performance(mentorValue: unknown, query: unknown) {
    responsible(this.actor);
    const mentor = parse(id, mentorValue),
      { from, to } = parse(periodSchema, query);
    const mentorRows = await this
      .tx`select a.id,p.display_name from app.login_accounts a join app.persons p on p.id=a.person_id where a.id=${mentor}::uuid and a.workspace_id=${this.actor.workspaceId}::uuid and a.role='MENTOR' and a.status='ACTIVE'`;
    if (!mentorRows[0]) throw new AppError("NOT_FOUND");
    const rows = await this.tx<Opportunity[]>`
      with operational as (
        select 'operational'::text dimension,'session'::text resource_type,so.id resource_id,so.ends_at+interval '24 hours' due_at,
          (so.status='CLOSED' and so.closed_at<=so.ends_at+interval '24 hours') achieved
        from app.session_occurrences so join app.mentor_assignments ma on ma.group_id=so.group_id and ma.workspace_id=so.workspace_id
        join app.login_accounts a on a.person_id=ma.mentor_person_id and a.workspace_id=ma.workspace_id
        where so.workspace_id=${this.actor.workspaceId}::uuid and a.id=${mentor}::uuid
          and ma.effective_from<=so.starts_at and (ma.effective_to is null or ma.effective_to>so.starts_at)
          and so.ends_at::date between ${from}::date and ${to}::date and so.ends_at<=clock_timestamp()
      ), followup as (
        select 'followup','attention',at.id,at.created_at+interval '72 hours',exists(
          select 1 from app.followups f where f.enrollment_id=at.enrollment_id and f.qualifies and f.cancelled_at is null
            and f.occurred_at>=at.created_at and f.occurred_at<=at.created_at+interval '72 hours'
            and at.id=(select at2.id from app.attentions at2 where at2.enrollment_id=f.enrollment_id and at2.owner_account_id=at.owner_account_id
              and f.occurred_at>=at2.created_at and f.occurred_at<=at2.created_at+interval '72 hours'
              order by at2.created_at desc,at2.id desc limit 1))
        from app.attentions at where at.workspace_id=${this.actor.workspaceId}::uuid and at.owner_account_id=${mentor}::uuid
          and at.created_at::date between ${from}::date and ${to}::date
      ), data_slots as (
        select 'data','roster',sr.id,so.ends_at+interval '24 hours',(
          a.status is not null and a.status<>'NOT_RECORDED' and not exists(
            select 1 from app.session_metric_definitions md where md.session_definition_id=so.session_definition_id and md.required
              and md.applies_to ? a.status::text and not exists(select 1 from app.session_metric_records mr where mr.roster_id=sr.id and mr.metric_definition_id=md.id)
          ))
        from app.session_roster sr join app.session_occurrences so on so.id=sr.session_occurrence_id
        join app.mentor_assignments ma on ma.group_id=so.group_id and ma.workspace_id=so.workspace_id
        join app.login_accounts la on la.person_id=ma.mentor_person_id and la.workspace_id=ma.workspace_id
        left join app.attendance a on a.roster_id=sr.id
        where so.workspace_id=${this.actor.workspaceId}::uuid and la.id=${mentor}::uuid
          and ma.effective_from<=so.starts_at and (ma.effective_to is null or ma.effective_to>so.starts_at)
          and so.ends_at::date between ${from}::date and ${to}::date and so.ends_at<=clock_timestamp()
      ), case_response as (
        select 'case_response','action',ac.id,ac.due_at,(
          (ac.completed_at is not null and ac.completed_at<=ac.due_at) or exists(select 1 from app.case_events ce where ce.case_id=ac.case_id and ce.event_type='ESCALATED' and ce.created_at<=ac.due_at))
        from app.actions ac where ac.workspace_id=${this.actor.workspaceId}::uuid and ac.owner_account_id=${mentor}::uuid and ac.case_id is not null
          and ac.due_at::date between ${from}::date and ${to}::date
      )
      select * from operational union all select * from followup union all select * from data_slots union all select * from case_response
      order by dimension,due_at,resource_id`;
    const { evidence, dimensions, score, opportunityCount, dataState } =
        summarizeOpportunities(rows),
      snapshotId = randomUUID();
    await this
      .tx`insert into app.mentor_performance_snapshots(id,workspace_id,mentor_account_id,period_start,period_end,rules_version,dimensions,evidence,score,opportunity_count,limited_data,generated_by_account_id,request_id) values(${snapshotId}::uuid,${this.actor.workspaceId}::uuid,${mentor}::uuid,${from}::date,${to}::date,${rulesVersion},${this.tx.json(dimensions)},${this.tx.json(evidence)},${score},${opportunityCount},${opportunityCount > 0 && opportunityCount < 5},${this.actor.accountId}::uuid,${this.requestId}::uuid)`;
    await audit(
      this.tx,
      this.actor,
      this.requestId,
      "PERFORMANCE_SNAPSHOT_GENERATED",
      "mentor_performance_snapshot",
      snapshotId,
    );
    const history = await this
      .tx`select id,period_start,period_end,score,opportunity_count,limited_data,generated_at from app.mentor_performance_snapshots where mentor_account_id=${mentor}::uuid and id<>${snapshotId}::uuid order by generated_at desc limit 12`;
    return {
      mentor: mentorRows[0],
      period: { from, to },
      rules_version: rulesVersion,
      dimensions,
      score,
      opportunity_count: opportunityCount,
      data_state: dataState,
      evidence,
      snapshot_id: snapshotId,
      history,
    };
  }

  async studentWeek(query: unknown) {
    responsible(this.actor);
    const { subject_id: student, from, to } = parse(reportSchema, query);
    const rows = await this.tx`select sp.id,p.display_name,
      (select count(*)::int from app.session_roster sr join app.session_occurrences so on so.id=sr.session_occurrence_id where sr.enrollment_id=e.id and so.starts_at::date between ${from}::date and ${to}::date) sessions_due,
      (select count(*)::int from app.session_roster sr join app.session_occurrences so on so.id=sr.session_occurrence_id join app.attendance a on a.roster_id=sr.id where sr.enrollment_id=e.id and so.starts_at::date between ${from}::date and ${to}::date and a.status<>'NOT_RECORDED') attendance_recorded,
      (select count(*)::int from app.tracking_entries te where te.enrollment_id=e.id and te.period_start between ${from}::date and ${to}::date) tracking_entries,
      (select count(*)::int from app.assignment_submissions s where s.enrollment_id=e.id and s.submitted_at::date between ${from}::date and ${to}::date and s.status='REVIEWED') assignments_reviewed,
      (select count(*)::int from app.exam_results er where er.enrollment_id=e.id and er.published_at::date between ${from}::date and ${to}::date and er.status='PUBLISHED') exams_published,
      (select count(*)::int from app.attentions at where at.enrollment_id=e.id and at.created_at::date between ${from}::date and ${to}::date) attentions,
      (select count(*)::int from app.cases c where c.enrollment_id=e.id and c.opened_at::date between ${from}::date and ${to}::date) cases
      from app.student_profiles sp join app.persons p on p.id=sp.person_id join app.enrollments e on e.student_profile_id=sp.id
      where sp.id=${student}::uuid and sp.workspace_id=${this.actor.workspaceId}::uuid order by e.effective_from desc limit 1`;
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return {
      report_type: "STUDENT_WEEK",
      period: { from, to },
      student: rows[0],
    };
  }

  async groupWeek(query: unknown) {
    responsible(this.actor);
    const { subject_id: group, from, to } = parse(reportSchema, query);
    const rows = await this.tx`select g.id,g.name,
      (select count(distinct gm.enrollment_id)::int from app.group_memberships gm where gm.group_id=g.id and gm.effective_from<=(${to}::date+1)::timestamptz and (gm.effective_to is null or gm.effective_to>${from}::date::timestamptz)) students,
      (select count(*)::int from app.session_occurrences so where so.group_id=g.id and so.starts_at::date between ${from}::date and ${to}::date) sessions,
      (select count(*)::int from app.session_occurrences so where so.group_id=g.id and so.starts_at::date between ${from}::date and ${to}::date and so.status='CLOSED') sessions_closed,
      (select count(*)::int from app.attentions at join app.enrollments e on e.id=at.enrollment_id join app.group_memberships gm on gm.enrollment_id=e.id where gm.group_id=g.id and at.created_at::date between ${from}::date and ${to}::date) attentions,
      (select count(*)::int from app.cases c join app.group_memberships gm on gm.enrollment_id=c.enrollment_id where gm.group_id=g.id and c.opened_at::date between ${from}::date and ${to}::date) cases
      from app.groups g where g.id=${group}::uuid and g.workspace_id=${this.actor.workspaceId}::uuid`;
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { report_type: "GROUP_WEEK", period: { from, to }, group: rows[0] };
  }

  mentorWeek(query: unknown) {
    const value = parse(reportSchema, query);
    return this.performance(value.subject_id, {
      from: value.from,
      to: value.to,
    });
  }

  async program(query: unknown) {
    responsible(this.actor);
    const { subject_id: cohort, from, to } = parse(reportSchema, query);
    const rows = await this.tx`select c.id,c.name,
      (select count(*)::int from app.enrollments e where e.cohort_id=c.id and e.effective_from<=(${to}::date+1)::timestamptz and (e.effective_to is null or e.effective_to>${from}::date::timestamptz)) students,
      (select count(*)::int from app.groups g where g.cohort_id=c.id) groups,
      (select count(*)::int from app.session_occurrences so join app.groups g on g.id=so.group_id where g.cohort_id=c.id and so.starts_at::date between ${from}::date and ${to}::date) sessions,
      (select count(*)::int from app.attentions at join app.enrollments e on e.id=at.enrollment_id where e.cohort_id=c.id and at.created_at::date between ${from}::date and ${to}::date) attentions,
      (select count(*)::int from app.cases ca join app.enrollments e on e.id=ca.enrollment_id where e.cohort_id=c.id and ca.opened_at::date between ${from}::date and ${to}::date) cases
      from app.cohorts c where c.id=${cohort}::uuid and c.workspace_id=${this.actor.workspaceId}::uuid`;
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return { report_type: "PROGRAM", period: { from, to }, program: rows[0] };
  }

  async exportReport(query: unknown) {
    responsible(this.actor);
    const value = parse(exportSchema, query);
    const base = {
      subject_id: value.subject_id,
      from: value.from,
      to: value.to,
    };
    const report =
      value.report_type === "STUDENT_WEEK"
        ? await this.studentWeek(base)
        : value.report_type === "GROUP_WEEK"
          ? await this.groupWeek(base)
          : value.report_type === "MENTOR_WEEK"
            ? await this.mentorWeek(base)
            : await this.program(base);
    const content = `report_type,period_from,period_to,data\r\n${csv(value.report_type)},${csv(value.from)},${csv(value.to)},${csv(report)}\r\n`;
    const exportId = randomUUID();
    await this
      .tx`insert into app.report_exports(id,workspace_id,report_type,format,filters,row_count,generated_by_account_id,request_id) values(${exportId}::uuid,${this.actor.workspaceId}::uuid,${value.report_type},'CSV',${this.tx.json(base)},1,${this.actor.accountId}::uuid,${this.requestId}::uuid)`;
    await audit(
      this.tx,
      this.actor,
      this.requestId,
      "REPORT_EXPORTED",
      "report_export",
      exportId,
    );
    return {
      id: exportId,
      filename: `${value.report_type.toLowerCase()}-${value.from}-${value.to}.csv`,
      mime_type: "text/csv;charset=utf-8",
      row_count: 1,
      content,
    };
  }

  async auditEvents(query: unknown) {
    responsible(this.actor);
    const value = parse(
      z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          cursor: z.iso.datetime({ offset: true }).optional(),
          action: z.string().trim().min(1).max(80).optional(),
        })
        .strict(),
      query,
    );
    const rows = await this
      .tx`select id,actor_account_id,actor_role,action,resource_type,resource_id,reason,occurred_at from app.audit_events where workspace_id=${this.actor.workspaceId}::uuid and (${value.cursor ?? null}::timestamptz is null or occurred_at<${value.cursor ?? null}::timestamptz) and (${value.action ?? null}::text is null or action=${value.action ?? null}) order by occurred_at desc,id desc limit ${value.limit}`;
    return {
      events: rows,
      next_cursor:
        rows.length === value.limit ? rows.at(-1)?.occurred_at : null,
    };
  }
}
