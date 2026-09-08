import { createHmac } from "node:crypto";
import { AppError } from "../domain/errors";
import { normalizeUsername } from "../domain/username";

export interface LoginAccountView {
  id: string;
  authUserId: string | null;
  status: "PROVISIONING" | "ACTIVE" | "CREDENTIAL_UPDATE" | "DISABLED";
}

export interface LoginAccountLookup {
  byNormalizedLoginName(name: string): Promise<LoginAccountView | null>;
}

export interface LoginRateLimiter {
  reserve(
    bucketHash: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export interface PasswordAuthGateway {
  signIn(input: { email: string; password: string }): Promise<{
    accessToken: string;
    refreshToken: string;
  }>;
}

export interface AcceptedSession {
  accountId: string;
  mustChangePassword: boolean;
}

export interface SessionAcceptance {
  /** Real implementation is gated by the approved Supabase original-session spike. */
  accept(
    accessToken: string,
    expectedAccountId: string,
  ): Promise<AcceptedSession>;
}

export function rateBucket(
  secret: string,
  kind: "login-name" | "network",
  value: string,
) {
  if (Buffer.byteLength(secret) < 32 || !value)
    throw new Error("Invalid rate-limit input");
  return createHmac("sha256", secret).update(`${kind}\0${value}`).digest("hex");
}

function technicalEmail(accountId: string, domain: string) {
  if (
    !/^[0-9a-f-]{36}$/i.test(accountId) ||
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
  ) {
    throw new Error("Invalid internal identity configuration");
  }
  return `${accountId.toLowerCase()}@${domain.toLowerCase()}`;
}

export class UsernamePasswordLogin {
  constructor(
    private readonly accounts: LoginAccountLookup,
    private readonly limiter: LoginRateLimiter,
    private readonly auth: PasswordAuthGateway,
    private readonly sessions: SessionAcceptance,
    private readonly internalDomain: string,
    private readonly rateSecret: string,
  ) {}

  async execute(input: {
    loginName: unknown;
    password: unknown;
    networkKey: string;
  }) {
    let normalized: string;
    try {
      normalized = normalizeUsername(input.loginName);
    } catch {
      // Invalid syntax is indistinguishable from an unknown login at this public boundary.
      throw new AppError("INVALID_CREDENTIALS");
    }
    if (
      typeof input.password !== "string" ||
      input.password.length < 1 ||
      input.password.length > 1024
    ) {
      throw new AppError("INVALID_CREDENTIALS");
    }
    const [nameLimit, networkLimit] = await Promise.all([
      this.limiter.reserve(
        rateBucket(this.rateSecret, "login-name", normalized),
      ),
      this.limiter.reserve(
        rateBucket(this.rateSecret, "network", input.networkKey),
      ),
    ]);
    if (!nameLimit.allowed || !networkLimit.allowed)
      throw new AppError("RATE_LIMITED");

    const account = await this.accounts.byNormalizedLoginName(normalized);
    if (!account?.authUserId || account.status !== "ACTIVE")
      throw new AppError("INVALID_CREDENTIALS");
    let provider: { accessToken: string; refreshToken: string };
    try {
      provider = await this.auth.signIn({
        email: technicalEmail(account.id, this.internalDomain),
        password: input.password,
      });
    } catch {
      throw new AppError("INVALID_CREDENTIALS");
    }
    try {
      const accepted = await this.sessions.accept(
        provider.accessToken,
        account.id,
      );
      if (accepted.accountId !== account.id)
        throw new AppError("UNAUTHENTICATED");
      return {
        accessToken: provider.accessToken,
        refreshToken: provider.refreshToken,
        next: accepted.mustChangePassword
          ? ("CHANGE_PASSWORD" as const)
          : ("APP" as const),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("UNAUTHENTICATED");
    }
  }
}
