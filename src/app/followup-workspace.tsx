"use client";
import { useEffect, useState } from "react";

type Attention = {
  id: string;
  student_name: string;
  rule_code: string;
  status: string;
  due_at: string;
  row_version: number;
};
type Action = {
  id: string;
  title: string;
  status: string;
  due_at: string;
  row_version: number;
};
type CaseItem = {
  id: string;
  title: string;
  priority: string;
  status: string;
  row_version: number;
};
export function FollowupWorkspace({
  busy,
  command,
}: {
  busy: boolean;
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [attentions, setAttentions] = useState<Attention[]>([]),
    [actions, setActions] = useState<Action[]>([]),
    [cases, setCases] = useState<CaseItem[]>([]);
  async function load() {
    const responses = await Promise.all([
      fetch("/api/v1/attention", { cache: "no-store" }),
      fetch("/api/v1/actions", { cache: "no-store" }),
      fetch("/api/v1/cases", { cache: "no-store" }),
    ]);
    if (responses.every((r) => r.ok)) {
      setAttentions((await responses[0].json()).attentions);
      setActions((await responses[1].json()).actions);
      setCases((await responses[2].json()).cases);
    }
  }
  useEffect(() => {
    void Promise.all([
      fetch("/api/v1/attention", { cache: "no-store" }),
      fetch("/api/v1/actions", { cache: "no-store" }),
      fetch("/api/v1/cases", { cache: "no-store" }),
    ]).then(async (responses) => {
      if (responses.every((response) => response.ok)) {
        setAttentions((await responses[0].json()).attentions);
        setActions((await responses[1].json()).actions);
        setCases((await responses[2].json()).cases);
      }
    });
  }, []);
  async function act(path: string, body: unknown) {
    await command(path, body);
    await load();
  }
  return (
    <section className="panel table-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">المتابعة</span>
          <h2>الانتباه والإجراءات والحالات</h2>
        </div>
        <button
          disabled={busy}
          onClick={() => void act("/api/v1/attention/evaluate", {})}
        >
          تحديث الانتباه
        </button>
      </div>
      <div className="workspace-grid">
        <article>
          <h3>الانتباه</h3>
          {attentions.length ? (
            attentions.map((item) => (
              <div className="record-card" key={item.id}>
                <strong>{item.student_name}</strong>
                <span>
                  {item.rule_code} · {item.status}
                </span>
                <small>{new Date(item.due_at).toLocaleString("ar-EG")}</small>
                {item.status === "OPEN" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(`/api/v1/attention/${item.id}/claim`, {
                        row_version: item.row_version,
                      })
                    }
                  >
                    استلام
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="empty">لا توجد تنبيهات ضمن نطاقك.</p>
          )}
        </article>
        <article>
          <h3>الإجراءات</h3>
          {actions.length ? (
            actions.map((item) => (
              <div className="record-card" key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.status}</span>
                <small>{new Date(item.due_at).toLocaleString("ar-EG")}</small>
              </div>
            ))
          ) : (
            <p className="empty">لا توجد إجراءات.</p>
          )}
        </article>
        <article>
          <h3>الحالات</h3>
          {cases.length ? (
            cases.map((item) => (
              <div className="record-card" key={item.id}>
                <strong>{item.title}</strong>
                <span>
                  {item.priority} · {item.status}
                </span>
              </div>
            ))
          ) : (
            <p className="empty">لا توجد حالات مفتوحة.</p>
          )}
        </article>
      </div>
    </section>
  );
}
