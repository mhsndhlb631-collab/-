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
    responsible(this.actor);
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
      order by case when la.role='MENTOR' then 0 else 1 end,p.display_name,p.id`;
    return {
      students: people.filter((person) => person.student_profile_id),
      mentors: people.filter((person) => person.role === "MENTOR"),
    };
  }

  createStudent(value: unknown, idempotencyKey: unknown) {
    responsible(this.actor);
    const body = parse(personInput, value);
    const stableKey = parse(key, idempotencyKey);
    return idempotent({
      tx: this.tx,
      actor: this.actor,
      command: "PEOPLE_CREATE_STUDENT",
      key: stableKey,
      payload: body,
      work: async () => {
        const personId = randomUUID();
        const profileId = randomUUID();
        await this
          .tx`insert into app.persons(id,workspace_id,display_name,contact_phone)
          values(${personId}::uuid,${this.actor.workspaceId}::uuid,${body.display_name},${body.contact_phone})`;
        await this
          .tx`insert into app.student_profiles(id,workspace_id,person_id)
          values(${profileId}::uuid,${this.actor.workspaceId}::uuid,${personId}::uuid)`;
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
          where la.normalized_login_name=${loginName} for update`;
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

  async activateAccount(accountId: string, authUserId: string) {
    responsible(this.actor);
    const rows = await this.tx<{ id: string }[]>`
      update app.login_accounts set supabase_auth_user_id=${authUserId}::uuid,status='ACTIVE',
        must_change_password=true,temporary_password_expires_at=clock_timestamp()+interval '24 hours',
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
  z.object({ mode: z.literal("ACCOUNT"), ...accountInput.shape }).strict(),
]);
