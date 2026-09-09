"use client";
import { FormEvent, useEffect, useState } from "react";

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
  enrollments: Array<{ enrollment_id: string; student_id: string }>;
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
    } | null>(null);
  async function load() {
    const response = await fetch("/api/v1/learning", { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }
  useEffect(() => {
    void fetch("/api/v1/learning", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (result) setData(result);
      });
  }, []);
  async function run(path: string, body: unknown, method = "POST") {
    const result = await command(path, body, method);
    await load();
    setMessage("تم تحديث مساحة التعلم.");
    return result;
  }
  const enrollment = data?.enrollments[0];
  const weekId = data?.assignments[0]?.week_id ?? data?.exams[0]?.week_id;
  async function loadWeek() {
    if (!enrollment || !weekId) return;
    const response = await fetch(
      `/api/v1/students/${enrollment.student_id}/weeks/${weekId}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const result = await response.json();
    setWeekSummary(result.summary);
    setMessage(
      `تغطية الأسبوع ${Math.round(result.coverage * 100)}%${result.score === null ? "" : ` · الدرجة ${Math.round(result.score)}%`}`,
    );
  }
  return (
    <section className="panel table-panel learning-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">P4 · التعلم والأسبوع</span>
          <h2>المحتوى والتكليفات والاختبارات</h2>
        </div>
        <button type="button" className="secondary" onClick={() => void load()}>
          تحديث
        </button>
      </div>
      {message && <p className="notice">{message}</p>}
      {!data ? (
        <p className="empty">جارٍ تحميل مساحة التعلم…</p>
      ) : (
        <div className="learning-grid">
          <article>
            <h3>المحتوى</h3>
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
                الاعتماد.
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
                      `/api/v1/students/${enrollment.student_id}/weeks/${weekId}/ready`,
                      {},
                    );
                    await loadWeek();
                  }}
                >
                  تجهيز للاعتماد
                </button>
              )}
              {actorRole !== "STUDENT" && weekSummary?.status === "READY" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await run(
                      `/api/v1/students/${enrollment.student_id}/weeks/${weekId}/approve`,
                      {
                        row_version: Number(weekSummary.row_version),
                        reason: null,
                      },
                    );
                    await loadWeek();
                  }}
                >
                  اعتماد الأسبوع
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
      )}
    </section>
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
