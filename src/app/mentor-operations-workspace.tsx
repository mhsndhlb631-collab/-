"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { readJson } from "../offline/client";
import { QiwamIcon } from "./qiwam-icon";

type Student = {
  enrollment_id: string;
  student_id: string;
  display_name: string;
  group_id: string;
  group_name: string;
};
type Assignment = {
  id: string;
  group_id: string;
  title: string;
  category: string;
  custom_category: string | null;
  measurement_mode: string;
  starts_on: string;
  ends_on: string | null;
  max_score: number;
  pass_score: number | null;
  weight: number;
  occurrence_count: number;
  target_count: number;
  choices: Array<{ label: string; score: number }>;
  rubric: Array<{ label: string; max_score: number }>;
};
type Evaluation = {
  occurrence_id: string;
  assignment_definition_id: string;
  due_at: string;
  enrollment_id: string;
  evaluation_id: string | null;
  value: unknown;
  normalized_score: number | null;
  status: string | null;
  row_version: number | null;
};
type Overview = {
  groups: { id: string; name: string; cohort_name: string }[];
  assignments: Assignment[];
  students: Student[];
  evaluations: Evaluation[];
};
type Intelligence = {
  students: Array<
    Student & {
      evaluated_count: number;
      missing_count: number;
      average_score: number;
      classification: string;
      weaknesses: Array<{
        category: string;
        low_count: number;
        reason: string;
      }>;
      notes: Array<{
        body: string;
        visibility: string;
        created_at: string;
        assignment: string;
        author_name: string;
      }>;
      attendance_rate: number | null;
    }
  >;
  leaderboard: Array<{
    rank: number;
    student_id: string;
    display_name: string;
    group_name: string;
    score: number;
    evaluated_count: number;
  }>;
  alerts: Array<{
    kind: string;
    severity: string;
    student_id: string;
    student_name: string;
    count?: number;
    reason: string;
  }>;
  collective: Array<{
    group_id: string;
    group_name: string;
    category: string;
    affected: number;
    reason: string;
  }>;
};

const labels: Record<string, string> = {
  BOOLEAN: "نعم / لا",
  SCORE: "درجة",
  PERCENT: "نسبة مئوية",
  COUNT: "عدد",
  DURATION: "مدة",
  CHOICE: "اختيار",
  LEVEL: "مستوى",
  TEXT: "نص",
  ATTENDANCE: "حضور",
  RUBRIC: "معيار تقييم",
  DISTINGUISHED: "متميز",
  AVERAGE: "متوسط",
  NEEDS_SUPPORT: "يحتاج دعمًا",
  INSUFFICIENT_DATA: "بيانات غير كافية",
};

export function MentorOperationsWorkspace({
  busy,
  command,
}: {
  busy: boolean;
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [tab, setTab] = useState<
    "assignments" | "grade" | "students" | "attention" | "leaderboard"
  >("assignments");
  const [assignmentId, setAssignmentId] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [leaderboardFilter, setLeaderboardFilter] = useState({
    group_id: "",
    category: "",
    from: "",
    to: "",
  });
  async function load() {
    const [o, i] = await Promise.all([
      readJson<Overview>("/api/v1/mentor-operations"),
      readJson<Intelligence>("/api/v1/mentor-operations?view=intelligence"),
    ]);
    setOverview(o.data);
    setIntel(i.data);
  }
  async function loadFilteredIntelligence() {
    const query = new URLSearchParams({ view: "intelligence" });
    for (const [name, value] of Object.entries(leaderboardFilter))
      if (value) query.set(name, value);
    const result = await readJson<Intelligence>(
      `/api/v1/mentor-operations?${query.toString()}`,
    );
    setIntel(result.data);
  }
  useEffect(() => {
    void Promise.all([
      readJson<Overview>("/api/v1/mentor-operations"),
      readJson<Intelligence>("/api/v1/mentor-operations?view=intelligence"),
    ])
      .then(([operations, intelligence]) => {
        setOverview(operations.data);
        setIntel(intelligence.data);
      })
      .catch(() => undefined);
  }, []);
  const assignment =
    overview?.assignments.find((item) => item.id === assignmentId) ??
    overview?.assignments[0];
  const rows = useMemo(
    () =>
      overview?.evaluations.filter(
        (item) => item.assignment_definition_id === assignment?.id,
      ) ?? [],
    [overview, assignment],
  );
  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      f = new FormData(form);
    const start = String(f.get("starts_on"));
    const recurrence = String(f.get("recurrence"));
    const parseOptions = (raw: FormDataEntryValue | null) =>
      String(raw ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, score] = line.split(":");
          return { label: label.trim(), score: Number(score) };
        })
        .filter((item) => item.label && Number.isFinite(item.score));
    const rubric = parseOptions(f.get("rubric_criteria")).map((item) => ({
      label: item.label,
      max_score: item.score,
    }));
    await command("/api/v1/mentor-operations", {
      action: "CREATE_ASSIGNMENT",
      payload: {
        group_id: f.get("group_id"),
        title: f.get("title"),
        instructions: f.get("instructions"),
        category: f.get("category"),
        custom_category: String(f.get("custom_category") ?? "").trim() || null,
        scope: f.get("scope"),
        enrollment_ids: f.getAll("enrollment_ids"),
        measurement_mode: f.get("measurement_mode"),
        starts_on: start,
        ends_on: String(f.get("ends_on") ?? "") || null,
        due_time: String(f.get("due_time") ?? "") || null,
        timezone: "Africa/Cairo",
        recurrence: {
          kind: recurrence,
          weekdays: recurrence === "WEEKDAYS" ? [1, 2, 3, 4, 5] : [],
          times_per_week: recurrence === "TIMES_WEEKLY" ? 3 : null,
          dates: String(f.get("custom_dates") ?? "")
            .split(/[،,\s]+/)
            .map((date) => date.trim())
            .filter(Boolean),
        },
        mandatory: f.get("mandatory") === "on",
        requires_note: f.get("requires_note") === "on",
        requires_evidence: false,
        max_score: Number(f.get("max_score")),
        pass_score:
          String(f.get("pass_score") ?? "") === ""
            ? null
            : Number(f.get("pass_score")),
        weight: Number(f.get("weight")),
        completion_rules: {},
        choices: parseOptions(f.get("choice_options")),
        rubric,
      },
    });
    form.reset();
    await load();
  }
  async function saveGrades(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignment) return;
    const f = new FormData(event.currentTarget);
    const entries = rows
      .map((row) => {
        const raw = String(
          f.get(`value:${row.occurrence_id}:${row.enrollment_id}`) ?? "",
        );
        const note = String(
          f.get(`note:${row.occurrence_id}:${row.enrollment_id}`) ?? "",
        ).trim();
        let value: unknown = raw;
        if (assignment.measurement_mode === "BOOLEAN") value = raw === "true";
        else if (assignment.measurement_mode === "ATTENDANCE") value = raw;
        else if (assignment.measurement_mode === "RUBRIC") {
          const criteria = assignment.rubric.map((criterion, index) => ({
            label: criterion.label,
            score: Number(
              f.get(
                `rubric:${row.occurrence_id}:${row.enrollment_id}:${index}`,
              ) ?? 0,
            ),
            max_score: criterion.max_score,
          }));
          value = {
            score: criteria.reduce((sum, item) => sum + item.score, 0),
            criteria,
          };
        } else if (
          !["TEXT", "CHOICE", "LEVEL"].includes(assignment.measurement_mode)
        )
          value = raw === "" ? null : Number(raw);
        return {
          occurrence_id: row.occurrence_id,
          enrollment_id: row.enrollment_id,
          value,
          note: note || null,
          note_visibility: "STAFF",
          evidence_url: null,
          row_version: row.row_version ?? null,
          reason: row.row_version ? "تحديث تقييم الطالب" : null,
        };
      })
      .filter((entry) => entry.value !== null && entry.value !== "");
    if (!entries.length) return;
    await command("/api/v1/mentor-operations", {
      action: "SAVE_EVALUATIONS",
      payload: { assignment_id: assignment.id, entries },
    });
    await load();
  }
  const profile = intel?.students.find((s) => s.student_id === selectedStudent);
  return (
    <section className="mentor-ops" aria-labelledby="mentor-ops-title">
      <div className="workspace-hero compact-hero">
        <div>
          <span className="section-kicker">مساحة المربي</span>
          <h2 id="mentor-ops-title">التكاليف والتقييم الذكي</h2>
          <p>أنشئ التكليف، قيّم المجموعة، ثم تابع الأثر في ملف كل طالب.</p>
        </div>
        <div className="hero-counts">
          <span>
            <strong>{overview?.students.length ?? 0}</strong> طالب
          </span>
          <span>
            <strong>{intel?.alerts.length ?? 0}</strong> يحتاج متابعة
          </span>
        </div>
      </div>
      <div className="segmented mentor-tabs" role="tablist">
        {(
          [
            ["assignments", "التكاليف", "learning"],
            ["grade", "رصد الدرجات", "check"],
            ["students", "ملفات الطلاب", "people"],
            ["attention", "يحتاج انتباه", "bell"],
            ["leaderboard", "لوحة الأوائل", "progress"],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : "secondary"}
            onClick={() => setTab(id)}
            key={id}
          >
            <QiwamIcon name={icon} size={17} />
            {label}
          </button>
        ))}
      </div>
      {tab === "assignments" && (
        <div className="mentor-grid">
          <article className="panel">
            <span className="section-kicker">تكليف جديد</span>
            <h3>حدّد المطلوب وطريقة قياسه</h3>
            <form className="form-grid" onSubmit={createAssignment}>
              <label>
                المجموعة
                <select name="group_id" required>
                  <option value="">اختر</option>
                  {overview?.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.cohort_name} · {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                اسم التكليف
                <input name="title" required maxLength={160} />
              </label>
              <label>
                التصنيف
                <select name="category" required>
                  <option>عبادات</option>
                  <option>حضور</option>
                  <option>سلوك وآداب</option>
                  <option>تعلم</option>
                  <option>نشاط</option>
                  <option>أخرى</option>
                </select>
              </label>
              <label>
                نطاق التكليف
                <select name="scope" defaultValue="GROUP">
                  <option value="GROUP">كل المجموعة</option>
                  <option value="INDIVIDUAL">طلاب محددون</option>
                </select>
              </label>
              <label>
                الطلاب المحددون
                <select name="enrollment_ids" multiple size={4}>
                  {overview?.students.map((student) => (
                    <option
                      key={student.enrollment_id}
                      value={student.enrollment_id}
                    >
                      {student.display_name} · {student.group_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                تصنيف مخصص
                <input name="custom_category" maxLength={80} />
              </label>
              <label>
                نوع القياس
                <select name="measurement_mode" defaultValue="SCORE">
                  {Object.entries(labels)
                    .slice(0, 10)
                    .map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                التكرار
                <select name="recurrence" defaultValue="ONCE">
                  <option value="ONCE">مرة واحدة</option>
                  <option value="DAILY">يومي</option>
                  <option value="WEEKDAYS">أيام العمل</option>
                  <option value="WEEKLY">أسبوعي</option>
                  <option value="TIMES_WEEKLY">3 مرات أسبوعيًا</option>
                  <option value="RANGE">كل يوم خلال المدة</option>
                  <option value="CUSTOM">تواريخ مخصصة</option>
                </select>
              </label>
              <label>
                التواريخ المخصصة
                <textarea
                  name="custom_dates"
                  placeholder="2026-09-20, 2026-09-23"
                />
              </label>
              <label>
                يبدأ في
                <input name="starts_on" type="date" required />
              </label>
              <label>
                ينتهي في
                <input name="ends_on" type="date" />
              </label>
              <label>
                وقت الاستحقاق
                <input name="due_time" type="time" />
              </label>
              <label>
                الدرجة النهائية
                <input
                  name="max_score"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue="10"
                  required
                />
              </label>
              <label>
                درجة الاجتياز
                <input name="pass_score" type="number" min="0" step="0.01" />
              </label>
              <label>
                الوزن
                <input
                  name="weight"
                  type="number"
                  min="0"
                  step="0.1"
                  defaultValue="1"
                  required
                />
              </label>
              <label className="full">
                التعليمات
                <textarea
                  name="instructions"
                  minLength={1}
                  maxLength={5000}
                  required
                />
              </label>
              <label className="full">
                خيارات الاختيار أو المستوى{" "}
                <span className="optional">كل سطر: الاسم:الدرجة</span>
                <textarea
                  name="choice_options"
                  placeholder={"ممتاز:10\nجيد:7\nيحتاج تحسين:4"}
                />
              </label>
              <label className="full">
                معايير التقييم{" "}
                <span className="optional">كل سطر: المعيار:درجته النهائية</span>
                <textarea
                  name="rubric_criteria"
                  placeholder={"الالتزام:5\nالأدب:5"}
                />
              </label>
              <label className="check-row">
                <input name="mandatory" type="checkbox" defaultChecked />
                تكليف إلزامي
              </label>
              <label className="check-row">
                <input name="requires_note" type="checkbox" />
                الملاحظة مطلوبة عند التقييم
              </label>
              <button className="full" disabled={busy}>
                إنشاء التكليف
              </button>
            </form>
          </article>
          <article className="panel">
            <span className="section-kicker">الحالية</span>
            <h3>تكليفات مجموعاتك</h3>
            <div className="assignment-list">
              {overview?.assignments.length ? (
                overview.assignments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAssignmentId(a.id);
                      setTab("grade");
                    }}
                  >
                    <span>
                      <strong>{a.title}</strong>
                      <small>
                        {a.category} ·{" "}
                        {labels[a.measurement_mode] ?? a.measurement_mode}
                      </small>
                    </span>
                    <span>{a.occurrence_count} استحقاق</span>
                  </button>
                ))
              ) : (
                <p className="empty">لا توجد تكليفات بعد.</p>
              )}
            </div>
          </article>
        </div>
      )}
      {tab === "grade" && (
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">رصد جماعي</span>
              <h3>الدرجات والملاحظات</h3>
            </div>
            <select
              value={assignment?.id ?? ""}
              onChange={(e) => setAssignmentId(e.target.value)}
            >
              {overview?.assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          {assignment ? (
            <form onSubmit={saveGrades}>
              <div className="grade-table" role="table">
                <div className="grade-head" role="row">
                  <span>الطالب</span>
                  <span>الاستحقاق</span>
                  <span>القيمة / {assignment.max_score}</span>
                  <span>ملاحظة</span>
                </div>
                {rows.map((row) => {
                  const student = overview?.students.find(
                    (s) => s.enrollment_id === row.enrollment_id,
                  );
                  return (
                    <div
                      className="grade-row"
                      role="row"
                      key={`${row.occurrence_id}-${row.enrollment_id}`}
                    >
                      <strong>{student?.display_name}</strong>
                      <small>
                        {new Date(row.due_at).toLocaleDateString("ar-EG")}
                      </small>
                      {assignment.measurement_mode === "BOOLEAN" ? (
                        <select
                          name={`value:${row.occurrence_id}:${row.enrollment_id}`}
                          defaultValue={String(row.value ?? "")}
                        >
                          <option value="">—</option>
                          <option value="true">نعم</option>
                          <option value="false">لا</option>
                        </select>
                      ) : assignment.measurement_mode === "ATTENDANCE" ? (
                        <select
                          name={`value:${row.occurrence_id}:${row.enrollment_id}`}
                          defaultValue={String(row.value ?? "")}
                        >
                          <option value="">—</option>
                          <option value="PRESENT">حاضر</option>
                          <option value="LATE">متأخر</option>
                          <option value="ABSENT">غائب</option>
                          <option value="EXCUSED">بعذر</option>
                        </select>
                      ) : assignment.measurement_mode === "RUBRIC" ? (
                        <fieldset className="rubric-cell">
                          {assignment.rubric.map((criterion, index) => (
                            <label key={criterion.label}>
                              {criterion.label}
                              <input
                                name={`rubric:${row.occurrence_id}:${row.enrollment_id}:${index}`}
                                type="number"
                                min="0"
                                max={criterion.max_score}
                                step="0.01"
                              />
                            </label>
                          ))}
                        </fieldset>
                      ) : assignment.measurement_mode === "CHOICE" ||
                        assignment.measurement_mode === "LEVEL" ? (
                        <select
                          name={`value:${row.occurrence_id}:${row.enrollment_id}`}
                          defaultValue=""
                        >
                          <option value="">—</option>
                          {assignment.choices.map((option) => (
                            <option key={option.label} value={option.score}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          name={`value:${row.occurrence_id}:${row.enrollment_id}`}
                          type={
                            assignment.measurement_mode === "TEXT"
                              ? "text"
                              : "number"
                          }
                          step="0.01"
                          defaultValue={
                            typeof row.value === "number" ||
                            typeof row.value === "string"
                              ? String(row.value)
                              : ""
                          }
                        />
                      )}
                      <input
                        name={`note:${row.occurrence_id}:${row.enrollment_id}`}
                        placeholder="ملاحظة تحفظ في الملف"
                      />
                      {row.normalized_score !== null && (
                        <small className="score-gap">
                          المحقق{" "}
                          {Math.round(Number(row.normalized_score) * 100)}% ·
                          المتبقي{" "}
                          {Math.round(
                            (1 - Number(row.normalized_score)) *
                              Number(assignment.max_score) *
                              100,
                          ) / 100}
                        </small>
                      )}
                    </div>
                  );
                })}
              </div>
              <button disabled={busy || !rows.length}>
                حفظ التقييمات المدخلة
              </button>
            </form>
          ) : (
            <p className="empty">أنشئ تكليفًا أولًا.</p>
          )}
        </article>
      )}
      {tab === "students" && (
        <>
          <label className="student-filter">
            ابحث باسم الطالب أو المجموعة
            <input
              type="search"
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              placeholder="ابدأ الكتابة…"
            />
          </label>
          <div className="student-card-grid">
            {intel?.students
              .filter((student) =>
                `${student.display_name} ${student.group_name}`
                  .toLocaleLowerCase("ar")
                  .includes(studentSearch.trim().toLocaleLowerCase("ar")),
              )
              .map((s) => (
                <button
                  className="student-insight-card"
                  key={s.student_id}
                  onClick={() => setSelectedStudent(s.student_id)}
                >
                  <span
                    className={`classification ${s.classification.toLowerCase()}`}
                  >
                    {labels[s.classification]}
                  </span>
                  <strong>{s.display_name}</strong>
                  <small>{s.group_name}</small>
                  <b>{s.evaluated_count < 2 ? "—" : `${s.average_score}%`}</b>
                  <span>
                    {s.missing_count} تقييم ناقص · {s.weaknesses.length} نقطة
                    ضعف متكررة
                  </span>
                </button>
              ))}
          </div>
        </>
      )}
      {tab === "attention" && (
        <div className="attention-list">
          {(intel?.alerts.length ?? 0) + (intel?.collective.length ?? 0) > 0 ? (
            <>
              {intel?.collective.map((item) => (
                <div
                  className="collective-alert"
                  key={`${item.group_id}-${item.category}`}
                >
                  <QiwamIcon name="people" size={19} />
                  <span>
                    <strong>{item.group_name}</strong>
                    <small>{item.reason}</small>
                  </span>
                </div>
              ))}
              {intel?.alerts.map((a, i) => (
                <button
                  key={`${a.kind}-${a.student_id}-${i}`}
                  onClick={() => {
                    setSelectedStudent(a.student_id);
                    setTab("students");
                  }}
                >
                  <QiwamIcon name="bell" size={19} />
                  <span>
                    <strong>{a.student_name}</strong>
                    <small>{a.reason}</small>
                  </span>
                  <QiwamIcon name="caret-left" size={16} />
                </button>
              ))}
            </>
          ) : (
            <div className="illustrated-empty">
              <strong>لا يوجد نقص عاجل</strong>
              <p>ستظهر هنا الدرجات الناقصة ونقاط الضعف المتكررة.</p>
            </div>
          )}
        </div>
      )}
      {tab === "leaderboard" && (
        <article className="panel leaderboard">
          <span className="section-kicker">ترتيب عادل</span>
          <h3>لوحة الأوائل</h3>
          <p className="muted">
            يدخل الترتيب من لديه تقييمان مكتملان على الأقل، وتحسب النتيجة كنسبة
            موحّدة.
          </p>
          <form
            className="compact-form leaderboard-filters"
            onSubmit={(event) => {
              event.preventDefault();
              void loadFilteredIntelligence();
            }}
          >
            <label>
              المجموعة
              <select
                value={leaderboardFilter.group_id}
                onChange={(event) =>
                  setLeaderboardFilter((current) => ({
                    ...current,
                    group_id: event.target.value,
                  }))
                }
              >
                <option value="">كل المجموعات</option>
                {overview?.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              التصنيف
              <input
                value={leaderboardFilter.category}
                onChange={(event) =>
                  setLeaderboardFilter((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                placeholder="مثل: عبادات"
              />
            </label>
            <label>
              من
              <input
                type="date"
                value={leaderboardFilter.from}
                onChange={(event) =>
                  setLeaderboardFilter((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              إلى
              <input
                type="date"
                value={leaderboardFilter.to}
                onChange={(event) =>
                  setLeaderboardFilter((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
              />
            </label>
            <button disabled={busy}>تطبيق الفلاتر</button>
          </form>
          {intel?.leaderboard.map((r) => (
            <div key={r.student_id}>
              <b>{r.rank}</b>
              <span>
                <strong>{r.display_name}</strong>
                <small>
                  {r.group_name} · {r.evaluated_count} تقييمات
                </small>
              </span>
              <em>{r.score}%</em>
            </div>
          ))}
        </article>
      )}
      {profile && (
        <div
          className="profile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`ملف ${profile.display_name}`}
        >
          <button
            className="drawer-scrim"
            onClick={() => setSelectedStudent(null)}
            aria-label="إغلاق"
          />
          <article>
            <button
              className="icon-button"
              onClick={() => setSelectedStudent(null)}
              aria-label="إغلاق"
            >
              <QiwamIcon name="close" size={18} />
            </button>
            <span className="section-kicker">ملف الطالب</span>
            <h3>{profile.display_name}</h3>
            <p>{profile.group_name}</p>
            <div className="profile-kpis">
              <span>
                <b>
                  {profile.evaluated_count < 2
                    ? "—"
                    : `${profile.average_score}%`}
                </b>
                المستوى
              </span>
              <span>
                <b>{profile.missing_count}</b>ناقص
              </span>
              <span>
                <b>{profile.weaknesses.length}</b>يحتاج متابعة
              </span>
              <span>
                <b>
                  {profile.attendance_rate === null
                    ? "—"
                    : `${profile.attendance_rate}%`}
                </b>
                الحضور
              </span>
            </div>
            <h4>نقاط المتابعة المثبتة</h4>
            {profile.weaknesses.length ? (
              profile.weaknesses.map((w) => (
                <div className="weakness" key={w.category}>
                  <strong>{w.category}</strong>
                  <small>
                    {w.reason} · {w.low_count} مرات
                  </small>
                </div>
              ))
            ) : (
              <p className="empty">
                لا توجد نقطة ضعف متكررة مثبتة، أو البيانات غير كافية.
              </p>
            )}
            <h4>سجل الملاحظات</h4>
            {profile.notes?.length ? (
              profile.notes.map((note, index) => (
                <div className="weakness" key={`${note.created_at}-${index}`}>
                  <strong>{note.assignment}</strong>
                  <small>
                    {note.body} · {note.author_name} ·{" "}
                    {new Date(note.created_at).toLocaleDateString("ar-EG")}
                  </small>
                </div>
              ))
            ) : (
              <p className="empty">لا توجد ملاحظات محفوظة بعد.</p>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
