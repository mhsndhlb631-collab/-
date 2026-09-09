import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import type { RequestActor } from "../server/authenticated-db";
import { audit, idempotent } from "./p1-program-service";

const id = z.uuid(),
  key = z.string().min(1).max(128);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR");
  return result.data;
}
function canOperate(actor: RequestActor) {
  if (actor.role === "STUDENT") throw new AppError("FORBIDDEN");
}
function number(value: unknown) {
  return Number(value);
}

export class P4LearningService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  async overview() {
    const [content, assignments, exams, enrollments] = await Promise.all([
      this
        .tx`select ci.id,ci.title,ci.body,ci.published_at,pw.id week_id,pw.week_number,pw.title week_title
        from app.content_items ci join app.plan_weeks pw on pw.id=ci.plan_week_id order by pw.week_number,ci.title`,
      this
        .tx`select ad.id,ad.title,ad.instructions,ad.due_day_offset,ad.max_score,ad.weight,pw.id week_id,pw.week_number,
        coalesce(json_agg(json_build_object('id',s.id,'enrollment_id',s.enrollment_id,'answer',s.answer,'status',s.status,
        'score',s.score,'student_feedback',case when ${this.actor.role}='STUDENT' and s.feedback_published_at is null then null else s.student_feedback end,
        'row_version',s.row_version)) filter(where s.id is not null),'[]') submissions
        from app.assignment_definitions ad join app.plan_weeks pw on pw.id=ad.plan_week_id
        left join app.assignment_submissions s on s.assignment_definition_id=ad.id group by ad.id,pw.id order by pw.week_number,ad.title`,
      this
        .tx`select ed.id,ed.title,ed.day_offset,ed.max_score,ed.weight,pw.id week_id,pw.week_number,
        coalesce(json_agg(json_build_object('id',r.id,'enrollment_id',r.enrollment_id,'score',r.score,'status',r.status,
        'student_feedback',case when ${this.actor.role}='STUDENT' and r.status<>'PUBLISHED' then null else r.student_feedback end,
        'row_version',r.row_version)) filter(where r.id is not null),'[]') results
        from app.exam_definitions ed join app.plan_weeks pw on pw.id=ed.plan_week_id
        left join app.exam_results r on r.exam_definition_id=ed.id group by ed.id,pw.id order by pw.week_number,ed.title`,
      this
        .tx`select e.id enrollment_id,sp.id student_id,p.display_name,c.id cohort_id,c.current_plan_id
        from app.enrollments e join app.student_profiles sp on sp.id=e.student_profile_id join app.persons p on p.id=sp.person_id
        join app.cohorts c on c.id=e.cohort_id where e.workspace_id=${this.actor.workspaceId}::uuid order by p.display_name`,
    ]);
    return {
      actor_role: this.actor.role,
      content,
      assignments,
      exams,
      enrollments,
    };
  }

  publishContent(contentId: unknown, idempotencyKey: unknown) {
    canOperate(this.actor);
    const target = parse(id, contentId);
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P4_PUBLISH_CONTENT",
      key: stableKey,
      payload: { target },
      work: async () => {
        const rows = await this.tx<
          { id: string }[]
        >`update app.content_items set published_at=coalesce(published_at,clock_timestamp()),row_version=row_version+1 where id=${target}::uuid returning id`;
        if (!rows[0]) throw new AppError("NOT_FOUND");
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "CONTENT_PUBLISHED",
          "content_item",
          target,
        );
        return { id: target };
      },
    });
  }

  submitAssignment(
    definitionId: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    const definition = parse(id, definitionId),
      body = parse(
        z
          .object({
            enrollment_id: id,
            answer: z.string().trim().min(1).max(10000),
            row_version: z.number().int().positive().nullable().default(null),
            reason: z.string().trim().min(3).max(500).nullable().default(null),
          })
          .strict(),
        value,
      );
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P4_SUBMIT_ASSIGNMENT",
      key: stableKey,
      payload: { definition, ...body },
      work: async () => {
        const current = await this.tx<
          { id: string; row_version: unknown }[]
        >`select id,row_version from app.assignment_submissions where enrollment_id=${body.enrollment_id}::uuid and assignment_definition_id=${definition}::uuid for update`;
        const resourceId = current[0]?.id ?? randomUUID();
        if (current[0]) {
          if (
            body.row_version !== number(current[0].row_version) ||
            !body.reason
          )
            throw new AppError("VERSION_CONFLICT");
          await this
            .tx`select set_config('app.correction_reason',${body.reason ?? ""},true)`;
          const updated = await this.tx<
            { row_version: unknown; current_version: number }[]
          >`update app.assignment_submissions set answer=${body.answer},submitted_by_account_id=${this.actor.accountId}::uuid,submitted_at=clock_timestamp(),status='SUBMITTED',score=null,internal_notes=null,student_feedback=null,feedback_published_at=null,current_version=current_version+1,row_version=row_version+1,updated_at=clock_timestamp() where id=${resourceId}::uuid and row_version=${body.row_version} returning row_version,current_version`;
          if (!updated[0]) throw new AppError("VERSION_CONFLICT");
          await audit(
            this.tx,
            this.actor,
            this.requestId,
            "ASSIGNMENT_SUBMISSION_CORRECTED",
            "assignment_submission",
            resourceId,
          );
          return {
            id: resourceId,
            version: updated[0].current_version,
            row_version: number(updated[0].row_version),
          };
        }
        if (body.row_version !== null) throw new AppError("VERSION_CONFLICT");
        await this
          .tx`insert into app.assignment_submissions(id,workspace_id,enrollment_id,assignment_definition_id,answer,submitted_by_account_id) values(${resourceId}::uuid,${this.actor.workspaceId}::uuid,${body.enrollment_id}::uuid,${definition}::uuid,${body.answer},${this.actor.accountId}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "ASSIGNMENT_SUBMITTED",
          "assignment_submission",
          resourceId,
        );
        return { id: resourceId, version: 1, row_version: 1 };
      },
    });
  }

  reviewSubmission(
    submissionId: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    canOperate(this.actor);
    const target = parse(id, submissionId),
      body = parse(
        z
          .object({
            score: z.number().min(0),
            internal_notes: z
              .string()
              .trim()
              .max(5000)
              .nullable()
              .default(null),
            student_feedback: z
              .string()
              .trim()
              .max(5000)
              .nullable()
              .default(null),
            publish_feedback: z.boolean().default(false),
            row_version: z.number().int().positive(),
            reason: z.string().trim().min(3).max(500).nullable().default(null),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P4_REVIEW_ASSIGNMENT",
      key: stableKey,
      payload: { target, ...body },
      work: async () => {
        await this
          .tx`select set_config('app.correction_reason',${body.reason ?? ""},true)`;
        const rows = await this.tx<
          { row_version: unknown; current_version: number }[]
        >`update app.assignment_submissions s set status='REVIEWED',score=${body.score},internal_notes=${body.internal_notes},student_feedback=${body.student_feedback},feedback_published_at=case when ${body.publish_feedback} then clock_timestamp() else null end,current_version=s.current_version+1,row_version=s.row_version+1,updated_at=clock_timestamp() from app.assignment_definitions d where s.id=${target}::uuid and d.id=s.assignment_definition_id and ${body.score}<=d.max_score and s.row_version=${body.row_version} returning s.row_version,s.current_version`;
        if (!rows[0]) throw new AppError("VERSION_CONFLICT");
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "ASSIGNMENT_REVIEWED",
          "assignment_submission",
          target,
        );
        return {
          id: target,
          version: rows[0].current_version,
          row_version: number(rows[0].row_version),
        };
      },
    });
  }

  saveExamResult(
    examId: unknown,
    value: unknown,
    idempotencyKey: unknown,
    correction = false,
  ) {
    canOperate(this.actor);
    const exam = parse(id, examId),
      body = parse(
        z
          .object({
            enrollment_id: id,
            score: z.number().min(0),
            internal_notes: z
              .string()
              .trim()
              .max(5000)
              .nullable()
              .default(null),
            student_feedback: z
              .string()
              .trim()
              .max(5000)
              .nullable()
              .default(null),
            row_version: z.number().int().positive().nullable().default(null),
            reason: z.string().trim().min(3).max(500).nullable().default(null),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: correction ? "P4_CORRECT_EXAM" : "P4_SAVE_EXAM",
      key: stableKey,
      payload: { exam, ...body },
      work: async () => {
        const definition = await this.tx<
          { max_score: unknown }[]
        >`select max_score from app.exam_definitions where id=${exam}::uuid`;
        if (!definition[0]) throw new AppError("NOT_FOUND");
        if (body.score > number(definition[0].max_score))
          throw new AppError("VALIDATION_ERROR");
        const current = await this.tx<
          { id: string; row_version: unknown; status: string }[]
        >`select id,row_version,status from app.exam_results where enrollment_id=${body.enrollment_id}::uuid and exam_definition_id=${exam}::uuid for update`;
        if (current[0]) {
          if (
            body.row_version !== number(current[0].row_version) ||
            (current[0].status === "PUBLISHED" && !correction) ||
            !body.reason
          )
            throw new AppError(
              current[0].status === "PUBLISHED" && !correction
                ? "PERIOD_LOCKED"
                : "VERSION_CONFLICT",
            );
          await this
            .tx`select set_config('app.correction_reason',${body.reason ?? ""},true)`;
          const updated = await this.tx<
            { row_version: unknown; current_version: number }[]
          >`update app.exam_results set score=${body.score},internal_notes=${body.internal_notes},student_feedback=${body.student_feedback},status='DRAFT',published_at=null,recorded_by_account_id=${this.actor.accountId}::uuid,current_version=current_version+1,row_version=row_version+1,updated_at=clock_timestamp() where id=${current[0].id}::uuid and row_version=${body.row_version} returning row_version,current_version`;
          if (!updated[0]) throw new AppError("VERSION_CONFLICT");
          await audit(
            this.tx,
            this.actor,
            this.requestId,
            "EXAM_RESULT_CORRECTED",
            "exam_result",
            current[0].id,
          );
          return {
            id: current[0].id,
            version: updated[0].current_version,
            row_version: number(updated[0].row_version),
          };
        }
        if (correction || body.row_version !== null)
          throw new AppError("VERSION_CONFLICT");
        const resourceId = randomUUID();
        await this
          .tx`insert into app.exam_results(id,workspace_id,enrollment_id,exam_definition_id,score,internal_notes,student_feedback,recorded_by_account_id) values(${resourceId}::uuid,${this.actor.workspaceId}::uuid,${body.enrollment_id}::uuid,${exam}::uuid,${body.score},${body.internal_notes},${body.student_feedback},${this.actor.accountId}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "EXAM_RESULT_RECORDED",
          "exam_result",
          resourceId,
        );
        return { id: resourceId, version: 1, row_version: 1 };
      },
    });
  }

  publishExamResult(
    resultId: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    canOperate(this.actor);
    const target = parse(id, resultId),
      body = parse(
        z.object({ row_version: z.number().int().positive() }).strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P4_PUBLISH_EXAM",
      key: stableKey,
      payload: { target, ...body },
      work: async () => {
        const rows = await this.tx<
          { row_version: unknown; current_version: number }[]
        >`update app.exam_results set status='PUBLISHED',published_at=clock_timestamp(),current_version=current_version+1,row_version=row_version+1,updated_at=clock_timestamp() where id=${target}::uuid and status='DRAFT' and row_version=${body.row_version} returning row_version,current_version`;
        if (!rows[0]) throw new AppError("VERSION_CONFLICT");
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "EXAM_RESULT_PUBLISHED",
          "exam_result",
          target,
        );
        return {
          id: target,
          version: rows[0].current_version,
          row_version: number(rows[0].row_version),
        };
      },
    });
  }

  selfReview(weekId: unknown, value: unknown, idempotencyKey: unknown) {
    if (this.actor.role !== "STUDENT") throw new AppError("FORBIDDEN");
    const week = parse(id, weekId),
      body = parse(
        z
          .object({
            enrollment_id: id,
            rating: z.number().int().min(1).max(5),
            reflection: z.string().trim().min(3).max(5000),
            row_version: z.number().int().positive().nullable().default(null),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P4_SELF_REVIEW",
      key: stableKey,
      payload: { week, ...body },
      work: async () => {
        const current = await this.tx<
          { id: string; row_version: unknown }[]
        >`select id,row_version from app.student_self_reviews where enrollment_id=${body.enrollment_id}::uuid and plan_week_id=${week}::uuid for update`;
        if (current[0]) {
          if (body.row_version !== number(current[0].row_version))
            throw new AppError("VERSION_CONFLICT");
          const updated = await this.tx<
            { row_version: unknown; current_version: number }[]
          >`update app.student_self_reviews set rating=${body.rating},reflection=${body.reflection},current_version=current_version+1,row_version=row_version+1,updated_at=clock_timestamp() where id=${current[0].id}::uuid and row_version=${body.row_version} returning row_version,current_version`;
          if (!updated[0]) throw new AppError("VERSION_CONFLICT");
          return {
            id: current[0].id,
            version: updated[0].current_version,
            row_version: number(updated[0].row_version),
          };
        }
        if (body.row_version !== null) throw new AppError("VERSION_CONFLICT");
        const resourceId = randomUUID();
        await this
          .tx`insert into app.student_self_reviews(id,workspace_id,enrollment_id,plan_week_id,rating,reflection) values(${resourceId}::uuid,${this.actor.workspaceId}::uuid,${body.enrollment_id}::uuid,${week}::uuid,${body.rating},${body.reflection})`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "STUDENT_SELF_REVIEWED",
          "student_self_review",
          resourceId,
        );
        return { id: resourceId, version: 1, row_version: 1 };
      },
    });
  }

  private async resolve(studentId: string, weekId: string) {
    const rows = await this.tx<
      {
        enrollment_id: string;
        week_id: string;
        week_number: number;
        week_start: string;
        week_end: string;
        workspace_timezone: string;
      }[]
    >`select e.id enrollment_id,pw.id week_id,pw.week_number,(c.starts_on+(pw.week_number-1)*7)::text week_start,(c.starts_on+(pw.week_number-1)*7+6)::text week_end,w.timezone workspace_timezone from app.enrollments e join app.cohorts c on c.id=e.cohort_id join app.plan_weeks pw on pw.plan_id=c.current_plan_id join app.workspaces w on w.id=e.workspace_id where e.student_profile_id=${studentId}::uuid and pw.id=${weekId}::uuid`;
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return rows[0];
  }
  private async calculate(studentId: string, weekId: string) {
    const target = await this.resolve(studentId, weekId),
      enrollment = target.enrollment_id;
    const [session, tracking, assignment, exam, self] = await Promise.all([
      this.tx<
        { total: unknown; done: unknown }[]
      >`select count(*) total,count(*) filter(where a.status<>'NOT_RECORDED') done from app.session_roster sr join app.session_occurrences so on so.id=sr.session_occurrence_id join app.session_definitions sd on sd.id=so.session_definition_id left join app.attendance a on a.roster_id=sr.id where sr.enrollment_id=${enrollment}::uuid and sd.plan_week_id=${weekId}::uuid and sr.eligibility='EXPECTED'`,
      this.tx<
        { total: unknown; done: unknown; earned: unknown; possible: unknown }[]
      >`select count(*) total,count(te.id) done,coalesce(sum(case when te.id is not null and jsonb_typeof(te.value)='number' then least(1,greatest(0,(te.value#>>'{}')::numeric/nullif((td.target->>'min')::numeric,0)))*td.weight else 0 end),0) earned,coalesce(sum(td.weight),0) possible from app.tracking_definitions td join app.tracking_schedules ts on ts.tracking_definition_id=td.id left join app.tracking_entries te on te.tracking_definition_id=td.id and te.enrollment_id=${enrollment}::uuid and te.period_start between ${target.week_start}::date and ${target.week_end}::date where td.plan_id=(select plan_id from app.plan_weeks where id=${weekId}::uuid)`,
      this.tx<
        { total: unknown; done: unknown; earned: unknown; possible: unknown }[]
      >`select count(*) total,count(s.id) filter(where s.status='REVIEWED') done,coalesce(sum(case when s.status='REVIEWED' then s.score/ad.max_score*ad.weight else 0 end),0) earned,coalesce(sum(ad.weight),0) possible from app.assignment_definitions ad left join app.assignment_submissions s on s.assignment_definition_id=ad.id and s.enrollment_id=${enrollment}::uuid where ad.plan_week_id=${weekId}::uuid`,
      this.tx<
        { total: unknown; done: unknown; earned: unknown; possible: unknown }[]
      >`select count(*) total,count(r.id) filter(where r.status='PUBLISHED') done,coalesce(sum(case when r.status='PUBLISHED' then r.score/ed.max_score*ed.weight else 0 end),0) earned,coalesce(sum(ed.weight),0) possible from app.exam_definitions ed left join app.exam_results r on r.exam_definition_id=ed.id and r.enrollment_id=${enrollment}::uuid where ed.plan_week_id=${weekId}::uuid`,
      this.tx<
        { total: unknown; done: unknown }[]
      >`select 1 total,count(*) done from app.student_self_reviews where enrollment_id=${enrollment}::uuid and plan_week_id=${weekId}::uuid`,
    ]);
    const components = {
      sessions: {
        expected: number(session[0].total),
        completed: number(session[0].done),
      },
      tracking: {
        expected: number(tracking[0].total),
        completed: number(tracking[0].done),
      },
      assignments: {
        expected: number(assignment[0].total),
        completed: number(assignment[0].done),
      },
      exams: {
        expected: number(exam[0].total),
        completed: number(exam[0].done),
      },
      self_review: { expected: 1, completed: number(self[0].done) },
    };
    const expected = Object.values(components).reduce(
        (s, x) => s + x.expected,
        0,
      ),
      completed = Object.values(components).reduce(
        (s, x) => s + x.completed,
        0,
      ),
      possible =
        number(tracking[0].possible) +
        number(assignment[0].possible) +
        number(exam[0].possible),
      earned =
        number(tracking[0].earned) +
        number(assignment[0].earned) +
        number(exam[0].earned);
    return {
      ...target,
      coverage: expected ? completed / expected : 0,
      score: possible ? (earned / possible) * 100 : null,
      evidence: { expected, completed, components },
      rule_snapshot: {
        version: 1,
        missing_is_zero: false,
        weights: "copied-definition",
      },
    };
  }
  async week(studentIdValue: unknown, weekIdValue: unknown) {
    const student = parse(id, studentIdValue),
      week = parse(id, weekIdValue),
      calculated = await this.calculate(student, week);
    const current = await this
      .tx`select id,status,coverage,score,evidence,rule_snapshot,current_revision,row_version from app.student_week_summaries where enrollment_id=${calculated.enrollment_id}::uuid and plan_week_id=${week}::uuid`;
    return { student_id: student, ...calculated, summary: current[0] ?? null };
  }
  finalizeWeek(
    studentIdValue: unknown,
    weekIdValue: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    canOperate(this.actor);
    const student = parse(id, studentIdValue),
      week = parse(id, weekIdValue),
      body = parse(
        z
          .object({
            reason: z.string().trim().min(3).max(500).nullable().default(null),
            row_version: z.number().int().positive().nullable().default(null),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P4_FINALIZE_WEEK",
      key: stableKey,
      payload: { student, week, ...body },
      work: async () => {
        const calculated = await this.calculate(student, week);
        const boundaryRows = await this.tx<
          { week_closed: boolean }[]
        >`select app.week_closed_in_timezone(${calculated.week_end}::date,${calculated.workspace_timezone}::text) as week_closed`;
        const weekClosed = boundaryRows[0]?.week_closed === true;
        if (calculated.coverage < 1 && !weekClosed)
          throw new AppError("INCOMPLETE_WEEK");
        const current = await this.tx<
          {
            id: string;
            row_version: unknown;
            current_revision: number;
            status: string;
          }[]
        >`select id,row_version,current_revision,status from app.student_week_summaries where enrollment_id=${calculated.enrollment_id}::uuid and plan_week_id=${week}::uuid for update`;
        const summaryId = current[0]?.id ?? randomUUID();
        if (!current[0]) {
          await this
            .tx`insert into app.student_week_summaries(id,workspace_id,enrollment_id,plan_week_id,status,coverage,score,evidence,rule_snapshot)
            values(${summaryId}::uuid,${this.actor.workspaceId}::uuid,${calculated.enrollment_id}::uuid,${week}::uuid,'FINALIZED',${calculated.coverage},${calculated.score},${this.tx.json(calculated.evidence)},${this.tx.json(calculated.rule_snapshot)})`;
          await this
            .tx`update app.student_week_summaries set row_version=row_version+1,updated_at=clock_timestamp() where id=${summaryId}::uuid`;
        } else {
          if (
            body.row_version !== null &&
            body.row_version !== number(current[0].row_version)
          )
            throw new AppError("VERSION_CONFLICT");
          await this
            .tx`update app.student_week_summaries set status='FINALIZED',coverage=${calculated.coverage},score=${calculated.score},
            evidence=${this.tx.json(calculated.evidence)},rule_snapshot=${this.tx.json(calculated.rule_snapshot)},
            row_version=row_version+1,updated_at=clock_timestamp() where id=${summaryId}::uuid`;
        }
        const revision = (current[0]?.current_revision ?? 0) + 1;
        const snapshot = {
          coverage: calculated.coverage,
          score: calculated.score,
          evidence: calculated.evidence,
          rules: calculated.rule_snapshot,
        };
        await this
          .tx`insert into app.student_week_approval_revisions(workspace_id,summary_id,approval_revision,snapshot,approved_by_account_id,reason,request_id) values(${this.actor.workspaceId}::uuid,${summaryId}::uuid,${revision},${this.tx.json(snapshot)},${this.actor.accountId}::uuid,${body.reason},${this.requestId}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          current[0] ? "STUDENT_WEEK_AMENDED" : "STUDENT_WEEK_FINALIZED",
          "student_week_summary",
          summaryId,
        );
        const updated = await this.tx<
          { row_version: unknown }[]
        >`select row_version from app.student_week_summaries where id=${summaryId}::uuid`;
        return {
          id: summaryId,
          revision,
          status: "FINALIZED",
          coverage: calculated.coverage,
          score: calculated.score,
          row_version: number(updated[0].row_version),
        };
      },
    });
  }
  amendWeek(
    studentIdValue: unknown,
    weekIdValue: unknown,
    value: unknown,
    idempotencyKey: unknown,
  ) {
    canOperate(this.actor);
    const student = parse(id, studentIdValue),
      week = parse(id, weekIdValue),
      body = parse(
        z
          .object({
            row_version: z.number().int().positive(),
            reason: z.string().trim().min(3).max(500),
          })
          .strict(),
        value,
      ),
      stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "P4_AMEND_WEEK",
      key: stableKey,
      payload: { student, week, ...body },
      work: async () => {
        const current = await this.tx<
          {
            id: string;
            row_version: unknown;
            current_revision: number;
            status: string;
          }[]
        >`select id,row_version,current_revision,status from app.student_week_summaries where enrollment_id=(select e.id from app.enrollments e join app.student_profiles sp on sp.id=e.student_profile_id where sp.id=${student}::uuid) and plan_week_id=${week}::uuid for update`;
        const item = current[0];
        if (!item || item.status !== "FINALIZED")
          throw new AppError("INVALID_STATE_TRANSITION");
        if (body.row_version !== number(item.row_version))
          throw new AppError("VERSION_CONFLICT");
        const calculated = await this.calculate(student, week);
        const summaryId = item.id,
          revision = item.current_revision + 1;
        if (calculated.coverage < 1) {
          await this
            .tx`update app.student_week_summaries set status='OPEN',coverage=${calculated.coverage},score=${calculated.score},evidence=${this.tx.json(calculated.evidence)},rule_snapshot=${this.tx.json(calculated.rule_snapshot)},current_revision=${revision},row_version=row_version+1,updated_at=clock_timestamp() where id=${summaryId}::uuid`;
        } else {
          await this
            .tx`update app.student_week_summaries set status='FINALIZED',coverage=${calculated.coverage},score=${calculated.score},evidence=${this.tx.json(calculated.evidence)},rule_snapshot=${this.tx.json(calculated.rule_snapshot)},current_revision=${revision},row_version=row_version+1,updated_at=clock_timestamp() where id=${summaryId}::uuid`;
        }
        const snapshot = {
          coverage: calculated.coverage,
          score: calculated.score,
          evidence: calculated.evidence,
          rules: calculated.rule_snapshot,
        };
        await this
          .tx`insert into app.student_week_approval_revisions(workspace_id,summary_id,approval_revision,snapshot,approved_by_account_id,reason,request_id) values(${this.actor.workspaceId}::uuid,${summaryId}::uuid,${revision},${this.tx.json(snapshot)},${this.actor.accountId}::uuid,${body.reason},${this.requestId}::uuid)`;
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "STUDENT_WEEK_AMENDED",
          "student_week_summary",
          summaryId,
        );
        return {
          id: summaryId,
          revision,
          status: calculated.coverage < 1 ? "OPEN" : "FINALIZED",
          coverage: calculated.coverage,
          score: calculated.score,
          row_version: number(item.row_version) + 1,
        };
      },
    });
  }
}
