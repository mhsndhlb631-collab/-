"use client";

import { FormEvent, useEffect, useState } from "react";

export type PersonRow = {
  person_id: string;
  display_name: string;
  contact_phone: string | null;
  student_profile_id: string | null;
  account_id: string | null;
  login_name: string | null;
  role: "MENTOR" | "STUDENT" | null;
  status: string | null;
  enrollment_id: string | null;
  cohort_id: string | null;
  group_id: string | null;
  group_name: string | null;
  cohort_name: string | null;
};
export type PeopleData = { students: PersonRow[]; mentors: PersonRow[] };

export function PeopleWorkspace({
  busy,
  command,
}: {
  busy: boolean;
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [data, setData] = useState<PeopleData | null>(null);
  const [tab, setTab] = useState<"students" | "mentors">("students");
  const [studentLogin, setStudentLogin] = useState(false);
  const [credentials, setCredentials] = useState<{
    login: string;
    password: string;
  } | null>(null);

  async function load() {
    const response = await fetch("/api/v1/people", { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }
  useEffect(() => {
    void fetch("/api/v1/people", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (result) setData(result);
      });
  }, []);

  async function create(
    event: FormEvent<HTMLFormElement>,
    role: "MENTOR" | "STUDENT",
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const withAccount = role === "MENTOR" || studentLogin;
    const result = (await command(
      "/api/v1/people",
      withAccount
        ? {
            mode: "ACCOUNT",
            role,
            display_name: fields.get("display_name"),
            contact_phone:
              String(fields.get("contact_phone") ?? "").trim() || null,
            login_name: fields.get("login_name"),
          }
        : {
            mode: "STUDENT_WITHOUT_ACCOUNT",
            display_name: fields.get("display_name"),
            contact_phone:
              String(fields.get("contact_phone") ?? "").trim() || null,
          },
    )) as { temporary_password?: string | null } | undefined;
    if (!result) return;
    const login = String(fields.get("login_name") ?? "");
    form.reset();
    setStudentLogin(false);
    await load();
    if (result.temporary_password)
      setCredentials({ login, password: result.temporary_password });
  }

  const rows = data?.[tab] ?? [];
  return (
    <section className="people-workspace" aria-labelledby="people-title">
      <div className="workspace-hero">
        <div>
          <span className="section-kicker">إدارة الأشخاص</span>
          <h2 id="people-title">الطلاب والمربون</h2>
          <p>
            أضف الأشخاص أولًا، ثم انتقل إلى البرنامج لتوزيعهم على المجموعات.
          </p>
        </div>
        <div className="hero-counts" aria-label="أعداد الأشخاص">
          <span>
            <strong>{data?.students.length ?? 0}</strong> طالب
          </span>
          <span>
            <strong>{data?.mentors.length ?? 0}</strong> مربي
          </span>
        </div>
      </div>

      {credentials && (
        <aside
          className="credential-card"
          role="status"
          aria-labelledby="credential-title"
        >
          <div>
            <strong id="credential-title">بيانات الدخول المؤقتة جاهزة</strong>
            <p>
              انسخها الآن وسلمها لصاحب الحساب. ستظهر في هذه البطاقة مرة واحدة.
            </p>
          </div>
          <dl>
            <div>
              <dt>اسم الدخول</dt>
              <dd dir="ltr">{credentials.login}</dd>
            </div>
            <div>
              <dt>كلمة المرور المؤقتة</dt>
              <dd dir="ltr">{credentials.password}</dd>
            </div>
          </dl>
          <div className="row-actions">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `اسم الدخول: ${credentials.login}\nكلمة المرور المؤقتة: ${credentials.password}`,
                )
              }
            >
              نسخ البيانات
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setCredentials(null)}
            >
              تم الحفظ
            </button>
          </div>
        </aside>
      )}

      <div className="people-layout">
        <article className="panel create-person-card">
          <span className="section-kicker">إضافة جديدة</span>
          <h3>{tab === "students" ? "إضافة طالب" : "إضافة مربي"}</h3>
          <p className="muted">
            {tab === "students"
              ? "يمكن بدء ملف الطالب بلا حساب وإضافة حساب له عند الحاجة."
              : "ينشأ للمربي حساب دخول بكلمة مؤقتة صالحة لمدة 24 ساعة."}
          </p>
          <form
            className="stack"
            onSubmit={(event) =>
              void create(event, tab === "students" ? "STUDENT" : "MENTOR")
            }
          >
            <label>
              الاسم الكامل
              <input name="display_name" minLength={2} required />
            </label>
            <label>
              رقم الهاتف <span className="optional">اختياري</span>
              <input name="contact_phone" inputMode="tel" />
            </label>
            {tab === "students" && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={studentLogin}
                  onChange={(event) => setStudentLogin(event.target.checked)}
                />
                إنشاء حساب دخول للطالب الآن
              </label>
            )}
            {(tab === "mentors" || studentLogin) && (
              <label>
                اسم الدخول
                <input
                  name="login_name"
                  minLength={3}
                  maxLength={32}
                  autoComplete="off"
                  required
                />
              </label>
            )}
            <button disabled={busy}>
              {busy
                ? "جارٍ الإنشاء…"
                : tab === "students"
                  ? "إضافة الطالب"
                  : "إضافة المربي وإنشاء حسابه"}
            </button>
          </form>
        </article>

        <article className="panel people-list-card">
          <div className="segmented" role="tablist" aria-label="نوع الأشخاص">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "students"}
              className={tab === "students" ? "active" : "secondary"}
              onClick={() => setTab("students")}
            >
              الطلاب <span>{data?.students.length ?? 0}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mentors"}
              className={tab === "mentors" ? "active" : "secondary"}
              onClick={() => setTab("mentors")}
            >
              المربون <span>{data?.mentors.length ?? 0}</span>
            </button>
          </div>
          {!data ? (
            <p className="empty">جارٍ تحميل القائمة…</p>
          ) : rows.length === 0 ? (
            <div className="illustrated-empty">
              <strong>
                {tab === "students" ? "لا يوجد طلاب بعد" : "لا يوجد مربون بعد"}
              </strong>
              <p>
                استخدم النموذج المجاور لإضافة أول{" "}
                {tab === "students" ? "طالب" : "مربي"}.
              </p>
            </div>
          ) : (
            <div className="people-list">
              {rows.map((person) => (
                <div
                  key={`${person.person_id}-${person.enrollment_id ?? "none"}`}
                  className="person-row"
                >
                  <span className="person-avatar" aria-hidden="true">
                    {person.display_name.trim().charAt(0)}
                  </span>
                  <div>
                    <strong>{person.display_name}</strong>
                    <small>
                      {person.group_name
                        ? `${person.cohort_name} · ${person.group_name}`
                        : tab === "students"
                          ? "لم يوزع على مجموعة"
                          : "لم يسند إلى مجموعة"}
                    </small>
                  </div>
                  <span
                    className={`person-status ${person.status === "ACTIVE" || !person.account_id ? "is-active" : ""}`}
                  >
                    {person.account_id
                      ? person.status === "ACTIVE"
                        ? "حساب نشط"
                        : "الحساب قيد التجهيز"
                      : "بلا حساب"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
