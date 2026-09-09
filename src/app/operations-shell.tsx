"use client";
import { FormEvent, useState } from "react";

type Overview = {
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
const empty: Overview = { templates: [], plans: [], cohorts: [], sessions: [] };

export function OperationsShell() {
  const [data, setData] = useState<Overview>(empty),
    [signedIn, setSignedIn] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const [response, sessionsResponse] = await Promise.all([
      fetch("/api/v1/programs", { cache: "no-store" }),
      fetch("/api/v1/sessions", { cache: "no-store" }),
    ]);
    if (!response.ok || !sessionsResponse.ok)
      throw new Error("تعذر تحميل مساحة العمل.");
    setData({
      ...(await response.json()),
      sessions: (await sessionsResponse.json()).sessions,
    });
    setSignedIn(true);
  }
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
      if (result.next === "CHANGE_PASSWORD")
        throw new Error("يلزم تغيير كلمة المرور المؤقتة أولًا.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تسجيل الدخول.");
    } finally {
      setBusy(false);
    }
  }
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
  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <span className="eyebrow">قِوام · التشغيل</span>
          <h1>البرنامج والجلسات</h1>
        </div>
        <span className="status-dot">متصل</span>
      </header>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
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
      <section className="workspace-grid">
        <TemplateForm busy={busy} submit={command} />
        <PlanForm busy={busy} data={data} submit={command} />
        <CohortForm busy={busy} data={data} submit={command} />
      </section>
      <SessionWorkspace
        busy={busy}
        sessions={data.sessions}
        command={command}
      />
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
          <p className="empty">لا توجد دفعات بعد. ابدأ بقالب ثم انشر خطة.</p>
        )}
      </section>
    </main>
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
      required: boolean;
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
        {sessions.map((s) => (
          <button
            className="secondary"
            key={s.id}
            onClick={() => void openDetail(s.id)}
          >
            {s.name} · {s.group_name}
            <small>{s.status}</small>
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
          {detail.session.status !== "PLANNED" && (
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
                <article key={r.id}>
                  <h3>{r.display_name}</h3>
                  <label>
                    الحضور
                    <select
                      name={`a-${r.id}`}
                      defaultValue={r.attendance_status}
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
                  <label>
                    سبب الغياب
                    <input
                      name={`reason-${r.id}`}
                      defaultValue={r.reason ?? ""}
                    />
                  </label>
                  {r.metrics.map((m) => (
                    <label key={m.definition_id}>
                      {m.name}
                      {m.required && " *"}
                      <input
                        name={`m-${r.id}-${m.definition_id}`}
                        type={
                          [
                            "COUNT",
                            "PERCENT",
                            "SCORE",
                            "DURATION",
                            "NUMBER",
                          ].includes(m.value_type)
                            ? "number"
                            : "text"
                        }
                        defaultValue={
                          typeof m.value === "string" ||
                          typeof m.value === "number"
                            ? m.value
                            : ""
                        }
                      />
                    </label>
                  ))}
                </article>
              ))}
              <button disabled={busy}>حفظ السجل</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
