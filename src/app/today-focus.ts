import type { QiwamIconName } from "./qiwam-icon";

type Role = "RESPONSIBLE" | "MENTOR" | "STUDENT";
type View =
  | "today"
  | "people"
  | "program"
  | "sessions"
  | "tracking"
  | "learning"
  | "followup"
  | "reports"
  | "progress"
  | "account";

type Counts = {
  assignments?: number;
  tracking?: number;
  attentions?: number;
  actions?: number;
};

type Session = {
  name: string;
  group_name: string;
  starts_at: string;
  status: string;
};

export type TodayFocus = {
  kicker: string;
  title: string;
  detail: string;
  action: string;
  view: View;
  icon: QiwamIconName;
  tone: "attention" | "live" | "normal" | "calm";
};

export function selectTodayFocus(
  role: Role,
  counts: Counts,
  sessions: Session[],
): TodayFocus {
  const openSession = sessions.find((session) => session.status === "OPEN");
  const nextSession = openSession ?? sessions[0];
  const attentionCount = (counts.attentions ?? 0) + (counts.actions ?? 0);
  if (role === "RESPONSIBLE" && attentionCount > 0)
    return {
      kicker: "يحتاج قرارك",
      title: `${attentionCount.toLocaleString("ar-EG")} بنود تحتاج متابعة`,
      detail: "راجع التنبيهات والإجراءات المفتوحة وابدأ بالأعلى أولوية.",
      action: "فتح المتابعة",
      view: "reports",
      icon: "warning",
      tone: "attention",
    };
  if (role !== "STUDENT" && nextSession)
    return {
      kicker: openSession ? "تعمل الآن" : "المهمة التالية",
      title: nextSession.name,
      detail: `${nextSession.group_name} · ${new Date(nextSession.starts_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })}`,
      action: openSession ? "متابعة الجلسة" : "فتح الجلسات",
      view: "sessions",
      icon: "calendar-check",
      tone: openSession ? "live" : "normal",
    };
  if (role === "STUDENT" && (counts.assignments ?? 0) > 0)
    return {
      kicker: "مطلوب اليوم",
      title: `${(counts.assignments ?? 0).toLocaleString("ar-EG")} تكاليف في انتظارك`,
      detail: "ابدأ بالمطلوب الأقرب ثم احفظ تقدمك.",
      action: "فتح التكاليف",
      view: "learning",
      icon: "notebook",
      tone: "normal",
    };
  if (role === "STUDENT" && (counts.tracking ?? 0) > 0)
    return {
      kicker: "ورد اليوم",
      title: `${(counts.tracking ?? 0).toLocaleString("ar-EG")} قيم مستحقة`,
      detail: "سجّل إنجازك الآن ويمكنك المتابعة دون اتصال.",
      action: "تسجيل الإنجاز",
      view: "tracking",
      icon: "target",
      tone: "normal",
    };
  return {
    kicker: "كل شيء هادئ",
    title: "لا توجد مهمة عاجلة الآن",
    detail:
      role === "RESPONSIBLE"
        ? "يمكنك متابعة تجهيز البرنامج أو مراجعة المؤشرات."
        : "يمكنك مراجعة تقدمك والمهام القادمة.",
    action: role === "RESPONSIBLE" ? "فتح البرنامج" : "عرض التقدم",
    view: role === "RESPONSIBLE" ? "program" : "progress",
    icon: "check",
    tone: "calm",
  };
}
