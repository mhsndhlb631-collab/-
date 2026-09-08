import { z } from "zod";
const base = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]),
  APP_ORIGIN: z.url(),
});
const database = z.object({
  DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//),
});
const auth = base.extend({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  AUTH_INTERNAL_EMAIL_DOMAIN: z.string().min(4),
  AUTH_RATE_LIMIT_SECRET: z.string().min(32),
});
export function parseEnvironment(env: Record<string, string | undefined>) {
  const value = base.parse(env);
  const origin = new URL(value.APP_ORIGIN);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Invalid application origin");
  if (
    ["staging", "production"].includes(value.APP_ENV) &&
    origin.protocol !== "https:"
  )
    throw new Error("Hosted origin requires HTTPS");
  if (!["http:", "https:"].includes(origin.protocol))
    throw new Error("Invalid application protocol");
  return value;
}
export function databaseUrl(env: Record<string, string | undefined>) {
  return database.parse(env).DATABASE_URL;
}
export function authEnvironment(env: Record<string, string | undefined>) {
  return auth.parse(env);
}
