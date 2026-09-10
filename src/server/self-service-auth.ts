import "server-only";
import { createClient } from "@supabase/supabase-js";
import type postgres from "postgres";
import { z } from "zod";
import { AppError } from "../domain/errors";
import { runtimeSql } from "./db";
import { authEnvironment } from "./env";
import { readSessionCookies } from "./session-cookies";

const changeSchema = z
  .object({
    current_password: z.string().min(1).max(1024),
    new_password: z.string().min(8).max(128),
  })
  .strict()
  .refine((value) => value.current_password !== value.new_password);

async function limited<T>(work: (tx: postgres.TransactionSql) => Promise<T>) {
  return runtimeSql().begin(async (tx) => {
    await tx.unsafe("set local role tarbiyah_runtime");
    return work(tx);
  }) as Promise<T>;
}

function identity(request: Request) {
  const env = authEnvironment(process.env),
    hosted = env.APP_ENV === "staging" || env.APP_ENV === "production",
    tokens = readSessionCookies(request, hosted);
  if (!tokens.accessToken) throw new AppError("UNAUTHENTICATED");
  return { env, hosted, tokens };
}

export async function changeOwnPassword(
  request: Request,
  raw: unknown,
  requestId: string,
) {
  const parsed = changeSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR");
  const { env, tokens } = identity(request),
    verifier = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    claimsResult = await verifier.auth.getClaims(tokens.accessToken!);
  const userId = claimsResult.data?.claims?.sub,
    sessionId = claimsResult.data?.claims?.session_id;
  if (
    claimsResult.error ||
    typeof userId !== "string" ||
    typeof sessionId !== "string"
  )
    throw new AppError("UNAUTHENTICATED");
  const targets = await limited(
    (tx) =>
      tx<
        { account_id: string }[]
      >`select account_id from app.password_change_target(${sessionId}::uuid,${userId}::uuid)`,
  );
  const accountId = targets[0]?.account_id;
  if (!accountId) throw new AppError("UNAUTHENTICATED");
  const email = `${accountId.toLowerCase()}@${env.AUTH_INTERNAL_EMAIL_DOMAIN.toLowerCase()}`;
  const signed = await verifier.auth.signInWithPassword({
    email,
    password: parsed.data.current_password,
  });
  if (signed.error || !signed.data.session)
    throw new AppError("INVALID_CREDENTIALS");
  const updated = await verifier.auth.updateUser({
    password: parsed.data.new_password,
  });
  if (updated.error) throw new AppError("VALIDATION_ERROR");
  await limited(
    (tx) =>
      tx`select app.complete_own_password_change(${accountId}::uuid,${sessionId}::uuid,${userId}::uuid,${requestId}::uuid)`,
  );
  return { next: "LOGIN" as const };
}

export async function endProviderSession(request: Request) {
  const { env, tokens } = identity(request);
  if (!tokens.refreshToken) return;
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await client.auth.setSession({
    access_token: tokens.accessToken!,
    refresh_token: tokens.refreshToken,
  });
  if (!session.error) await client.auth.signOut({ scope: "local" });
}
