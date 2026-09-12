import type { QiwamIconName } from "./qiwam-icon";

export type MobileRole = "RESPONSIBLE" | "MENTOR" | "STUDENT";
export type MobileView =
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

export type MobileDestination = {
  view: MobileView;
  label: string;
  icon: QiwamIconName;
};

const destinations: Record<MobileRole, MobileDestination[]> = {
  RESPONSIBLE: [
    { view: "today", label: "اليوم", icon: "home" },
    { view: "people", label: "الأفراد", icon: "people" },
    { view: "sessions", label: "الجلسات", icon: "calendar" },
    { view: "followup", label: "المتابعة", icon: "followup" },
  ],
  MENTOR: [
    { view: "today", label: "اليوم", icon: "home" },
    { view: "sessions", label: "الجلسات", icon: "calendar" },
    { view: "tracking", label: "التتبع", icon: "target" },
    { view: "followup", label: "المتابعة", icon: "followup" },
  ],
  STUDENT: [
    { view: "today", label: "اليوم", icon: "home" },
    { view: "program", label: "برنامجي", icon: "program" },
    { view: "tracking", label: "التتبع", icon: "target" },
    { view: "learning", label: "التكاليف", icon: "learning" },
  ],
};

export function mobileDestinations(role: MobileRole) {
  return destinations[role];
}
