import "server-only";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PeopleService, peopleRequest } from "../application/people-service";
import { AppError } from "../domain/errors";
import { withAuthenticatedTransaction } from "./authenticated-db";
import { authEnvironment } from "./env";
import { assertSameOrigin, endpoint } from "./http";

const adminEnvironment = z.object({ SUPABASE_SECRET_KEY: z.string().min(20) });

export function peopleQuery(request: Request) {
  return endpoint("auth", (requestId) =>
    withAuthenticatedTransaction(request, (tx, actor) =>
      new PeopleService(tx, actor, requestId).list(),
    ),
  );
}

export function peopleCommand(request: Request) {
  return endpoint("auth", async (requestId) => {
    const env = authEnvironment(process.env);
    assertSameOrigin(request, env.APP_ORIGIN);
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      throw new AppError("VALIDATION_ERROR");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("VALIDATION_ERROR");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AppError("VALIDATION_ERROR");
    }
    const parsed = peopleRequest.safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR");
    if (parsed.data.mode === "STUDENT_WITHOUT_ACCOUNT") {
      return withAuthenticatedTransaction(request, (tx, actor) =>
        new PeopleService(tx, actor, requestId).createStudent(
          {
            display_name: parsed.data.display_name,
            contact_phone: parsed.data.contact_phone,
          },
          idempotencyKey,
        ),
      );
    }
    const accountData = parsed.data;
    const reservation = await withAuthenticatedTransaction(
      request,
      (tx, actor) =>
        new PeopleService(tx, actor, requestId).reserveAccount(
          {
            display_name: accountData.display_name,
            contact_phone: accountData.contact_phone,
            login_name: accountData.login_name,
            role: accountData.role,
          },
          idempotencyKey,
        ),
    );
    const state = await withAuthenticatedTransaction(request, (tx, actor) =>
      new PeopleService(tx, actor, requestId).accountState(
        reservation.account_id,
      ),
    );
    if (state.status === "ACTIVE")
      return { ...reservation, temporary_password: null };

    const secret = adminEnvironment.safeParse(process.env);
    if (!secret.success) throw new AppError("DEPENDENCY_UNAVAILABLE");
    const admin = createClient(
      env.SUPABASE_URL,
      secret.data.SUPABASE_SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    const temporaryPassword = randomBytes(18).toString("base64url");
    const email = `${reservation.account_id.toLowerCase()}@${env.AUTH_INTERNAL_EMAIL_DOMAIN.toLowerCase()}`;
    let authUserId = state.auth_user_id;
    if (!authUserId) {
      const created = await admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        const listed = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const existing = listed.data?.users.find(
          (user) => user.email?.toLowerCase() === email,
        );
        if (!existing) throw new AppError("DEPENDENCY_UNAVAILABLE");
        authUserId = existing.id;
      } else authUserId = created.data.user.id;
    }
    const updated = await admin.auth.admin.updateUserById(authUserId, {
      password: temporaryPassword,
      email_confirm: true,
      ban_duration: "none",
    });
    if (updated.error) throw new AppError("DEPENDENCY_UNAVAILABLE");
    await withAuthenticatedTransaction(request, (tx, actor) =>
      new PeopleService(tx, actor, requestId).activateAccount(
        reservation.account_id,
        authUserId!,
      ),
    );
    return { ...reservation, temporary_password: temporaryPassword };
  });
}
