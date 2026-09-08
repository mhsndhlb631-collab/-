import { z } from "zod";
const base = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]),
  APP_ORIGIN: z.url(),
});
const database = z.object({
  DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//),
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
