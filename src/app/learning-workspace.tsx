"use client";
import { FormEvent, useEffect, useState } from "react";
import { readJson } from "../offline/client";

type Item = { id: string; title: string; week_id: string; week_number: number };
type Data = {
  actor_role: "RESPONSIBLE" | "MENTOR" | "STUDENT";
  content: (Item & { body: string; published_at: string | null })[];
  assignments: (Item & {
    instructions: string;
    max_score: number;
    submissions: Array<{
      id: string;
      enrollment_id: string;
      answer: string;
      status: string;
      score: number | null;
      row_version: number;
    }>;
  })[];
  exams: (Item & {
    max_score: number;
    results: Array<{
      id: string;
      enrollment_id: string;
      score: number;
      status: string;
      row_version: number;
    }>;
  })[];
  enrollments: Array<{
    enrollment_id: string;
    student_id: string;
    display_name: string;
  }>;
  weeks: Array<{
    id: string;
    week_number: number;
    title: string;
    cohort_name: string;
  }>;
};
export function LearningWorkspace({
  busy,
  actorRole,
  command,
}: {
  busy: boolean;
  actorRole: Data["actor_role"];
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [message, setMessage] = useState(""),
    [weekSummary, setWeekSummary] = useState<{
      status: string;
      row_version: number;
      coverage: number;
      score: number | null;
    } | null>(null),
    [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  async function load() {
    const result = await readJson<Data>("/api/v1/learning");
    setData(result.data);
  }
  useEffect(() => {
    void readJson<Data>("/api/v1/learning")
      .then((result) => setData(result.data))
      .catch(() => undefined);
  }, []);
  async function run(path: string, body: unknown, method = "POST") {
    const result = await command(path, body, method);
    await load();
    setMessage("تم تحديث مساحة التعلم.");
    return result;
  }
  const enrollment =
    data?.enrollments.find(
      (item) => item.enrollment_id === selectedEnrollmentId,
    ) ?? data?.enrollments[0];
  const weekId = data?.assignments[0]?.week_id ?? data?.exams[0]?.week_id;
  async function loadWeek() {
    if (!enrollment || !weekId) return;
    const result = await readJson<{
      summary: NonNullable<typeof weekSummary>;
      coverage: number;
      score: number | null;
    }>(`/api/v1/students/${enrollment.student_id}/weeks/${weekId}`);
    setWeekSummary(result.data.summary);
    setMessage(
      `تغطية الأسبوع ${Math.round(result.data.coverage * 100)}%${result.data.score === null ? "" : ` · الدرجة ${Math.round(result.data.score)}%`}`,
    );
  }
  return (
    <section className="panel table-panel learning-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">P4 · التعلم والأسبوع</span>
          <h2>المحتوى والتكاليف والاختبارات</h2>
        </div>
        <button type="button" className="secondary" onClick={() => void load()}>
          تحديث
        </button>
      </div>
      {message && <p className="notice">{message}</p>}
      {!data ? (
        <p className="empty">جارٍ تحميل مساحة التعلم…</p>
      ) : (
        <>
          {actorRole === "RESPONSIBLE" && (
            <LearningCreationPanel busy={busy} data={data} run={run} />
          )}
          {actorRole !== "STUDENT" && data.enrollments.length > 0 && (
            <label className="student-filter">
              الطالب الذي ستسجل له الدرجة
              <select
                value={enrollment?.enrollment_id ?? ""}
                onChange={(event) =>
                  setSelectedEnrollmentId(event.target.value)
                }
              >
                {data.enrollments.map((item) => (
                  <option key={item.enrollment_id} value={item.enrollment_id}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="learning-grid">
            <article>
              <h3>المحتوى</h3>
              {!data.content.length && (
                <p className="empty-inline">لا يوجد محتوى بعد.</p>
              )}
              {data.content.map((item) => (
                <div className="learning-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <span>{item.published_at ? "منشور" : "مسودة"}</span>
                  {actorRole !== "STUDENT" && !item.published_at && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(`/api/v1/content/${item.id}/publish`, {})
                      }
                    >
                      نشر المحتوى
                    </button>
                  )}
                </div>
              ))}
            </article>
            <article>
              <h3>التكليفات</h3>
              {!data.assignments.length && (
                <p className="empty-inline">
                  لا توجد تكليفات بعد. أضف أول تكليف من الأعلى.
                </p>
              )}
              {data.assignments.map((item) => (
                <div className="learning-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.instructions}</p>
                  {actorRole === "STUDENT" && enrollment && (
                    <SimpleForm
                      label="إرسال التكليف"
                      field="answer"
                      onSubmit={(value) =>
                        run(
                          `/api/v1/assignments/${item.id}/submission`,
                          {
                            enrollment_id: enrollment.enrollment_id,
                            answer: value,
                            row_version: null,
                            reason: null,
                          },
                          "PUT",
                        )
                      }
                    />
                  )}
                  {actorRole !== "STUDENT" &&
                    item.submissions.map((sub) => (
                      <SimpleForm
                        key={sub.id}
                        label={`تقييم تسليم: ${sub.answer}`}
                        field="score"
                        type="number"
                        onSubmit={(value) =>
                          run(`/api/v1/submissions/${sub.id}/review`, {
                            score: Number(value),
                            internal_notes: null,
                            student_feedback: "أحسنت، استمر.",
                            publish_feedback: true,
                            row_version: Number(sub.row_version),
                            reason: null,
                          })
                        }
                      />
                    ))}
                </div>
              ))}
            </article>
            <article>
              <h3>الاختبارات</h3>
              {!data.exams.length && (
                <p className="empty-inline">لا توجد اختبارات بعد.</p>
              )}
              {data.exams.map((item) => (
                <div className="learning-item" key={item.id}>
                  <strong>{item.title}</strong>
                  {actorRole !== "STUDENT" && enrollment && (
                    <SimpleForm
                      label="تسجيل الدرجة"
                      field="score"
                      type="number"
                      onSubmit={(value) =>
                        run(
                          `/api/v1/exams/${item.id}/results`,
                          {
                            enrollment_id: enrollment.enrollment_id,
                            score: Number(value),
                            internal_notes: null,
                            student_feedback: "نتيجة منشورة بعد الاعتماد.",
                            row_version: null,
                            reason: null,
                          },
                          "PUT",
                        )
                      }
                    />
                  )}{" "}
                  {actorRole !== "STUDENT" &&
                    item.results
                      .filter((r) => r.status === "DRAFT")
                      .map((result) => (
                        <button
                          key={result.id}
                          disabled={busy}
                          onClick={() =>
                            void run(
                              `/api/v1/exams/results/${result.id}/publish`,
                              { row_version: Number(result.row_version) },
                            )
                          }
                        >
                          نشر الدرجة
                        </button>
                      ))}
                </div>
              ))}
            </article>
            {actorRole === "STUDENT" && enrollment && data.assignments[0] && (
              <article>
                <h3>تقييمي الذاتي</h3>
                <SimpleForm
                  label="ماذا تعلمت هذا الأسبوع؟"
                  field="reflection"
                  onSubmit={(value) =>
                    run(
                      `/api/v1/me/weeks/${data.assignments[0].week_id}/self-review`,
                      {
                        enrollment_id: enrollment.enrollment_id,
                        rating: 5,
                        reflection: value,
                        row_version: null,
                      },
                      "PUT",
                    )
                  }
                />
              </article>
            )}
            {enrollment && weekId && (
              <article>
                <h3>ملخص الأسبوع</h3>
                <p>
                  يعرض التغطية والدرجة من الأدلة المكتملة ويحفظ لقطة ثابتة عند
                  الإغلاق. الإغلاق حتمي عند اكتمال البيانات.
                </p>
                <button type="button" onClick={() => void loadWeek()}>
                  عرض الملخص
                </button>
                {actorRole !== "STUDENT" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      await run(
                        `/api/v1/students/${enrollment.student_id}/weeks/${weekId}/finalize`,
                        {},
                      );
                      await loadWeek();
                    }}
                  >
                    إغلاق الأسبوع تلقائيًا
                  </button>
                )}
                {actorRole !== "STUDENT" &&
                  weekSummary?.status === "FINALIZED" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const reason =
                          typeof window !== "undefined"
                            ? (window.prompt(
                                "سبب التصحيح (3 محارف على الأقل):",
                              ) ?? "")
                            : "";
                        if (reason.trim().length < 3) return;
                        await run(
                          `/api/v1/students/${enrollment.student_id}/weeks/${weekId}/amend`,
                          {
                            row_version: Number(weekSummary.row_version),
                            reason: reason.trim(),
                          },
                        );
                        await loadWeek();
                      }}
                    >
                      تصحيح بعد الإغلاق
                    </button>
                  )}
                {weekSummary && (
                  <span>
                    {weekSummary.status} ·{" "}
                    {Math.round(weekSummary.coverage * 100)}%
                  </span>
                )}
              </article>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function LearningCreationPanel({
  busy,
  data,
  run,
}: {
  busy: boolean;
  data: Data;
  run: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const weeks = data.weeks ?? [];
  if (!weeks.length)
    return (
      <div className="action-empty">
        <strong>أطلق دفعة أولًا</strong>
        <p>بعد إنشاء الدفعة ستظهر أسابيعها هنا لإضافة المحتوى والتكاليف.</p>
      </div>
    );
  const submit = (
    event: FormEvent<HTMLFormElement>,
    path: string,
    build: (form: FormData) => unknown,
  ) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void run(path, build(form)).then((result) => {
      if (result) target.reset();
    });
  };
  const weekSelect = (name = "week_id") => (
    <label>
      الأسبوع
      <select name={name} required defaultValue="">
        <option value="" disabled>
          اختر الأسبوع
        </option>
        {weeks.map((week) => (
          <option key={week.id} value={week.id}>
            {week.cohort_name} · الأسبوع {week.week_number} · {week.title}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="learning-create">
      <div>
        <span className="section-kicker">إعداد الأسبوع</span>
        <h3>أضف المطلوب من الطلاب</h3>
        <p>اختر نوع العنصر والأسبوع، وسيظهر تلقائيًا للطلاب المسجلين.</p>
      </div>
      <details open>
        <summary>تكليف جديد</summary>
        <form
          className="compact-form"
          onSubmit={(event) =>
            submit(event, "/api/v1/assignments", (form) => ({
              week_id: form.get("week_id"),
              title: form.get("title"),
              instructions: form.get("instructions"),
              due_day_offset: Number(form.get("due_day_offset")),
              max_score: Number(form.get("max_score")),
              weight: 1,
            }))
          }
        >
          {weekSelect()}
          <label>
            عنوان التكليف
            <input name="title" required />
          </label>
          <label className="span-two">
            المطلوب
            <textarea name="instructions" rows={3} required />
          </label>
          <label>
            موعده داخل الأسبوع
            <select name="due_day_offset" defaultValue="5">
              <option value="0">اليوم الأول</option>
              <option value="1">اليوم الثاني</option>
              <option value="2">اليوم الثالث</option>
              <option value="3">اليوم الرابع</option>
              <option value="4">اليوم الخامس</option>
              <option value="5">اليوم السادس</option>
              <option value="6">اليوم السابع</option>
            </select>
          </label>
          <label>
            الدرجة القصوى
            <input
              name="max_score"
              type="number"
              min="1"
              defaultValue="10"
              required
            />
          </label>
          <button disabled={busy}>إضافة التكليف</button>
        </form>
      </details>
      <details>
        <summary>محتوى جديد</summary>
        <form
          className="compact-form"
          onSubmit={(event) =>
            submit(event, "/api/v1/content", (form) => ({
              week_id: form.get("week_id"),
              title: form.get("title"),
              body: form.get("body"),
            }))
          }
        >
          {weekSelect()}
          <label>
            العنوان
            <input name="title" required />
          </label>
          <label className="span-two">
            المحتوى
            <textarea name="body" rows={4} required />
          </label>
          <button disabled={busy}>حفظ كمسودة</button>
        </form>
      </details>
      <details>
        <summary>اختبار جديد</summary>
        <form
          className="compact-form"
          onSubmit={(event) =>
            submit(event, "/api/v1/exams", (form) => ({
              week_id: form.get("week_id"),
              title: form.get("title"),
              day_offset: Number(form.get("day_offset")),
              max_score: Number(form.get("max_score")),
              weight: 1,
            }))
          }
        >
          {weekSelect()}
          <label>
            عنوان الاختبار
            <input name="title" required />
          </label>
          <label>
            يوم الاختبار
            <select name="day_offset" defaultValue="6">
              <option value="0">اليوم الأول</option>
              <option value="1">اليوم الثاني</option>
              <option value="2">اليوم الثالث</option>
              <option value="3">اليوم الرابع</option>
              <option value="4">اليوم الخامس</option>
              <option value="5">اليوم السادس</option>
              <option value="6">اليوم السابع</option>
            </select>
          </label>
          <label>
            الدرجة القصوى
            <input
              name="max_score"
              type="number"
              min="1"
              defaultValue="20"
              required
            />
          </label>
          <button disabled={busy}>إضافة الاختبار</button>
        </form>
      </details>
    </div>
  );
}
function SimpleForm({
  label,
  field,
  type = "text",
  onSubmit,
}: {
  label: string;
  field: string;
  type?: string;
  onSubmit: (value: string) => Promise<unknown>;
}) {
  return (
    <form
      className="inline-form"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit(String(form.get(field)));
        event.currentTarget.reset();
      }}
    >
      <label>
        {label}
        <input name={field} type={type} required />
      </label>
      <button>حفظ</button>
    </form>
  );
}
