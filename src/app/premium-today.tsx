"use client";

import { useEffect, useMemo, useState } from "react";
import { QiwamIcon, type QiwamIconName } from "./qiwam-icon";
import { readJson } from "../offline/client";
import { selectTodayFocus } from "./today-focus";

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

type Overview = {
  templates: { id: string }[];
  plans: { id: string; status: string }[];
  cohorts: { id: string; groups: { id: string }[] }[];
  sessions: {
    id: string;
    group_name: string;
    name: string;
    starts_at: string;
    status: string;
  }[];
};

type TodayCounts = {
  sessions?: number;
  tracking?: number;
  assignments?: number;
  attentions?: number;
  actions?: number;
};

type AuditEvent = {
  id: string;
  action: string;
  resource_type: string;
  actor_role: string | null;
  occurred_at: string;
};

const auditLabels: Record<string, string> = {
  PERSON_CREATED: "تمت إضافة شخص جديد إلى مساحة العمل",
  LOGIN_ACCOUNT_PROVISIONED: "تم تجهيز حساب دخول جديد",
  PROGRAM_TEMPLATE_CREATED: "تم إنشاء قالب برنامج جديد",
  PROGRAM_PLAN_PUBLISHED: "تم نشر خطة تربوية",
  COHORT_CREATED: "تم إنشاء دفعة جديدة",
  SESSION_OPENED: "تم فتح جلسة تربوية",
  SESSION_RECORDS_SAVED: "تم حفظ حضور وتقييمات جلسة",
  SESSION_CLOSED: "تم إغلاق جلسة تربوية",
  ASSIGNMENT_CREATED: "تم إنشاء تكليف جديد",
  TRACKING_ENTRY_RECORDED: "تم تسجيل متابعة جديدة",
  REPORT_EXPORTED: "تم تصدير تقرير",
};

function cairoDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function AnimatedNumber({ value }: { value: number }) {
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 700);
      setVisible(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{visible.toLocaleString("ar-EG")}</>;
}

function Sparkline({ variant = 0 }: { variant?: number }) {
  const paths = [
    "M2 25 C12 21 17 24 25 16 S42 21 50 11 S68 16 78 5",
    "M2 22 C10 12 17 20 25 13 S40 7 49 14 S65 8 78 10",
    "M2 26 C13 27 17 16 29 19 S45 8 55 13 S68 7 78 4",
    "M2 18 C11 24 21 9 31 15 S48 22 57 12 S70 15 78 7",
    "M2 25 C14 17 21 23 29 14 S45 18 54 9 S69 13 78 5",
  ];
  return (
    <svg
      className="stat-sparkline"
      viewBox="0 0 80 30"
      preserveAspectRatio="none"
    >
      <path
        className="spark-fill"
        d={`${paths[variant % paths.length]} L78 30 L2 30 Z`}
      />
      <path className="spark-line" d={paths[variant % paths.length]} />
    </svg>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
  variant,
}: {
  icon: QiwamIconName;
  label: string;
  value: number;
  note: string;
  variant: number;
}) {
  return (
    <article className="premium-stat-card">
      <div className="stat-card-top">
        <span className="stat-icon">
          <QiwamIcon name={icon} size={20} />
        </span>
        <span className="live-trend">
          <QiwamIcon name="trend-up" size={12} weight="fill" /> مباشر
        </span>
      </div>
      <strong>
        <AnimatedNumber value={value} />
      </strong>
      <span className="stat-label">{label}</span>
      <small>{note}</small>
      <Sparkline variant={variant} />
    </article>
  );
}

export function PremiumToday({
  data,
  role,
  displayName,
  open,
}: {
  data: Overview;
  role: Role;
  displayName: string;
  open: (view: View) => void;
}) {
  const [counts, setCounts] = useState<TodayCounts>({}),
    [events, setEvents] = useState<AuditEvent[]>([]),
    [personCount, setPersonCount] = useState(0),
    [measuredAt, setMeasuredAt] = useState(0),
    [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const requests: Promise<{ data: unknown }>[] = [
      readJson<{ counts: TodayCounts }>("/api/v1/me/today"),
    ];
    if (role === "RESPONSIBLE") {
      requests.push(
        readJson<{ events: AuditEvent[] }>("/api/v1/audit-events?limit=6"),
        readJson<{ students?: unknown[]; mentors?: unknown[] }>(
          "/api/v1/people",
        ),
      );
    }
    void Promise.all(requests)
      .then(async ([todayResponse, auditResponse, peopleResponse]) => {
        if (!cancelled && todayResponse) {
          const today = todayResponse.data as { counts: TodayCounts };
          setCounts(today.counts ?? {});
        }
        if (!cancelled && auditResponse) {
          const audit = auditResponse.data as {
            events: AuditEvent[];
          };
          setEvents(audit.events ?? []);
        }
        if (!cancelled && peopleResponse) {
          const people = peopleResponse.data as {
            students?: unknown[];
            mentors?: unknown[];
          };
          setPersonCount(
            (people.students?.length ?? 0) + (people.mentors?.length ?? 0),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setMeasuredAt(Date.now());
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const todaySessions = useMemo(() => {
    const today = cairoDay(new Date(measuredAt));
    const sorted = [...data.sessions].sort(
      (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
    );
    const exact = sorted.filter(
      (session) => cairoDay(new Date(session.starts_at)) === today,
    );
    return (
      exact.length
        ? exact
        : sorted.filter(
            (session) => Date.parse(session.starts_at) >= measuredAt,
          )
    ).slice(0, 5);
  }, [data.sessions, measuredAt]);

  const setupSteps = [
    {
      label: "إضافة الطلاب والمربين",
      done: personCount > 0,
      view: "people" as View,
    },
    {
      label: "إنشاء قالب البرنامج",
      done: data.templates.length > 0,
      view: "program" as View,
    },
    {
      label: "نشر الخطة التربوية",
      done: data.plans.some((plan) => plan.status === "PUBLISHED"),
      view: "program" as View,
    },
    {
      label: "إطلاق دفعة ومجموعة",
      done: data.cohorts.some((cohort) => cohort.groups.length > 0),
      view: "program" as View,
    },
    {
      label: "تشغيل أول جلسة",
      done: data.sessions.some((session) => session.status !== "PLANNED"),
      view: "sessions" as View,
    },
  ];
  const completedSteps = setupSteps.filter((step) => step.done).length;
  const chartItems = [
    { label: "الجلسات", value: counts.sessions ?? 0 },
    { label: "التتبع", value: counts.tracking ?? 0 },
    { label: "التكاليف", value: counts.assignments ?? 0 },
    { label: "التنبيهات", value: counts.attentions ?? 0 },
    { label: "الإجراءات", value: counts.actions ?? 0 },
  ];
  const chartMax = Math.max(1, ...chartItems.map((item) => item.value));
  const formattedDate = measuredAt
    ? new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date(measuredAt))
    : "اليوم";
  const focus = selectTodayFocus(role, counts, todaySessions);

  return (
    <div className="premium-today">
      <header className="premium-page-header">
        <div>
          <span>{formattedDate}</span>
          <h2>مرحبًا، {displayName}</h2>
          <p>
            {(counts.attentions ?? 0) + (counts.actions ?? 0) > 0
              ? "هناك بنود تحتاج متابعتك اليوم."
              : "لا شيء عاجل اليوم — مساحة العمل تسير بصورة جيدة."}
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => open(role === "RESPONSIBLE" ? "reports" : "progress")}
        >
          <QiwamIcon name="reports" size={16} />
          {role === "RESPONSIBLE" ? "عرض التقارير" : "عرض التقدم"}
        </button>
      </header>

      <section className={`today-focus-card is-${focus.tone}`}>
        <span className="today-focus-icon" aria-hidden="true">
          <QiwamIcon name={focus.icon} size={24} weight="duotone" />
        </span>
        <div>
          <span>{focus.kicker}</span>
          <strong>{focus.title}</strong>
          <p>{focus.detail}</p>
        </div>
        <button type="button" onClick={() => open(focus.view)}>
          {focus.action}
          <QiwamIcon name="caret-left" size={15} />
        </button>
      </section>

      <section
        className={`premium-stats${loading ? " is-loading" : ""}`}
        aria-label="مؤشرات اليوم"
        aria-busy={loading}
      >
        <StatCard
          icon="calendar"
          label="جلسات اليوم"
          value={counts.sessions ?? 0}
          note="حسب جدول اليوم"
          variant={0}
        />
        <StatCard
          icon="people"
          label={role === "RESPONSIBLE" ? "الطلاب والمربون" : "الجلسات المتاحة"}
          value={role === "RESPONSIBLE" ? personCount : data.sessions.length}
          note={role === "RESPONSIBLE" ? "ضمن مساحة العمل" : "بحسب نطاقك"}
          variant={1}
        />
        <StatCard
          icon="notebook"
          label="التكاليف"
          value={counts.assignments ?? 0}
          note="في الخطط المنشورة"
          variant={2}
        />
        <StatCard
          icon="target"
          label="قيم التتبع"
          value={counts.tracking ?? 0}
          note="مستحقة اليوم"
          variant={3}
        />
        <StatCard
          icon="bell"
          label="تحتاج متابعة"
          value={(counts.attentions ?? 0) + (counts.actions ?? 0)}
          note="تنبيهات وإجراءات"
          variant={4}
        />
      </section>

      <div className="today-columns">
        <div className="today-main-column">
          <section className="premium-card schedule-card">
            <header className="section-heading">
              <div>
                <span className="section-icon">
                  <QiwamIcon name="calendar-check" weight="duotone" />
                </span>
                <div>
                  <h3>الجدول اليومي</h3>
                  <p>
                    {todaySessions.length
                      ? "الجلسات الأقرب حسب توقيت القاهرة"
                      : "لا توجد جلسات قادمة مجدولة"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => open("sessions")}
              >
                عرض الجلسات
                <QiwamIcon name="caret-left" size={14} />
              </button>
            </header>
            {todaySessions.length ? (
              <div className="schedule-timeline">
                {todaySessions.map((session) => {
                  const starts = new Date(session.starts_at);
                  const status =
                    session.status === "OPEN"
                      ? "جارية"
                      : session.status === "CLOSED"
                        ? "مكتملة"
                        : "قادمة";
                  return (
                    <button
                      type="button"
                      key={session.id}
                      className="schedule-row"
                      onClick={() => open("sessions")}
                    >
                      <time>
                        {starts.toLocaleTimeString("ar-EG", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Africa/Cairo",
                        })}
                      </time>
                      <span className="timeline-dot" />
                      <span className="session-copy">
                        <strong>{session.name}</strong>
                        <small>{session.group_name}</small>
                      </span>
                      <span
                        className={`session-state state-${session.status.toLowerCase()}`}
                      >
                        {status}
                      </span>
                      <QiwamIcon name="caret-left" size={14} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="premium-empty">
                <QiwamIcon name="calendar" size={48} weight="duotone" />
                <strong>لا توجد جلسات قادمة مجدولة</strong>
                <p>ستظهر هنا الجلسة التالية فور جدولتها في البرنامج.</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => open("program")}
                >
                  إعداد البرنامج
                </button>
              </div>
            )}
          </section>

          <section className="premium-card pulse-card">
            <header className="section-heading">
              <div>
                <span className="section-icon">
                  <QiwamIcon name="reports" weight="duotone" />
                </span>
                <div>
                  <h3>نبض التشغيل</h3>
                  <p>مقارنة مباشرة لمؤشرات اليوم</p>
                </div>
              </div>
            </header>
            <div
              className="operations-chart"
              role="img"
              aria-label="رسم يوضح مقارنة مؤشرات اليوم"
            >
              {chartItems.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <i>
                    <b
                      style={{
                        width: `${Math.max(item.value ? 8 : 0, (item.value / chartMax) * 100)}%`,
                      }}
                    />
                  </i>
                  <strong>{item.value.toLocaleString("ar-EG")}</strong>
                </div>
              ))}
            </div>
          </section>

          {role === "RESPONSIBLE" && (
            <section className="premium-card activity-card">
              <header className="section-heading">
                <div>
                  <span className="section-icon">
                    <QiwamIcon name="sparkle" weight="duotone" />
                  </span>
                  <div>
                    <h3>آخر النشاطات</h3>
                    <p>سجل حديث لما تغيّر في المنصة</p>
                  </div>
                </div>
              </header>
              {events.length ? (
                <div className="activity-feed">
                  {events.map((event) => (
                    <article key={event.id}>
                      <span className="activity-icon">
                        <QiwamIcon
                          name={
                            event.action.includes("SESSION")
                              ? "calendar"
                              : event.action.includes("REPORT")
                                ? "reports"
                                : event.action.includes("PERSON") ||
                                    event.action.includes("ACCOUNT")
                                  ? "people"
                                  : "check"
                          }
                          size={17}
                          weight="duotone"
                        />
                      </span>
                      <div>
                        <strong>
                          {auditLabels[event.action] ??
                            `تم تنفيذ ${event.action.replaceAll("_", " ")}`}
                        </strong>
                        <small>
                          {new Intl.RelativeTimeFormat("ar-EG", {
                            numeric: "auto",
                          }).format(
                            Math.max(
                              -30,
                              Math.round(
                                (Date.parse(event.occurred_at) - measuredAt) /
                                  3600000,
                              ),
                            ),
                            "hour",
                          )}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="compact-empty">
                  <QiwamIcon name="sparkle" size={34} weight="duotone" />
                  <span>سيظهر النشاط هنا بعد بدء تشغيل البرنامج.</span>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="today-side-column">
          <section className="premium-card quick-card">
            <header className="section-heading">
              <div>
                <span className="section-icon">
                  <QiwamIcon name="plus" weight="duotone" />
                </span>
                <div>
                  <h3>إجراءات سريعة</h3>
                  <p>ابدأ المهمة مباشرة</p>
                </div>
              </div>
            </header>
            <div className="quick-action-grid">
              {role === "RESPONSIBLE" && (
                <button type="button" onClick={() => open("people")}>
                  <QiwamIcon name="student" weight="fill" />
                  <span>إضافة طالب</span>
                </button>
              )}{" "}
              {role !== "STUDENT" && (
                <button type="button" onClick={() => open("sessions")}>
                  <QiwamIcon name="calendar-check" weight="fill" />
                  <span>فتح جلسة</span>
                </button>
              )}
              <button type="button" onClick={() => open("learning")}>
                <QiwamIcon name="notebook" weight="fill" />
                <span>
                  {role === "STUDENT" ? "عرض التكاليف" : "إضافة تكليف"}
                </span>
              </button>
              <button type="button" onClick={() => open("tracking")}>
                <QiwamIcon name="target" weight="fill" />
                <span>
                  {role === "STUDENT" ? "تسجيل إنجاز" : "تسجيل متابعة"}
                </span>
              </button>
            </div>
          </section>

          {role === "RESPONSIBLE" && (
            <section className="premium-card onboarding-card">
              <header>
                <div>
                  <span>تجهيز منصتك</span>
                  <strong>
                    {completedSteps} من {setupSteps.length}
                  </strong>
                </div>
                <div
                  className="progress-track"
                  aria-label={`${Math.round((completedSteps / setupSteps.length) * 100)} بالمئة مكتمل`}
                >
                  <i
                    style={{
                      width: `${(completedSteps / setupSteps.length) * 100}%`,
                    }}
                  />
                </div>
              </header>
              <ol>
                {setupSteps.map((step) => (
                  <li key={step.label} className={step.done ? "is-done" : ""}>
                    <span>
                      {step.done ? (
                        <QiwamIcon name="check" size={17} weight="fill" />
                      ) : (
                        setupSteps.indexOf(step) + 1
                      )}
                    </span>
                    <button type="button" onClick={() => open(step.view)}>
                      {step.label}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="workspace-status-banner">
            <QiwamIcon name="warning" size={22} weight="duotone" />
            <div>
              <strong>جاهزية التشغيل</strong>
              <p>
                {role !== "RESPONSIBLE"
                  ? "مساحتك جاهزة، وتظهر المؤشرات حسب نطاق صلاحياتك."
                  : completedSteps === setupSteps.length
                    ? "اكتمل الإعداد الأساسي ويمكنك متابعة التشغيل."
                    : "أكمل خطوات التجهيز لضمان ظهور كل المؤشرات."}
              </p>
            </div>
            <button type="button" onClick={() => open("program")}>
              مراجعة
            </button>
          </section>
        </aside>
      </div>
      <section className="today-summary" aria-labelledby="today-summary-title">
        <header>
          <div>
            <span className="section-kicker">خلاصة عملية</span>
            <h3 id="today-summary-title">ملخص اليوم</h3>
          </div>
        </header>
        <div>
          <article>
            <span>
              <QiwamIcon name="warning" weight="duotone" />
              يحتاج إجراء
              <b>
                {(
                  (counts.attentions ?? 0) + (counts.actions ?? 0)
                ).toLocaleString("ar-EG")}
              </b>
            </span>
            <p>
              {(counts.attentions ?? 0) + (counts.actions ?? 0)
                ? "راجع التنبيهات والإجراءات المفتوحة."
                : "لا توجد بنود عاجلة الآن."}
            </p>
            <button
              type="button"
              onClick={() =>
                open(
                  role === "RESPONSIBLE"
                    ? "reports"
                    : role === "MENTOR"
                      ? "followup"
                      : "tracking",
                )
              }
            >
              فتح المتابعة
            </button>
          </article>
          <article>
            <span>
              <QiwamIcon name="calendar" weight="duotone" />
              جلسات مفتوحة
              <b>
                {data.sessions
                  .filter((session) => session.status === "OPEN")
                  .length.toLocaleString("ar-EG")}
              </b>
            </span>
            <p>الجلسات المفتوحة تحتاج تسجيلًا أو إغلاقًا.</p>
            <button
              type="button"
              onClick={() => open(role === "STUDENT" ? "program" : "sessions")}
            >
              {role === "STUDENT" ? "عرض البرنامج" : "عرض الجلسات"}
            </button>
          </article>
          <article>
            <span>
              <QiwamIcon name="check" weight="duotone" />
              اكتمال التجهيز
              <b>
                {role === "RESPONSIBLE"
                  ? `${Math.round((completedSteps / setupSteps.length) * 100)}٪`
                  : "جاهز"}
              </b>
            </span>
            <p>
              {role === "RESPONSIBLE"
                ? `${setupSteps.length - completedSteps} خطوات متبقية للإعداد الكامل.`
                : "كل الأدوات المتاحة لدورك جاهزة."}
            </p>
            <button type="button" onClick={() => open("program")}>
              فتح البرنامج
            </button>
          </article>
        </div>
      </section>
    </div>
  );
}
