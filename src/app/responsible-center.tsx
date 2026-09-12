"use client";
import { FormEvent, useEffect, useState } from "react";
import { readJson } from "../offline/client";

type Today = {
  counts: {
    active_attentions: number;
    overdue_actions: number;
    overdue_sessions: number;
    open_cases: number;
  };
  attentions: {
    id: string;
    student_name: string;
    rule_code: string;
    due_at: string;
  }[];
  actions: {
    id: string;
    student_name: string;
    title: string;
    due_at: string;
  }[];
  sessions: { id: string; name: string; group_name: string; ends_at: string }[];
  cases: {
    id: string;
    student_name: string;
    title: string;
    priority: string;
  }[];
};
type Mentor = {
  id: string;
  display_name: string;
  group_count: number;
  active_attention_count: number;
  open_case_count: number;
};
type Dimension = {
  weight: number;
  opportunities: number;
  achieved: number;
  score: number | null;
  applicable: boolean;
};
type Performance = {
  mentor: Mentor;
  score: number | null;
  opportunity_count: number;
  data_state: string;
  dimensions: Record<string, Dimension>;
  evidence: Record<
    string,
    {
      resource_type: string;
      resource_id: string;
      due_at: string;
      achieved: boolean;
    }[]
  >;
};
const labels: Record<string, string> = {
  operational: "الالتزام التشغيلي",
  followup: "المتابعة",
  data: "اكتمال البيانات",
  case_response: "الاستجابة للحالات",
};
function cairoDate(offset = 0) {
  const date = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function ResponsibleCenter() {
  const [today, setToday] = useState<Today | null>(null),
    [mentors, setMentors] = useState<Mentor[]>([]),
    [performance, setPerformance] = useState<Performance | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const [todayResponse, mentorsResponse] = await Promise.all([
      readJson<Today>("/api/v1/today"),
      readJson<{ mentors: Mentor[] }>("/api/v1/mentors"),
    ]);
    setToday(todayResponse.data);
    setMentors(mentorsResponse.data.mentors);
  }
  useEffect(() => {
    void Promise.all([
      readJson<Today>("/api/v1/today"),
      readJson<{ mentors: Mentor[] }>("/api/v1/mentors"),
    ])
      .then(([todayResponse, mentorsResponse]) => {
        setToday(todayResponse.data);
        setMentors(mentorsResponse.data.mentors);
      })
      .catch(() => undefined);
  }, []);
  async function loadPerformance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget),
      mentor = String(form.get("mentor")),
      from = String(form.get("from")),
      to = String(form.get("to"));
    try {
      const response = await fetch(
          `/api/v1/mentors/${mentor}/performance?from=${from}&to=${to}`,
          { cache: "no-store" },
        ),
        result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setPerformance(result);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حساب الأداء.");
    } finally {
      setBusy(false);
    }
  }
  async function downloadMentor() {
    if (!performance) return;
    setBusy(true);
    try {
      const from = cairoDate(-6),
        to = cairoDate(),
        response = await fetch(
          `/api/v1/reports/export?report_type=MENTOR_WEEK&format=CSV&subject_id=${performance.mentor.id}&from=${from}&to=${to}`,
          { cache: "no-store" },
        ),
        result = await response.json();
      if (!response.ok) throw new Error(result.message);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([result.content], { type: result.mime_type }),
      );
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage("تم إنشاء التصدير وتسجيله في التدقيق.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر التصدير.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="responsible-center" aria-labelledby="responsible-title">
      <header className="center-hero">
        <div>
          <span className="section-kicker">مركز المسؤول</span>
          <h2 id="responsible-title">ما يحتاج تدخلك اليوم</h2>
          <p>المؤشرات مرتبطة بالسجلات الفعلية، ويمكن فتح أدلة كل نتيجة.</p>
        </div>
        <button className="secondary" onClick={() => void refresh()}>
          تحديث
        </button>
      </header>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="center-kpis">
        {Object.entries({
          active_attentions: "تنبيهات نشطة",
          overdue_actions: "إجراءات متأخرة",
          overdue_sessions: "جلسات غير مغلقة",
          open_cases: "حالات مفتوحة",
        }).map(([key, label]) => (
          <article key={key}>
            <strong>
              {today?.counts[key as keyof Today["counts"]] ?? "—"}
            </strong>
            <span>{label}</span>
          </article>
        ))}
      </div>
      <div className="center-columns">
        <article className="panel">
          <h3>النواقص ذات الأولوية</h3>
          {today &&
          today.attentions.length +
            today.actions.length +
            today.sessions.length ? (
            <div className="evidence-list">
              {today.attentions.slice(0, 4).map((item) => (
                <div key={item.id}>
                  <strong>{item.student_name}</strong>
                  <span>{item.rule_code}</span>
                  <small>{new Date(item.due_at).toLocaleString("ar-EG")}</small>
                </div>
              ))}
              {today.actions.slice(0, 4).map((item) => (
                <div key={item.id}>
                  <strong>{item.student_name}</strong>
                  <span>{item.title}</span>
                  <small>{new Date(item.due_at).toLocaleString("ar-EG")}</small>
                </div>
              ))}
              {today.sessions.slice(0, 4).map((item) => (
                <div key={item.id}>
                  <strong>{item.group_name}</strong>
                  <span>{item.name}</span>
                  <small>
                    {new Date(item.ends_at).toLocaleString("ar-EG")}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">لا توجد نواقص متأخرة الآن.</p>
          )}
        </article>
        <article className="panel">
          <h3>حالات الفريق</h3>
          {today?.cases.length ? (
            <div className="evidence-list">
              {today.cases.slice(0, 8).map((item) => (
                <div key={item.id}>
                  <strong>{item.student_name}</strong>
                  <span>{item.title}</span>
                  <small>{item.priority}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">لا توجد حالات مفتوحة.</p>
          )}
        </article>
      </div>
      <article className="panel performance-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">الأداء</span>
            <h3>أداء المربي المبني على الفرص</h3>
          </div>
          {performance && (
            <button disabled={busy} onClick={() => void downloadMentor()}>
              تصدير CSV
            </button>
          )}
        </div>
        <form className="performance-filters" onSubmit={loadPerformance}>
          <label>
            المربي
            <select name="mentor" required defaultValue="">
              <option value="" disabled>
                اختر مربيًا
              </option>
              {mentors.map((mentor) => (
                <option key={mentor.id} value={mentor.id}>
                  {mentor.display_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            من
            <input
              name="from"
              type="date"
              defaultValue={cairoDate(-6)}
              required
            />
          </label>
          <label>
            إلى
            <input name="to" type="date" defaultValue={cairoDate()} required />
          </label>
          <button disabled={busy}>
            {busy ? "جارٍ الحساب…" : "احسب الأداء"}
          </button>
        </form>
        {performance && (
          <div className="performance-result">
            <div
              className="score-ring"
              aria-label={`النتيجة ${performance.score ?? "لا توجد"}`}
            >
              <strong>
                {performance.score == null
                  ? "—"
                  : Math.round(performance.score)}
              </strong>
              <span>من 100</span>
            </div>
            <div className="dimension-grid">
              {Object.entries(performance.dimensions).map(
                ([name, dimension]) => (
                  <details key={name}>
                    <summary>
                      <span>
                        {labels[name]} · {dimension.weight}%
                      </span>
                      <strong>
                        {dimension.score == null
                          ? "غير منطبق"
                          : `${dimension.score}%`}
                      </strong>
                    </summary>
                    <div className="meter">
                      <i style={{ width: `${dimension.score ?? 0}%` }} />
                    </div>
                    <p>
                      {dimension.achieved} مكتملة من {dimension.opportunities}{" "}
                      فرصة
                    </p>
                    <ul>
                      {performance.evidence[name].map((item) => (
                        <li
                          key={item.resource_id}
                          className={
                            item.achieved ? "evidence-pass" : "evidence-miss"
                          }
                        >
                          {item.resource_type} ·{" "}
                          {new Date(item.due_at).toLocaleString("ar-EG")} ·{" "}
                          {item.achieved ? "في الموعد" : "غير مكتمل في الموعد"}
                        </li>
                      ))}
                    </ul>
                  </details>
                ),
              )}
            </div>
            <p className="data-state">
              {performance.data_state === "NO_EVALUATION_DATA"
                ? "لا توجد بيانات تقييم"
                : performance.data_state === "LIMITED_DATA"
                  ? "بيانات محدودة — النتيجة استرشادية"
                  : `استنادًا إلى ${performance.opportunity_count} فرصة تقييم`}
            </p>
          </div>
        )}
      </article>
    </section>
  );
}
