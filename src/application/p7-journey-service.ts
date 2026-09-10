import type postgres from "postgres";
import type { RequestActor } from "../server/authenticated-db";

export class P7JourneyService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
  ) {}

  async me() {
    const rows = await this.tx<
      {
        account_id: string;
        display_name: string;
        login_name: string;
        role: RequestActor["role"];
        workspace_name: string;
      }[]
    >`select a.id account_id,p.display_name,a.normalized_login_name login_name,a.role,w.name workspace_name
      from app.login_accounts a join app.persons p on p.id=a.person_id join app.workspaces w on w.id=a.workspace_id
      where a.id=${this.actor.accountId}::uuid`;
    return rows[0];
  }

  async today() {
    const [sessions, tracking, assignments, attentions, actions] =
      await Promise.all([
        this.tx<
          { count: number }[]
        >`select count(*)::int count from app.session_occurrences
          where starts_at::date=(clock_timestamp() at time zone 'Africa/Cairo')::date and status<>'CANCELLED'`,
        this.tx<
          { count: number }[]
        >`select count(*)::int count from app.tracking_entries
          where period_start<=(clock_timestamp() at time zone 'Africa/Cairo')::date
            and period_end>=(clock_timestamp() at time zone 'Africa/Cairo')::date`,
        this.tx<
          { count: number }[]
        >`select count(*)::int count from app.assignment_definitions ad
          join app.plan_weeks pw on pw.id=ad.plan_week_id
          join app.program_plans pp on pp.id=pw.plan_id
          where pp.status='PUBLISHED'`,
        this.tx<
          { count: number }[]
        >`select count(*)::int count from app.attentions where status in ('OPEN','IN_PROGRESS','SNOOZED')`,
        this.tx<
          { count: number }[]
        >`select count(*)::int count from app.actions where status in ('OPEN','IN_PROGRESS','DONE_PENDING_VERIFICATION')`,
      ]);
    return {
      role: this.actor.role,
      date: new Date().toISOString().slice(0, 10),
      counts: {
        sessions: sessions[0]?.count ?? 0,
        tracking: tracking[0]?.count ?? 0,
        assignments: assignments[0]?.count ?? 0,
        attentions:
          this.actor.role === "STUDENT"
            ? undefined
            : (attentions[0]?.count ?? 0),
        actions:
          this.actor.role === "STUDENT" ? undefined : (actions[0]?.count ?? 0),
      },
    };
  }

  async program() {
    const [cohorts, groups, weeks] = await Promise.all([
      this.tx<
        { id: string; name: string; status: string }[]
      >`select distinct c.id,c.name,c.status from app.cohorts c order by c.name,c.id`,
      this.tx<
        { id: string; name: string; cohort_name: string }[]
      >`select distinct g.id,g.name,c.name cohort_name from app.groups g join app.cohorts c on c.id=g.cohort_id order by c.name,g.name,g.id`,
      this.tx<
        { id: string; week_number: number; title: string }[]
      >`select distinct pw.id,pw.week_number,pw.title from app.plan_weeks pw join app.program_plans pp on pp.id=pw.plan_id where pp.status='PUBLISHED' order by pw.week_number,pw.id`,
    ]);
    return { role: this.actor.role, cohorts, groups, weeks };
  }

  async progress() {
    if (this.actor.role === "STUDENT") {
      const [tracking, weeks, exams] = await Promise.all([
        this.tx<
          { recorded: number }[]
        >`select count(*)::int recorded from app.tracking_entries`,
        this.tx<
          { coverage: number; score: number | null; status: string }[]
        >`select coverage::float8 coverage,score::float8 score,status from app.student_week_summaries order by updated_at desc,id limit 12`,
        this.tx<
          { published: number }[]
        >`select count(*)::int published from app.exam_results where status='PUBLISHED'`,
      ]);
      return {
        role: this.actor.role,
        tracking_recorded: tracking[0]?.recorded ?? 0,
        published_exams: exams[0]?.published ?? 0,
        weeks,
      };
    }
    const [closed, openActions, reviewed] = await Promise.all([
      this.tx<
        { count: number }[]
      >`select count(*)::int count from app.session_occurrences where status='CLOSED'`,
      this.tx<
        { count: number }[]
      >`select count(*)::int count from app.actions where status in ('OPEN','IN_PROGRESS','DONE_PENDING_VERIFICATION')`,
      this.tx<
        { count: number }[]
      >`select count(*)::int count from app.tracking_reviews`,
    ]);
    return {
      role: this.actor.role,
      sessions_closed: closed[0]?.count ?? 0,
      actions_open: openActions[0]?.count ?? 0,
      entries_reviewed: reviewed[0]?.count ?? 0,
    };
  }
}
