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
    const rows = await this.tx<
      {
        sessions: number;
        tracking: number;
        assignments: number;
        attentions: number;
        actions: number;
      }[]
    >`select
      (select count(*)::int from app.session_occurrences where starts_at::date=(clock_timestamp() at time zone 'Africa/Cairo')::date and status<>'CANCELLED') sessions,
      (select count(*)::int from app.tracking_entries where period_start<=(clock_timestamp() at time zone 'Africa/Cairo')::date and period_end>=(clock_timestamp() at time zone 'Africa/Cairo')::date) tracking,
      (select count(*)::int from app.assignment_definitions ad join app.plan_weeks pw on pw.id=ad.plan_week_id join app.program_plans pp on pp.id=pw.plan_id where pp.status='PUBLISHED') assignments,
      (select count(*)::int from app.attentions where status in ('OPEN','IN_PROGRESS','SNOOZED')) attentions,
      (select count(*)::int from app.actions where status in ('OPEN','IN_PROGRESS','DONE_PENDING_VERIFICATION')) actions`;
    const counts = rows[0];
    return {
      role: this.actor.role,
      date: new Date().toISOString().slice(0, 10),
      counts: {
        sessions: counts?.sessions ?? 0,
        tracking: counts?.tracking ?? 0,
        assignments: counts?.assignments ?? 0,
        attentions:
          this.actor.role === "STUDENT" ? undefined : (counts?.attentions ?? 0),
        actions:
          this.actor.role === "STUDENT" ? undefined : (counts?.actions ?? 0),
      },
    };
  }

  async program() {
    const rows = await this.tx<
      { cohorts: unknown[]; groups: unknown[]; weeks: unknown[] }[]
    >`select
      coalesce((select jsonb_agg(to_jsonb(c) order by c.name,c.id) from (select c.id,c.name,c.status from app.cohorts c where c.workspace_id=${this.actor.workspaceId}::uuid) c),'[]'::jsonb) cohorts,
      coalesce((select jsonb_agg(to_jsonb(g) order by g.cohort_name,g.name,g.id) from (select g.id,g.name,c.name cohort_name from app.groups g join app.cohorts c on c.id=g.cohort_id and c.workspace_id=g.workspace_id where g.workspace_id=${this.actor.workspaceId}::uuid) g),'[]'::jsonb) groups,
      coalesce((select jsonb_agg(to_jsonb(w) order by w.week_number,w.id) from (select pw.id,pw.week_number,pw.title from app.plan_weeks pw join app.program_plans pp on pp.id=pw.plan_id and pp.workspace_id=pw.workspace_id where pw.workspace_id=${this.actor.workspaceId}::uuid and pp.status='PUBLISHED') w),'[]'::jsonb) weeks`;
    return { role: this.actor.role, ...(rows[0] ?? {}) };
  }

  async progress() {
    if (this.actor.role === "STUDENT") {
      const rows = await this.tx<
        { recorded: number; published: number; weeks: unknown[] }[]
      >`select
        (select count(*)::int from app.tracking_entries) recorded,
        (select count(*)::int from app.exam_results where status='PUBLISHED') published,
        coalesce((select jsonb_agg(jsonb_build_object('coverage',w.coverage,'score',w.score,'status',w.status) order by w.updated_at desc,w.id) from (select id,coverage::float8 coverage,score::float8 score,status,updated_at from app.student_week_summaries order by updated_at desc,id limit 12) w),'[]'::jsonb) weeks`;
      const row = rows[0];
      return {
        role: this.actor.role,
        tracking_recorded: row?.recorded ?? 0,
        published_exams: row?.published ?? 0,
        weeks: row?.weeks ?? [],
      };
    }
    const rows = await this.tx<
      { closed: number; open_actions: number; reviewed: number }[]
    >`select
      (select count(*)::int from app.session_occurrences where status='CLOSED') closed,
      (select count(*)::int from app.actions where status in ('OPEN','IN_PROGRESS','DONE_PENDING_VERIFICATION')) open_actions,
      (select count(*)::int from app.tracking_reviews) reviewed`;
    const row = rows[0];
    return {
      role: this.actor.role,
      sessions_closed: row?.closed ?? 0,
      actions_open: row?.open_actions ?? 0,
      entries_reviewed: row?.reviewed ?? 0,
    };
  }
}
