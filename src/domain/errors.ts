export const errorDefinitions = {
  VALIDATION_ERROR: [400, "بيانات الطلب غير صالحة."],
  INVALID_CREDENTIALS: [401, "اسم الدخول أو كلمة المرور غير صحيحة."],
  UNAUTHENTICATED: [401, "يلزم تسجيل الدخول."],
  SESSION_REVOKED: [401, "انتهت صلاحية الجلسة. سجل الدخول مجددًا."],
  ACCOUNT_DISABLED: [403, "الحساب معطل."],
  PASSWORD_CHANGE_REQUIRED: [403, "يلزم تغيير كلمة المرور."],
  FORBIDDEN: [403, "هذه العملية غير مسموحة."],
  NOT_FOUND: [404, "المورد غير موجود."],
  LOGIN_NAME_UNAVAILABLE: [409, "اسم الدخول غير متاح."],
  VERSION_CONFLICT: [409, "تغير السجل. أعد تحميله ثم حاول مجددًا."],
  INVALID_STATE_TRANSITION: [409, "حالة السجل لا تسمح بهذه العملية."],
  IDEMPOTENCY_CONFLICT: [409, "استُخدم مفتاح الطلب مع بيانات مختلفة."],
  PERIOD_LOCKED: [409, "السجل مغلق ويلزم مسار تصحيح."],
  INCOMPLETE_SESSION: [
    422,
    "لا يمكن إغلاق الجلسة قبل استكمال البيانات المطلوبة.",
  ],
  ENTRY_MODE_NOT_ALLOWED: [422, "طريقة إدخال هذا العنصر غير مسموحة."],
  RATE_LIMITED: [429, "محاولات كثيرة. حاول لاحقًا."],
  DEPENDENCY_UNAVAILABLE: [503, "الخدمة غير جاهزة حاليًا."],
  INTERNAL_ERROR: [500, "تعذر إتمام العملية."],
} as const;
export type ErrorCode = keyof typeof errorDefinitions;
export class AppError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(errorDefinitions[code][1]);
  }
}
export function safeError(error: unknown, requestId: string) {
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  const [status, message] = errorDefinitions[code];
  return { status, body: { code, message, request_id: requestId } };
}
