import { AppError } from "./errors";

const allowed = /^[a-z0-9_\u0621-\u063a\u0641-\u064a]{3,32}$/u;
export function normalizeUsername(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length > 256 ||
    /\p{Cf}/u.test(input)
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  const result = input
    .normalize("NFC")
    .trim()
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (!allowed.test(result)) throw new AppError("VALIDATION_ERROR");
  return result;
}
