"use client";
import { useEffect, useState } from "react";

type Journey = {
  role: string;
  date?: string;
  counts?: Record<string, number | undefined>;
  cohorts?: { id: string; name: string; status: string }[];
  groups?: { id: string; name: string; cohort_name: string }[];
  weeks?: {
    id?: string;
    week_number?: number;
    title?: string;
    coverage?: number;
    score?: number | null;
    status?: string;
  }[];
  tracking_recorded?: number;
  published_exams?: number;
  sessions_closed?: number;
  actions_open?: number;
  entries_reviewed?: number;
};

const countLabels: Record<string, string> = {
  sessions: "جلسات اليوم",
  tracking: "سجلات التتبع",
  assignments: "تكليفات البرنامج",
  attentions: "تحتاج انتباهًا",
  actions: "إجراءات مفتوحة",
  tracking_recorded: "قيم مسجلة",
  published_exams: "نتائج منشورة",
  sessions_closed: "جلسات مكتملة",
  actions_open: "إجراءات قيد العمل",
  entries_reviewed: "قيم تمت مراجعتها",
};

export function JourneyPanel({
  kind,
}: {
  kind: "today" | "program" | "progress";
}) {
  const [data, setData] = useState<Journey | null>(null),
    [error, setError] = useState("");
  async function load() {
    setError("");
    const response = await fetch(`/api/v1/me/${kind}`, { cache: "no-store" });
    if (!response.ok) {
      setError("تعذر تحميل البيانات. حاول مرة أخرى.");
      return;
    }
    setData(await response.json());
  }
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/me/${kind}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        return (await response.json()) as Journey;
      })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError("تعذر تحميل البيانات. حاول مرة أخرى.");
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  const numeric = data
    ? Object.entries({
        ...(data.counts ?? {}),
        tracking_recorded: data.tracking_recorded,
        published_exams: data.published_exams,
        sessions_closed: data.sessions_closed,
        actions_open: data.actions_open,
        entries_reviewed: data.entries_reviewed,
      }).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      )
    : [];
  return (
    <section
      className="panel table-panel journey-panel"
      aria-busy={!data && !error}
    >
      <div className="panel-heading">
        <div>
          <span className="section-kicker">مساحتي</span>
          <h2>
            {kind === "today"
              ? "اليوم"
              : kind === "program"
                ? "البرنامج"
                : "التقدم"}
          </h2>
        </div>
        <button type="button" className="secondary" onClick={() => void load()}>
          تحديث
        </button>
      </div>
      {error ? (
        <div className="empty-state" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            إعادة المحاولة
          </button>
        </div>
      ) : !data ? (
        <p className="empty" role="status">
          جارٍ التحميل…
        </p>
      ) : (
        <>
          {numeric.length > 0 && (
            <div className="journey-metrics">
              {numeric.map(([key, value]) => (
                <article key={key}>
                  <strong>{value}</strong>
                  <span>{countLabels[key] ?? key}</span>
                </article>
              ))}
            </div>
          )}
          {kind === "program" && (
            <div className="journey-lists">
              <article>
                <h3>الدفعات المتاحة</h3>
                {data.cohorts?.length ? (
                  data.cohorts.map((item) => (
                    <p key={item.id}>
                      <strong>{item.name}</strong> · {item.status}
                    </p>
                  ))
                ) : (
                  <p className="muted">لا توجد دفعات متاحة.</p>
                )}
              </article>
              <article>
                <h3>المجموعات</h3>
                {data.groups?.length ? (
                  data.groups.map((item) => (
                    <p key={item.id}>
                      <strong>{item.name}</strong> · {item.cohort_name}
                    </p>
                  ))
                ) : (
                  <p className="muted">لا توجد مجموعات متاحة.</p>
                )}
              </article>
              <article>
                <h3>أسابيع البرنامج</h3>
                {data.weeks?.length ? (
                  data.weeks.map((item, index) => (
                    <p key={item.id ?? index}>
                      الأسبوع {item.week_number} · {item.title}
                    </p>
                  ))
                ) : (
                  <p className="muted">لا توجد أسابيع منشورة.</p>
                )}
              </article>
            </div>
          )}
          {kind === "progress" && data.weeks && (
            <div className="journey-lists">
              <article>
                <h3>ملخص الأسابيع</h3>
                {data.weeks.length ? (
                  data.weeks.map((item, index) => (
                    <p key={item.id ?? index}>
                      تغطية {Math.round((item.coverage ?? 0) * 100)}%
                      {item.score === null || item.score === undefined
                        ? ""
                        : ` · نتيجة ${Math.round(item.score)}%`}
                    </p>
                  ))
                ) : (
                  <p className="muted">لا توجد أسابيع مغلقة بعد.</p>
                )}
              </article>
            </div>
          )}
        </>
      )}
    </section>
  );
}
