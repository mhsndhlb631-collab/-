import { AppError } from "../domain/errors";

export function trustedNetworkKey(request: Request, hosted: boolean) {
  if (!hosted) return "local-development";
  const value = request.headers
    .get("x-vercel-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  if (!value || value.length > 64) throw new AppError("FORBIDDEN");
  return value;
}

export function loginBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("VALIDATION_ERROR");
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !["login_name", "password"].includes(key))
  )
    throw new AppError("VALIDATION_ERROR");
  return { loginName: body.login_name, password: body.password };
}
