"use client";
import { useEffect, useState } from "react";

type TrackingItem = {
  enrollment_id: string;
  student_name: string;
  definition_id: string;
  name: string;
  meaning: string;
  unit: string | null;
  value_type: string;
  period_kind: "DAILY" | "WEEKLY";
  period_start: string;
  period_end: string;
  requires_review: boolean;
  status: string;
  entry: null | {
    id: string;
    value: unknown;
    source: string;
    current_version: number;
    review_status: string;
    row_version: number;
  };
};

function cairoDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function inputValue(item: TrackingItem, raw: FormDataEntryValue | null) {
  if (item.value_type === "BOOLEAN") return raw === "true";
  if (
    ["COUNT", "PERCENT", "SCORE", "DURATION", "NUMBER"].includes(
      item.value_type,
    )
  )
    return Number(raw);
  return String(raw ?? "");
}
const statusLabel: Record<string, string> = {
  MISSING: "غير مسجل",
  PENDING: "ينتظر المراجعة",
  VERIFIED: "متحقق",
  NEEDS_CORRECTION: "يحتاج تصحيحًا",
  NOT_REQUIRED: "مسجل",
  EXEMPT: "معفى",
};

export function TrackingWorkspace({
  busy,
  actorRole,
  command,
}: {
  busy: boolean;
  actorRole: string;
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/tracking/expected?from=${cairoDate()}&to=${cairoDate(7)}`,
        { cache: "no-store" },
      );
      if (response.ok) setItems((await response.json()).expected);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/tracking/expected?from=${cairoDate()}&to=${cairoDate(7)}`, {
      cache: "no-store",
    })
      .then(async (response) =>
        response.ok ? ((await response.json()).expected as TrackingItem[]) : [],
      )
      .then((expected) => {
        if (!cancelled) setItems(expected);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function save(item: TrackingItem, form: HTMLFormElement) {
    const data = new FormData(form);
    await command(
      "/api/v1/tracking/entries",
      {
        entries: [
          {
            enrollment_id: item.enrollment_id,
            definition_id: item.definition_id,
            period_start: item.period_start,
            period_end: item.period_end,
            state: "RECORDED",
            value: inputValue(item, data.get("value")),
            source: actorRole === "STUDENT" ? "STUDENT" : data.get("source"),
            occurred_at: new Date().toISOString(),
            exemption_reason: null,
            row_version: item.entry?.row_version ?? null,
            reason: item.entry ? "تصحيح موثق من واجهة التتبع" : null,
          },
        ],
      },
      "PUT",
    );
    await load();
  }
  async function review(
    item: TrackingItem,
    decision: "VERIFIED" | "NEEDS_CORRECTION",
  ) {
    if (!item.entry) return;
    await command(`/api/v1/tracking/entries/${item.entry.id}/reviews`, {
      entry_version: item.entry.current_version,
      row_version: item.entry.row_version,
      decision,
      reason:
        decision === "NEEDS_CORRECTION" ? "يرجى مراجعة القيمة المسجلة" : null,
    });
    await load();
  }
  return (
    <section className="panel table-panel tracking-workspace">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">التتبع والتدرّج</span>
          <h2>
            {actorRole === "STUDENT" ? "أورادي هذا الأسبوع" : "متابعة الطلاب"}
          </h2>
        </div>
        <span className="muted">اليوم والأيام السبعة القادمة</span>
      </div>
      {loading ? (
        <p className="empty">جارٍ حساب الاستحقاقات…</p>
      ) : items.length ? (
        <div className="tracking-grid">
          {items.map((item) => (
            <article
              key={`${item.enrollment_id}-${item.definition_id}-${item.period_start}`}
            >
              <header>
                <div>
                  <strong>{item.name}</strong>
                  {actorRole !== "STUDENT" && (
                    <small>{item.student_name}</small>
                  )}
                </div>
                <span
                  className={`tracking-status status-${item.status.toLowerCase()}`}
                >
                  {statusLabel[item.status] ?? item.status}
                </span>
              </header>
              <p>{item.meaning}</p>
              <small>
                {item.period_kind === "DAILY"
                  ? item.period_start
                  : `${item.period_start} — ${item.period_end}`}
              </small>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(item, event.currentTarget);
                }}
              >
                <label>
                  القيمة {item.unit && `(${item.unit})`}
                  {item.value_type === "BOOLEAN" ? (
                    <select
                      name="value"
                      defaultValue={String(item.entry?.value ?? "true")}
                    >
                      <option value="true">تم</option>
                      <option value="false">لم يتم</option>
                    </select>
                  ) : (
                    <input
                      name="value"
                      required
                      type={
                        [
                          "COUNT",
                          "PERCENT",
                          "SCORE",
                          "DURATION",
                          "NUMBER",
                        ].includes(item.value_type)
                          ? "number"
                          : "text"
                      }
                      defaultValue={
                        typeof item.entry?.value === "string" ||
                        typeof item.entry?.value === "number"
                          ? item.entry.value
                          : ""
                      }
                    />
                  )}
                </label>
                {actorRole !== "STUDENT" && (
                  <label>
                    المصدر
                    <select
                      name="source"
                      defaultValue={item.entry?.source ?? "MENTOR"}
                    >
                      <option value="MENTOR">المربي</option>
                      <option value="PAPER_TRANSCRIBED">تفريغ ورقي</option>
                    </select>
                  </label>
                )}
                <button disabled={busy}>
                  {item.entry ? "حفظ التصحيح" : "تسجيل"}
                </button>
              </form>
              {actorRole !== "STUDENT" &&
                item.entry?.review_status === "PENDING" && (
                  <div className="review-actions">
                    <button
                      disabled={busy}
                      onClick={() => void review(item, "VERIFIED")}
                    >
                      اعتماد
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void review(item, "NEEDS_CORRECTION")}
                    >
                      طلب تصحيح
                    </button>
                  </div>
                )}
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">لا توجد أوراد أو عادات مستحقة في هذه الفترة.</p>
      )}
    </section>
  );
}
