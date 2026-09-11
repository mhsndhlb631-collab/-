"use client";
import { FormEvent, useEffect, useState } from "react";
import { TrackingWorkspace } from "./tracking-workspace";
import { LearningWorkspace } from "./learning-workspace";
import { FollowupWorkspace } from "./followup-workspace";
import { ResponsibleCenter } from "./responsible-center";
import { JourneyPanel } from "./journey-panel";
import { PeopleWorkspace } from "./people-workspace";
import { DistributionWorkspace } from "./distribution-workspace";

type Overview = {
  actor_role: "RESPONSIBLE" | "MENTOR" | "STUDENT";
  templates: { id: string; name: string; level: string; status: string }[];
  plans: {
    id: string;
    template_id: string | null;
    name: string;
    version: number;
    status: string;
  }[];
  cohorts: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
    groups: { id: string; name: string }[];
  }[];
  sessions: {
    id: string;
    group_name: string;
    name: string;
    starts_at: string;
    status: string;
    row_version: number;
  }[];
};
const empty: Overview = {
  actor_role: "RESPONSIBLE",
  templates: [],
  plans: [],
  cohorts: [],
  sessions: [],
};

type Me = {
  account_id: string;
  display_name: string;
  login_name: string;
  role: Overview["actor_role"];
  workspace_name: string;
};
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
const viewLabels: Record<View, string> = {
  today: "اليوم",
  people: "الطلاب والمربون",
  program: "البرنامج والمجموعات",
  sessions: "الجلسات",
  tracking: "التتبع",
  learning: "التعلم والتكاليف",
  followup: "المتابعة",
  reports: "التقارير",
  progress: "التقدم",
  account: "الحساب",
};
const roleLabels = {
  RESPONSIBLE: "مسؤول",
  MENTOR: "مربي",
  STUDENT: "طالب",
};

export function OperationsShell() {
  const [data, setData] = useState<Overview>(empty),
    [me, setMe] = useState<Me | null>(null),
    [signedIn, setSignedIn] = useState(false),
    [initializing, setInitializing] = useState(true),
    [changeRequired, setChangeRequired] = useState(false),
    [passwordOptional, setPasswordOptional] = useState(false),
    [activeView, setActiveView] = useState<View>("today"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const [meResponse, response, sessionsResponse] = await Promise.all([
      fetch("/api/v1/me", { cache: "no-store" }),
      fetch("/api/v1/programs", { cache: "no-store" }),
      fetch("/api/v1/sessions", { cache: "no-store" }),
    ]);
    if (meResponse.status === 401) {
      setSignedIn(false);
      setMe(null);
      return false;
    }
    if (!meResponse.ok || !response.ok || !sessionsResponse.ok)
      throw new Error("تعذر تحميل مساحة العمل.");
    const identity = (await meResponse.json()) as Me;
    setMe(identity);
    setData({
      ...(await response.json()),
      sessions: (await sessionsResponse.json()).sessions,
    });
    setSignedIn(true);
    return true;
  }
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/v1/me", { cache: "no-store" }),
      fetch("/api/v1/programs", { cache: "no-store" }),
      fetch("/api/v1/sessions", { cache: "no-store" }),
    ])
      .then(async ([meResponse, response, sessionsResponse]) => {
        if (!meResponse.ok || !response.ok || !sessionsResponse.ok) return null;
        return {
          identity: (await meResponse.json()) as Me,
          overview: await response.json(),
          sessions: (await sessionsResponse.json()).sessions,
        };
      })
      .then((result) => {
        if (cancelled || !result) return;
        setMe(result.identity);
        setData({ ...result.overview, sessions: result.sessions });
        setSignedIn(true);
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function command(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (response.status === 401) {
        setSignedIn(false);
        setMe(null);
      }
      if (!response.ok)
        throw new Error(result.message ?? "تعذر تنفيذ العملية.");
      await load();
      setMessage("تم الحفظ بنجاح.");
      return result;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذر تنفيذ العملية.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login_name: form.get("login_name"),
          password: form.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "تعذر تسجيل الدخول.");
      if (result.next === "CHANGE_PASSWORD") {
        setPasswordOptional(false);
        setChangeRequired(true);
      } else {
        await load();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تسجيل الدخول.");
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      current = String(form.get("current_password") ?? ""),
      next = String(form.get("new_password") ?? ""),
      confirmation = String(form.get("confirm_password") ?? "");
    if (next !== confirmation) {
      setMessage("تأكيد كلمة المرور غير مطابق.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "تعذر تغيير كلمة المرور.");
      setChangeRequired(false);
      setPasswordOptional(false);
      setSignedIn(false);
      setMe(null);
      setMessage("تم تغيير كلمة المرور. سجل الدخول بالكلمة الجديدة.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذر تغيير كلمة المرور.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      setSignedIn(false);
      setMe(null);
      setActiveView("today");
      setBusy(false);
      setMessage("تم تسجيل الخروج.");
    }
  }
  if (initializing)
    return (
      <main className="app-loading" aria-busy="true">
        <div className="brand-mark-static" aria-hidden="true">
          ق
        </div>
        <p role="status">جارٍ تجهيز مساحتك…</p>
      </main>
    );
  if (changeRequired)
    return (
      <main className="auth-page">
        <section className="login-card" aria-labelledby="change-title">
          <span className="section-kicker">حماية الحساب</span>
          <h1 id="change-title">تغيير كلمة المرور</h1>
          <p className="muted">اختر كلمة جديدة قبل متابعة استخدام المنصة.</p>
          <form onSubmit={changePassword} className="stack">
            <label>
              كلمة المرور الحالية
              <input
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              كلمة المرور الجديدة
              <input
                name="new_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              تأكيد كلمة المرور
              <input
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <button disabled={busy}>
              {busy ? "جارٍ الحفظ…" : "حفظ وتسجيل الدخول من جديد"}
            </button>
            {passwordOptional && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMessage("");
                  setChangeRequired(false);
                  setPasswordOptional(false);
                }}
              >
                رجوع إلى الحساب
              </button>
            )}
          </form>
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
        </section>
      </main>
    );
  if (!signedIn)
    return (
      <main className="login-page">
        <section className="brand-panel">
          <span className="eyebrow">منصة قِوام</span>
          <h1>نظام التشغيل التربوي</h1>
          <p>
            نظّم البرنامج والدفعات والمجموعات مع تاريخ واضح لكل قرار وإسناد.
          </p>
          <div className="brand-mark" aria-hidden="true">
            ق
          </div>
        </section>
        <section className="login-card">
          <span className="section-kicker">دخول آمن</span>
          <h2>مرحبًا بعودتك</h2>
          <p className="muted">استخدم اسم الدخول وكلمة المرور.</p>
          <form onSubmit={login} className="stack">
            <label>
              اسم الدخول
              <input name="login_name" autoComplete="username" required />
            </label>
            <label>
              كلمة المرور
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button disabled={busy}>
              {busy ? "جارٍ التحقق…" : "تسجيل الدخول"}
            </button>
          </form>
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
        </section>
      </main>
    );
  const allowedViews: View[] =
    data.actor_role === "RESPONSIBLE"
      ? [
          "today",
          "people",
          "reports",
          "program",
          "sessions",
          "tracking",
          "learning",
          "followup",
          "progress",
          "account",
        ]
      : data.actor_role === "MENTOR"
        ? [
            "today",
            "sessions",
            "tracking",
            "learning",
            "followup",
            "progress",
            "program",
            "account",
          ]
        : ["today", "program", "tracking", "learning", "progress", "account"];
  return (
    <main className="dashboard" id="main-content">
      <a className="skip-link" href="#workspace-content">
        انتقل إلى المحتوى
      </a>
      <header className="topbar">
        <div>
          <span className="eyebrow">قِوام · {roleLabels[data.actor_role]}</span>
          <h1>{me ? `مرحبًا، ${me.display_name}` : "مساحة العمل"}</h1>
        </div>
        <div className="account-actions">
          <span className="status-dot">{me?.workspace_name ?? "متصل"}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => void logout()}
            disabled={busy}
          >
            تسجيل الخروج
          </button>
        </div>
      </header>
      <nav className="role-nav" aria-label="أقسام مساحة العمل">
        {allowedViews.map((view) => (
          <button
            type="button"
            key={view}
            aria-current={activeView === view ? "page" : undefined}
            className={activeView === view ? "active" : "secondary"}
            onClick={() => setActiveView(view)}
          >
            {viewLabels[view]}
          </button>
        ))}
      </nav>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div id="workspace-content" tabIndex={-1}>
        {activeView === "today" && (
          <>
            <JourneyPanel key="today" kind="today" />
            {data.actor_role === "RESPONSIBLE" && (
              <SetupGuide data={data} open={setActiveView} />
            )}
          </>
        )}
        {activeView === "people" && data.actor_role === "RESPONSIBLE" && (
          <PeopleWorkspace busy={busy} command={command} />
        )}
        {activeView === "program" && (
          <JourneyPanel key="program" kind="program" />
        )}
        {activeView === "progress" && (
          <JourneyPanel key="progress" kind="progress" />
        )}
        {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
          <section className="stats">
            <article>
              <strong>{data.templates.length}</strong>
              <span>قوالب</span>
            </article>
            <article>
              <strong>
                {data.plans.filter((p) => p.status === "PUBLISHED").length}
              </strong>
              <span>خطط منشورة</span>
            </article>
            <article>
              <strong>{data.cohorts.length}</strong>
              <span>دفعات</span>
            </article>
            <article>
              <strong>{data.cohorts.flatMap((c) => c.groups).length}</strong>
              <span>مجموعات</span>
            </article>
            <article>
              <strong>{data.sessions.length}</strong>
              <span>جلسات</span>
            </article>
          </section>
        )}
        {activeView === "reports" && data.actor_role === "RESPONSIBLE" && (
          <ResponsibleCenter />
        )}
        {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
          <section className="workspace-grid">
            <TemplateForm busy={busy} submit={command} />
            <PlanForm busy={busy} data={data} submit={command} />
            <CohortForm busy={busy} data={data} submit={command} />
          </section>
        )}
        {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
          <DistributionWorkspace
            busy={busy}
            cohorts={data.cohorts}
            command={command}
          />
        )}
        {activeView === "sessions" && data.actor_role !== "STUDENT" && (
          <SessionWorkspace
            busy={busy}
            sessions={data.sessions}
            command={command}
          />
        )}
        {activeView === "tracking" && (
          <TrackingWorkspace
            busy={busy}
            actorRole={data.actor_role}
            command={command}
          />
        )}
        {activeView === "learning" && (
          <LearningWorkspace
            busy={busy}
            actorRole={data.actor_role}
            command={command}
          />
        )}
        {activeView === "followup" && data.actor_role !== "STUDENT" && (
          <FollowupWorkspace busy={busy} command={command} />
        )}
        {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">السجل</span>
                <h2>الدفعات الحالية</h2>
              </div>
            </div>
            {data.cohorts.length ? (
              <div className="cohort-list">
                {data.cohorts.map((c) => (
                  <article key={c.id}>
                    <div>
                      <strong>{c.name}</strong>
                      <span>
                        {c.starts_on} — {c.ends_on}
                      </span>
                    </div>
                    <div className="chips">
                      {c.groups.map((g) => (
                        <span key={g.id}>{g.name}</span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty">
                لا توجد دفعات بعد. ابدأ بقالب ثم انشر خطة.
              </p>
            )}
          </section>
        )}
        {activeView === "account" && me && (
          <section className="panel table-panel account-panel">
            <div>
              <span className="section-kicker">الحساب</span>
              <h2>{me.display_name}</h2>
            </div>
            <dl>
              <div>
                <dt>اسم الدخول</dt>
                <dd>{me.login_name}</dd>
              </div>
              <div>
                <dt>الدور</dt>
                <dd>{roleLabels[me.role]}</dd>
              </div>
              <div>
                <dt>الجهة</dt>
                <dd>{me.workspace_name}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => {
                setMessage("");
                setPasswordOptional(true);
                setChangeRequired(true);
              }}
            >
              تغيير كلمة المرور
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
function SetupGuide({
  data,
  open,
}: {
  data: Overview;
  open: (view: View) => void;
}) {
  const [personCount, setPersonCount] = useState(0);
  useEffect(() => {
    void fetch("/api/v1/people", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { students?: unknown[]; mentors?: unknown[] } | null) => {
        if (result)
          setPersonCount(
            (result.students?.length ?? 0) + (result.mentors?.length ?? 0),
          );
      });
  }, []);
  const steps: Array<{
    label: string;
    detail: string;
    done: boolean;
    view: View;
    action: string;
  }> = [
    {
      label: "أضف الطلاب والمربين",
      detail: "أنشئ ملفات الطلاب وحسابات المربين.",
      done: personCount > 0,
      view: "people",
      action: "إدارة الأشخاص",
    },
    {
      label: "جهّز البرنامج",
      detail: "أنشئ القالب والخطة بما فيها اللقاء والتكاليف.",
      done: data.plans.some((plan) => plan.status === "PUBLISHED"),
      view: "program",
      action: "تجهيز البرنامج",
    },
    {
      label: "أطلق الدفعة ووزّع المجموعة",
      detail: "حدد المواعيد ثم اربط الطلاب والمربي.",
      done: data.cohorts.length > 0,
      view: "program",
      action: "إطلاق دفعة",
    },
    {
      label: "افتح أول جلسة",
      detail: "سجل الحضور والأدب والتفاعل ثم أغلق اللقاء.",
      done: data.sessions.some((session) => session.status !== "PLANNED"),
      view: "sessions",
      action: "فتح الجلسات",
    },
  ];
  return (
    <section className="setup-guide" aria-labelledby="setup-title">
      <div className="setup-copy">
        <span className="section-kicker">بداية التشغيل</span>
        <h2 id="setup-title">جهّز أول مجموعة في أربع خطوات</h2>
        <p>نفّذها بالترتيب، وستظهر الجلسات والتكاليف تلقائيًا لكل دور.</p>
      </div>
      <ol>
        {steps.map((step, index) => (
          <li key={step.label} className={step.done ? "is-complete" : ""}>
            <span className="step-number" aria-hidden="true">
              {step.done ? "✓" : index + 1}
            </span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => open(step.view)}
            >
              {step.action}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
type FormProps = {
  busy: boolean;
  data?: Overview;
  submit: (path: string, body: unknown) => Promise<unknown>;
};
function TemplateForm({ busy, submit }: FormProps) {
  return (
    <article className="panel">
      <span className="section-kicker">01</span>
      <h2>قالب جديد</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit("/api/v1/program-templates", {
            name: f.get("name"),
            level: f.get("level"),
          });
          e.currentTarget.reset();
        }}
      >
        <label>
          اسم البرنامج
          <input name="name" required />
        </label>
        <label>
          المستوى
          <input name="level" required />
        </label>
        <button disabled={busy}>إنشاء القالب</button>
      </form>
    </article>
  );
}
function PlanForm({ busy, data = empty, submit }: FormProps) {
  return (
    <article className="panel">
      <span className="section-kicker">02</span>
      <h2>نشر خطة</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            template = String(f.get("template"));
          void submit(`/api/v1/program-templates/${template}/plans`, {
            name: f.get("name"),
            weeks: [
              {
                week_number: 1,
                week_type: "STANDARD",
                title: "أسبوع الانطلاق",
                objectives: ["التهيئة"],
              },
              {
                week_number: 2,
                week_type: "STANDARD",
                title: "أسبوع البناء",
                objectives: ["التطبيق"],
              },
            ],
            sessions: [
              {
                week_number: 1,
                name: "اللقاء التربوي",
                session_type: "GROUP",
                day_offset: 1,
                starts_at: "18:00",
                duration_minutes: 90,
                attendance_required: true,
                metrics: [
                  {
                    name: "التفاعل",
                    value_type: "SCORE",
                    required: true,
                    applies_to: ["PRESENT", "LATE"],
                    constraints: { min: 0, max: 10 },
                  },
                  {
                    name: "الأدب",
                    value_type: "ENUM",
                    required: true,
                    applies_to: ["PRESENT", "LATE"],
                    constraints: { options: ["ممتاز", "جيد", "يحتاج متابعة"] },
                  },
                ],
              },
            ],
            tracking: [
              {
                name: "ورد القرآن",
                meaning: "عدد صفحات الورد المقروءة في اليوم",
                unit: "صفحة",
                value_type: "COUNT",
                constraints: { min: 0, max: 100 },
                target: { min: 2 },
                allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
                allows_batch: true,
                allows_weekly_summary: false,
                requires_review: true,
                weight: 1,
                schedule: {
                  period_kind: "DAILY",
                  start_week: 1,
                  end_week: null,
                  days_of_week: [0, 1, 2, 3, 4, 5, 6],
                  due_time: "22:00",
                },
              },
              {
                name: "الصلاة في وقتها",
                meaning: "المحافظة على الصلوات المفروضة في وقتها",
                unit: null,
                value_type: "BOOLEAN",
                constraints: {},
                target: { value: true },
                allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
                allows_batch: true,
                allows_weekly_summary: false,
                requires_review: false,
                weight: 1,
                schedule: {
                  period_kind: "DAILY",
                  start_week: 1,
                  end_week: null,
                  days_of_week: [0, 1, 2, 3, 4, 5, 6],
                  due_time: "23:00",
                },
              },
              {
                name: "محاسبة الأسبوع",
                meaning: "تقييم أسبوعي مختصر للالتزام والتقدم",
                unit: "من 10",
                value_type: "SCORE",
                constraints: { min: 0, max: 10 },
                target: { min: 7 },
                allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
                allows_batch: true,
                allows_weekly_summary: true,
                requires_review: true,
                weight: 1,
                schedule: {
                  period_kind: "WEEKLY",
                  start_week: 1,
                  end_week: null,
                  days_of_week: [5],
                  due_time: "21:00",
                },
              },
            ],
            content: [
              {
                week_number: 1,
                title: "مدخل الأسبوع",
                body: "اقرأ أهداف الأسبوع واستعد للتطبيق العملي.",
              },
            ],
            assignments: [
              {
                week_number: 1,
                title: "تطبيق الأسبوع",
                instructions: "اكتب أهم فائدة وكيف ستطبقها.",
                due_day_offset: 5,
                max_score: 10,
                weight: 1,
              },
            ],
            exams: [
              {
                week_number: 1,
                title: "اختبار الأسبوع",
                day_offset: 6,
                max_score: 20,
                weight: 1,
              },
            ],
          });
        }}
      >
        <label>
          القالب
          <select name="template" required defaultValue="">
            <option value="" disabled>
              اختر قالبًا
            </option>
            {data.templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          اسم نسخة الخطة
          <input name="name" required />
        </label>
        <button disabled={busy || !data.templates.length}>
          نشر خطة من أسبوعين
        </button>
      </form>
    </article>
  );
}
function CohortForm({ busy, data = empty, submit }: FormProps) {
  return (
    <article className="panel wide">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">03</span>
          <h2>إطلاق دفعة</h2>
        </div>
        <span className="muted">نسخة مستقلة تحفظ التاريخ</span>
      </div>
      <form
        className="cohort-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit("/api/v1/cohorts", {
            name: f.get("name"),
            source_plan_id: f.get("plan"),
            starts_on: f.get("starts_on"),
            ends_on: f.get("ends_on"),
            groups: String(f.get("groups"))
              .split("،")
              .map((x) => x.trim())
              .filter(Boolean),
          });
        }}
      >
        <label>
          اسم الدفعة
          <input name="name" required />
        </label>
        <label>
          الخطة
          <select name="plan" required defaultValue="">
            <option value="" disabled>
              اختر خطة
            </option>
            {data.plans
              .filter((p) => p.template_id && p.status === "PUBLISHED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · ن{p.version}
                </option>
              ))}
          </select>
        </label>
        <label>
          البداية
          <input name="starts_on" type="date" required />
        </label>
        <label>
          النهاية
          <input name="ends_on" type="date" required />
        </label>
        <label className="span-two">
          المجموعات، بفاصلة عربية
          <input name="groups" placeholder="المجموعة أ، المجموعة ب" required />
        </label>
        <button disabled={busy}>إنشاء الدفعة</button>
      </form>
    </article>
  );
}

type SessionSummary = Overview["sessions"][number];
type SessionDetail = {
  session: SessionSummary & { attendance_required: boolean };
  roster: {
    id: string;
    display_name: string;
    attendance_status: string;
    reason: string | null;
    attendance_row_version: number;
    metrics: {
      definition_id: string;
      name: string;
      value_type: string;
      constraints: { min?: number; max?: number; options?: string[] };
      required: boolean;
      applies_to: string[];
      value: unknown;
      row_version: number | null;
    }[];
  }[];
};
function SessionWorkspace({
  busy,
  sessions,
  command,
}: {
  busy: boolean;
  sessions: SessionSummary[];
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  async function openDetail(id: string) {
    const response = await fetch(`/api/v1/sessions/${id}`, {
      cache: "no-store",
    });
    if (response.ok) setDetail(await response.json());
  }
  async function act(path: string, body: unknown, method = "POST") {
    await command(path, body, method);
    await openDetail(detail?.session.id ?? path.split("/")[4]);
  }
  return (
    <section className="panel table-panel session-workspace">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">الجلسات</span>
          <h2>مساحة تسجيل اللقاء</h2>
        </div>
        <span className="muted">حفظ جزئي ثم إغلاق</span>
      </div>
      <div className="session-tabs">
        {!sessions.length && (
          <div className="action-empty">
            <strong>لا توجد جلسات بعد</strong>
            <p>
              أنشئ قالبًا وخطة، ثم أطلق دفعة؛ سيولّد النظام مواعيد الجلسات
              تلقائيًا.
            </p>
          </div>
        )}
        {sessions.map((s) => (
          <button
            className="secondary"
            key={s.id}
            onClick={() => void openDetail(s.id)}
          >
            {s.name} · {s.group_name}
            <small>
              {attendanceLabels[s.status] ??
                (
                  {
                    PLANNED: "مخططة",
                    OPEN: "مفتوحة",
                    CLOSED: "مغلقة",
                    CANCELLED: "ملغاة",
                  } as Record<string, string>
                )[s.status] ??
                s.status}
              {" · "}
              {new Intl.DateTimeFormat("ar-EG", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(s.starts_at))}
            </small>
          </button>
        ))}
      </div>
      {detail && (
        <div className="session-detail">
          <div className="session-actions">
            <strong>{detail.session.name}</strong>
            {detail.session.status === "PLANNED" && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(`/api/v1/sessions/${detail.session.id}/open`, {})
                }
              >
                فتح الجلسة
              </button>
            )}
            {detail.session.status === "OPEN" && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(`/api/v1/sessions/${detail.session.id}/close`, {
                    row_version: detail.session.row_version,
                  })
                }
              >
                إغلاق الجلسة
              </button>
            )}
          </div>
          {detail.session.status === "OPEN" && (
            <form
              className="roster-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  records = detail.roster.map((r) => ({
                    roster_id: r.id,
                    attendance: {
                      status: f.get(`a-${r.id}`),
                      reason: f.get(`reason-${r.id}`) || null,
                      row_version: r.attendance_row_version,
                    },
                    metrics: r.metrics.flatMap((m) => {
                      const raw = f.get(`m-${r.id}-${m.definition_id}`);
                      if (raw === "" || raw === null) return [];
                      return [
                        {
                          definition_id: m.definition_id,
                          value: [
                            "COUNT",
                            "PERCENT",
                            "SCORE",
                            "DURATION",
                            "NUMBER",
                          ].includes(m.value_type)
                            ? Number(raw)
                            : m.value_type === "BOOLEAN"
                              ? raw === "true"
                              : raw,
                          row_version: m.row_version,
                        },
                      ];
                    }),
                  }));
                void act(
                  `/api/v1/sessions/${detail.session.id}/records`,
                  {
                    occurrence_row_version: detail.session.row_version,
                    records,
                  },
                  "PUT",
                );
              }}
            >
              {detail.roster.map((r) => (
                <RosterFields key={r.id} row={r} />
              ))}
              <button disabled={busy}>حفظ السجل</button>
            </form>
          )}
          {detail.session.status === "CLOSED" && (
            <div className="closed-roster">
              <p className="success-banner">أُغلقت الجلسة وحُفظ سجلها.</p>
              {detail.roster.map((row) => (
                <article key={row.id}>
                  <strong>{row.display_name}</strong>
                  <span>
                    {attendanceLabels[row.attendance_status] ??
                      row.attendance_status}
                  </span>
                  {row.metrics.map((metric) => (
                    <small key={metric.definition_id}>
                      {metric.name}: {String(metric.value ?? "—")}
                    </small>
                  ))}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const attendanceLabels: Record<string, string> = {
  NOT_RECORDED: "لم يسجل",
  PRESENT: "حاضر",
  LATE: "متأخر",
  EXCUSED_ABSENCE: "غائب بعذر",
  UNEXCUSED_ABSENCE: "غائب بلا عذر",
};
function RosterFields({ row }: { row: SessionDetail["roster"][number] }) {
  const [attendance, setAttendance] = useState(row.attendance_status);
  const absent = ["EXCUSED_ABSENCE", "UNEXCUSED_ABSENCE"].includes(attendance);
  return (
    <article>
      <h3>{row.display_name}</h3>
      <label>
        الحضور
        <select
          name={`a-${row.id}`}
          value={attendance}
          onChange={(event) => setAttendance(event.target.value)}
          required
        >
          <option value="NOT_RECORDED" disabled>
            لم يسجل
          </option>
          <option value="PRESENT">حاضر</option>
          <option value="LATE">متأخر</option>
          <option value="EXCUSED_ABSENCE">غائب بعذر</option>
          <option value="UNEXCUSED_ABSENCE">غائب بلا عذر</option>
        </select>
      </label>
      {absent && (
        <label>
          سبب الغياب
          <input
            name={`reason-${row.id}`}
            defaultValue={row.reason ?? ""}
            minLength={3}
            required
          />
        </label>
      )}
      {row.metrics
        .filter((metric) => metric.applies_to.includes(attendance))
        .map((metric) => (
          <label key={metric.definition_id}>
            {metric.name}
            {metric.required && " *"}
            {metric.value_type === "ENUM" ? (
              <select
                name={`m-${row.id}-${metric.definition_id}`}
                defaultValue={
                  typeof metric.value === "string" ? metric.value : ""
                }
                required={metric.required}
              >
                <option value="">اختر التقييم</option>
                {(metric.constraints.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : metric.value_type === "BOOLEAN" ? (
              <select
                name={`m-${row.id}-${metric.definition_id}`}
                defaultValue={
                  typeof metric.value === "boolean" ? String(metric.value) : ""
                }
                required={metric.required}
              >
                <option value="">اختر</option>
                <option value="true">نعم</option>
                <option value="false">لا</option>
              </select>
            ) : (
              <input
                name={`m-${row.id}-${metric.definition_id}`}
                type={
                  ["COUNT", "PERCENT", "SCORE", "DURATION", "NUMBER"].includes(
                    metric.value_type,
                  )
                    ? "number"
                    : "text"
                }
                min={metric.constraints.min}
                max={metric.constraints.max}
                required={metric.required}
                defaultValue={
                  typeof metric.value === "string" ||
                  typeof metric.value === "number"
                    ? metric.value
                    : ""
                }
              />
            )}
          </label>
        ))}
    </article>
  );
}
