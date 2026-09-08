import { createClient } from "@supabase/supabase-js";
import type postgres from "postgres";
import {
  UsernamePasswordLogin,
  type LoginAccountLookup,
  type LoginRateLimiter,
  type PasswordAuthGateway,
  type SessionAcceptance,
} from "../application/login-adapter";
import { AppError } from "../domain/errors";
import { authEnvironment } from "./env";
import { runtimeSql } from "./db";

async function runtimeTransaction<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return runtimeSql().begin(async (tx) => {
    await tx.unsafe("set local role tarbiyah_runtime");
    return work(tx);
  }) as Promise<T>;
}

const accounts: LoginAccountLookup = {
  async byNormalizedLoginName(name) {
    return runtimeTransaction(async (tx) => {
      const rows = await tx`select account_id from app.login_target(${name})`;
      const row = rows[0] as { account_id?: string } | undefined;
      return row?.account_id
        ? {
            id: row.account_id,
            authUserId: "provider-linked",
            status: "ACTIVE" as const,
          }
        : null;
    });
  },
};

const limiter: LoginRateLimiter = {
  async reserve(bucket) {
    return runtimeTransaction(async (tx) => {
      const rows =
        await tx`select allowed,retry_after_seconds from app.reserve_login_attempt(${bucket})`;
      const row = rows[0] as { allowed: boolean; retry_after_seconds: number };
      return {
        allowed: row.allowed,
        retryAfterSeconds: row.retry_after_seconds,
      };
    });
  },
};

export function loginService() {
  const env = authEnvironment(process.env);
  const supabase = createClient(
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
  const provider: PasswordAuthGateway = {
    async signIn({ email, password }) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.session) throw new AppError("INVALID_CREDENTIALS");
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      };
    },
  };
  const sessions: SessionAcceptance = {
    async accept(accessToken, expectedAccountId) {
      const { data, error } = await supabase.auth.getClaims(accessToken);
      const claims = data?.claims as Record<string, unknown> | undefined;
      const userId = typeof claims?.sub === "string" ? claims.sub : null;
      const sessionId =
        typeof claims?.session_id === "string" ? claims.session_id : null;
      if (error || !userId || !sessionId) throw new AppError("UNAUTHENTICATED");
      return runtimeTransaction(async (tx) => {
        const rows =
          await tx`select account_id,must_change_password from app.accept_login_session(${expectedAccountId}::uuid,${sessionId}::uuid,${userId}::uuid)`;
        const row = rows[0] as
          { account_id?: string; must_change_password?: boolean } | undefined;
        if (!row?.account_id) throw new AppError("UNAUTHENTICATED");
        return {
          accountId: row.account_id,
          mustChangePassword: !!row.must_change_password,
        };
      });
    },
  };
  return new UsernamePasswordLogin(
    accounts,
    limiter,
    provider,
    sessions,
    env.AUTH_INTERNAL_EMAIL_DOMAIN,
    env.AUTH_RATE_LIMIT_SECRET,
  );
}
