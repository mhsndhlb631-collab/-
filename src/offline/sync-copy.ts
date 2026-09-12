import type { ConnectivityKind } from "./types";

export type SyncCounts = {
  pending: number;
  failed: number;
  conflicts: number;
};

export function syncStatusCopy(
  connectivity: ConnectivityKind,
  counts: SyncCounts,
) {
  if (connectivity === "offline")
    return { label: "غير متصل", detail: "سيُحفظ عملك على هذا الجهاز" };
  if (connectivity === "auth_required")
    return { label: "يلزم تسجيل الدخول", detail: "عملك المحفوظ لم يُحذف" };
  if (connectivity === "server_error")
    return { label: "الخدمة غير متاحة", detail: "سنحاول تلقائيًا بعد قليل" };
  if (connectivity === "degraded")
    return { label: "جارٍ التحقق", detail: "نتحقق من الاتصال الآن" };
  if (counts.conflicts > 0)
    return {
      label: `${counts.conflicts} تحتاج مراجعة`,
      detail: "اختر النسخة الصحيحة قبل المتابعة",
    };
  if (counts.failed > 0)
    return {
      label: `${counts.failed} لم تكتمل`,
      detail: "افتح مركز المزامنة لمعرفة المطلوب",
    };
  if (counts.pending > 0)
    return {
      label: `${counts.pending} بانتظار المزامنة`,
      detail: "محفوظة بأمان على هذا الجهاز",
    };
  return { label: "تمت المزامنة", detail: "كل التغييرات محفوظة" };
}

export function failureCopy(status: string) {
  if (status === "blocked_auth") return "يلزم تسجيل الدخول لإكمال الحفظ";
  if (status === "failed_permission") return "ليست لديك صلاحية لهذا التغيير";
  if (status === "failed_missing_dependency")
    return "تعذر العثور على سجل مرتبط بهذا التغيير";
  return "تحتاج البيانات إلى مراجعة من الشاشة الأصلية";
}
