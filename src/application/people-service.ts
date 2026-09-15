import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import { normalizeUsername } from "../domain/username";
import type { RequestActor } from "../server/authenticated-db";
import { audit, idempotent } from "./p1-program-service";

const key = z.string().min(1).max(128);
const personInput = z
  .object({
    display_name: z.string().trim().min(2).max(160),
    contact_phone: z.string().trim().min(6).max(30).nullable().default(null),
    group_id: z.uuid().nullable().default(null),
  })
  .strict();
const accountInput = personInput
  .extend({
    role: z.enum(["MENTOR", "STUDENT"]),
    login_name: z.string().min(3).max(64),
  })
  .strict();

function responsible(actor: RequestActor) {
  if (actor.role !== "RESPONSIBLE") throw new AppError("FORBIDDEN");
}
function staff(actor: RequestActor) {
  if (actor.role === "STUDENT") throw new AppError("FORBIDDEN");
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR");
  return result.data;
}

export class PeopleService {
  constructor(
    private readonly tx: postgres.TransactionSql,
    private readonly actor: RequestActor,
    private readonly requestId: string,
  ) {}

  async list() {
    staff(this.actor);
    const people = await this.tx`
      select p.id person_id,p.display_name,p.contact_phone,
        sp.id student_profile_id,la.id account_id,la.normalized_login_name login_name,
        la.role,la.status,la.row_version::int row_version,
        e.id enrollment_id,e.cohort_id,g.id group_id,g.name group_name,c.name cohort_name
      from app.persons p
      left join app.student_profiles sp on sp.person_id=p.id
      left join app.login_accounts la on la.person_id=p.id
      left join app.enrollments e on e.student_profile_id=sp.id and e.effective_to is null
      left join app.group_memberships gm on gm.enrollment_id=e.id and gm.effective_to is null
      left join app.groups g on g.id=gm.group_id
      left join app.cohorts c on c.id=e.cohort_id
      where p.workspace_id=${this.actor.workspaceId}::uuid and p.archived_at is null
        and (sp.id is not null or la.role='MENTOR')
        and (${this.actor.role}='RESPONSIBLE' or (sp.id is not null and app.actor_can_read_person(p.workspace_id,p.id)))
      order by case when la.role='MENTOR' then 0 else 1 end,p.display_name,p.id`;
    const groups = await this.tx`
      select g.id,g.name,g.cohort_id,c.name cohort_name
      from app.groups g join app.cohorts c on c.id=g.cohort_id
      where g.workspace_id=${this.actor.workspaceId}::uuid and g.status='ACTIVE'
        and (${this.actor.role}='RESPONSIBLE' or app.actor_can_read_group(g.workspace_id,g.id))
      order by c.name,g.name`;
    return {
      students: people.filter((person) => person.student_profile_id),
      mentors:
        this.actor.role === "RESPONSIBLE"
          ? people.filter((person) => person.role === "MENTOR")
          : [],
      groups,
    };
  }

  createStudent(value: unknown, idempotencyKey: unknown) {
    staff(this.actor);
    const body = parse(personInput, value);
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "PEOPLE_CREATE_STUDENT",
      key: stableKey,
      payload: body,
      work: async () => {
        let group: { id: string; cohort_id: string } | undefined;
        if (body.group_id) {
          const rows = await this.tx<{ id: string; cohort_id: string }[]>`
            select id,cohort_id from app.groups where id=${body.group_id}::uuid
              and workspace_id=${this.actor.workspaceId}::uuid and status='ACTIVE'
              and (${this.actor.role}='RESPONSIBLE' or app.actor_can_read_group(workspace_id,id))`;
          group = rows[0];
          if (!group) throw new AppError("FORBIDDEN");
        } else if (this.actor.role === "MENTOR")
          throw new AppError("VALIDATION_ERROR");
        const personId = randomUUID();
        const profileId = randomUUID();
        await this
          .tx`insert into app.persons(id,workspace_id,display_name,contact_phone)
          values(${personId}::uuid,${this.actor.workspaceId}::uuid,${body.display_name},${body.contact_phone})`;
        await this
          .tx`insert into app.student_profiles(id,workspace_id,person_id)
          values(${profileId}::uuid,${this.actor.workspaceId}::uuid,${personId}::uuid)`;
        let enrollmentId: string | null = null;
        if (group) {
          enrollmentId = randomUUID();
          await this
            .tx`insert into app.enrollments(id,workspace_id,student_profile_id,cohort_id,effective_from)
            values(${enrollmentId}::uuid,${this.actor.workspaceId}::uuid,${profileId}::uuid,${group.cohort_id}::uuid,clock_timestamp())`;
          await this
            .tx`insert into app.group_memberships(workspace_id,enrollment_id,group_id,effective_from)
            values(${this.actor.workspaceId}::uuid,${enrollmentId}::uuid,${group.id}::uuid,clock_timestamp())`;
        }
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "STUDENT_CREATED",
          "student_profile",
          profileId,
        );
        return {
          id: personId,
          person_id: personId,
          student_profile_id: profileId,
          enrollment_id: enrollmentId,
        };
      },
    });
  }

  reserveAccount(value: unknown, idempotencyKey: unknown) {
    responsible(this.actor);
    const body = parse(accountInput, value);
    const loginName = normalizeUsername(body.login_name);
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "PEOPLE_RESERVE_ACCOUNT",
      key: stableKey,
      payload: { ...body, login_name: loginName },
      work: async () => {
        const existing = await this.tx<
          {
            account_id: string;
            person_id: string;
            student_profile_id: string | null;
            role: string;
          }[]
        >`select la.id account_id,la.person_id,sp.id student_profile_id,la.role
          from app.login_accounts la left join app.student_profiles sp on sp.person_id=la.person_id
          where la.normalized_login_name=${loginName} for update of la`;
        if (existing[0]) {
          if (existing[0].role !== body.role)
            throw new AppError("INVALID_STATE_TRANSITION");
          return {
            id: existing[0].account_id,
            account_id: existing[0].account_id,
            person_id: existing[0].person_id,
            student_profile_id: existing[0].student_profile_id,
          };
        }
        const personId = randomUUID();
        const accountId = randomUUID();
        await this
          .tx`insert into app.persons(id,workspace_id,display_name,contact_phone)
          values(${personId}::uuid,${this.actor.workspaceId}::uuid,${body.display_name},${body.contact_phone})`;
        let profileId: string | null = null;
        if (body.role === "STUDENT") {
          profileId = randomUUID();
          await this
            .tx`insert into app.student_profiles(id,workspace_id,person_id)
            values(${profileId}::uuid,${this.actor.workspaceId}::uuid,${personId}::uuid)`;
        }
        await this
          .tx`insert into app.login_accounts(id,workspace_id,person_id,normalized_login_name,role,status,must_change_password)
          values(${accountId}::uuid,${this.actor.workspaceId}::uuid,${personId}::uuid,${loginName},${body.role}::app.account_role,'PROVISIONING',true)`;
        if (body.role === "MENTOR" && body.group_id) {
          const group = await this.tx<{ id: string }[]>`
            select id from app.groups where id=${body.group_id}::uuid and workspace_id=${this.actor.workspaceId}::uuid and status='ACTIVE'`;
          if (!group[0]) throw new AppError("VALIDATION_ERROR");
          await this
            .tx`insert into app.mentor_assignments(workspace_id,group_id,mentor_person_id,effective_from)
            values(${this.actor.workspaceId}::uuid,${body.group_id}::uuid,${personId}::uuid,clock_timestamp())`;
        }
        await audit(
          this.tx,
          this.actor,
          this.requestId,
          "ACCOUNT_PROVISIONING_RESERVED",
          "login_account",
          accountId,
        );
        return {
          id: accountId,
          account_id: accountId,
          person_id: personId,
          student_profile_id: profileId,
        };
      },
    });
  }

  async accountState(accountId: string) {
    responsible(this.actor);
    const rows = await this.tx<
      { status: string; auth_user_id: string | null }[]
    >`
      select status,supabase_auth_user_id auth_user_id from app.login_accounts
      where id=${accountId}::uuid and workspace_id=${this.actor.workspaceId}::uuid`;
    if (!rows[0]) throw new AppError("NOT_FOUND");
    return rows[0];
  }

  async activateAccount(
    accountId: string,
    authUserId: string,
    mustChangePassword = true,
  ) {
    responsible(this.actor);
    const rows = await this.tx<{ id: string }[]>`
      update app.login_accounts set supabase_auth_user_id=${authUserId}::uuid,status='ACTIVE',
        must_change_password=${mustChangePassword},temporary_password_expires_at=case when ${mustChangePassword} then clock_timestamp()+interval '24 hours' else null end,
        updated_at=clock_timestamp(),row_version=row_version+1
      where id=${accountId}::uuid and workspace_id=${this.actor.workspaceId}::uuid
        and status='PROVISIONING' and (supabase_auth_user_id is null or supabase_auth_user_id=${authUserId}::uuid)
      returning id`;
    if (!rows[0]) {
      const state = await this.accountState(accountId);
      if (state.status !== "ACTIVE" || state.auth_user_id !== authUserId)
        throw new AppError("INVALID_STATE_TRANSITION");
    }
    await audit(
      this.tx,
      this.actor,
      this.requestId,
      "ACCOUNT_ACTIVATED",
      "login_account",
      accountId,
    );
    return { id: accountId };
  }
}

export const peopleRequest = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("STUDENT_WITHOUT_ACCOUNT"),
      ...personInput.shape,
    })
    .strict(),
  z
    .object({
      mode: z.literal("ACCOUNT"),
      ...accountInput.shape,
      temporary_password: z.string().min(8).max(72),
      must_change_password: z.boolean().default(true),
    })
    .strict(),
]);
