import "server-only";
import { createClient } from "@supabase/supabase-js";
import type postgres from "postgres";
import { AppError } from "../domain/errors";
import { authEnvironment } from "./env";
import { runtimeSql } from "./db";

export interface RequestActor {
  accountId: string;
  workspaceId: string;
  personId: string;
  role: "RESPONSIBLE" | "MENTOR" | "STUDENT";
  sessionId: string;
}

function cookie(request: Request, name: string) {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name)
      return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

export async function withAuthenticatedTransaction<T>(
  request: Request,
  work: (tx: postgres.TransactionSql, actor: RequestActor) => Promise<T>,
) {
  const env = authEnvironment(process.env);
  const hosted = env.APP_ENV === "staging" || env.APP_ENV === "production";
  const accessToken = cookie(
    request,
    `${hosted ? "__Host-" : ""}tarbiyah-access`,
  );
  if (!accessToken) throw new AppError("UNAUTHENTICATED");
  const verifier = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await verifier.auth.getClaims(accessToken);
  const authUserId = data?.claims?.sub;
  const sessionId = data?.claims?.session_id;
  if (error || typeof authUserId !== "string" || typeof sessionId !== "string")
    throw new AppError("UNAUTHENTICATED");

  return runtimeSql().begin(async (tx) => {
    await tx.unsafe("set local role tarbiyah_runtime");
    const rows = await tx<
      {
        account_id: string;
        workspace_id: string;
        person_id: string;
        role: RequestActor["role"];
      }[]
    >`select * from app.resolve_session_actor(${sessionId}::uuid,${authUserId}::uuid)`;
    const row = rows[0];
    if (!row) throw new AppError("UNAUTHENTICATED");
    const authority = await tx<{ allowed: boolean }[]>`
      with request_context as materialized (
        select set_config('app.account_id',${row.account_id},true),
          set_config('app.session_id',${sessionId},true)
      )
      select app.actor_allows(${row.workspace_id}::uuid,NULL,true) as allowed
      from request_context`;
    if (row.role === "RESPONSIBLE" && !authority[0]?.allowed)
      throw new AppError("UNAUTHENTICATED");
    return work(tx, {
      accountId: row.account_id,
      workspaceId: row.workspace_id,
      personId: row.person_id,
      role: row.role,
      sessionId,
    });
  });
}
