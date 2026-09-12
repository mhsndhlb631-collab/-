"use client";

import { FormEvent, useEffect, useState } from "react";
import type { PeopleData } from "./people-workspace";
import { readJson } from "../offline/client";

type Cohort = {
  id: string;
  name: string;
  groups: { id: string; name: string }[];
};

export function DistributionWorkspace({
  busy,
  cohorts,
  command,
}: {
  busy: boolean;
  cohorts: Cohort[];
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [people, setPeople] = useState<PeopleData | null>(null);
  async function load() {
    const result = await readJson<PeopleData>("/api/v1/people");
    setPeople(result.data);
  }
  useEffect(() => {
    void readJson<PeopleData>("/api/v1/people")
      .then((result) => setPeople(result.data))
      .catch(() => undefined);
  }, []);
  const groups = cohorts.flatMap((cohort) =>
    cohort.groups.map((group) => ({
      ...group,
      cohort_id: cohort.id,
      cohort_name: cohort.name,
    })),
  );
  const availableStudents =
    people?.students.filter((student) => !student.enrollment_id) ?? [];
  const ready = groups.length > 0;
  async function submit(
    event: FormEvent<HTMLFormElement>,
    kind: "student" | "mentor",
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const group = groups.find((item) => item.id === fields.get("group_id"));
    if (!group) return;
    const result =
      kind === "student"
        ? await command("/api/v1/enrollments", {
            student_profile_id: fields.get("student_profile_id"),
            cohort_id: group.cohort_id,
            group_id: group.id,
            effective_from: new Date().toISOString(),
          })
        : await command("/api/v1/mentor-assignments", {
            mentor_person_id: fields.get("mentor_person_id"),
            group_id: group.id,
            effective_at: new Date().toISOString(),
          });
    if (!result) return;
    form.reset();
    await load();
  }
  return (
    <section
      className="panel table-panel distribution-panel"
      aria-labelledby="distribution-title"
    >
      <div className="panel-heading">
        <div>
          <span className="section-kicker">04 · التوزيع</span>
          <h2 id="distribution-title">وزّع الطلاب والمربين</h2>
        </div>
        <span className="muted">كل شخص يظهر في جلسته بعد إسناده</span>
      </div>
      {!ready ? (
        <div className="action-empty">
          <strong>أنشئ دفعة ومجموعة أولًا</strong>
          <p>بعد إطلاق الدفعة ستظهر المجموعات هنا للتوزيع.</p>
        </div>
      ) : (
        <div className="distribution-grid">
          <form
            className="stack"
            onSubmit={(event) => void submit(event, "student")}
          >
            <h3>إضافة طالب إلى مجموعة</h3>
            <label>
              الطالب
              <select name="student_profile_id" required defaultValue="">
                <option value="" disabled>
                  اختر طالبًا
                </option>
                {availableStudents.map((person) => (
                  <option
                    key={person.student_profile_id}
                    value={person.student_profile_id!}
                  >
                    {person.display_name}
                  </option>
                ))}
              </select>
            </label>
            <GroupSelect groups={groups} />
            <button disabled={busy || availableStudents.length === 0}>
              {availableStudents.length
                ? "إضافة إلى المجموعة"
                : "كل الطلاب موزعون"}
            </button>
          </form>
          <form
            className="stack"
            onSubmit={(event) => void submit(event, "mentor")}
          >
            <h3>إسناد مربي إلى مجموعة</h3>
            <label>
              المربي
              <select name="mentor_person_id" required defaultValue="">
                <option value="" disabled>
                  اختر مربيًا
                </option>
                {people?.mentors.map((person) => (
                  <option key={person.person_id} value={person.person_id}>
                    {person.display_name}
                  </option>
                ))}
              </select>
            </label>
            <GroupSelect groups={groups} />
            <button disabled={busy || !people?.mentors.length}>
              إسناد المربي
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function GroupSelect({
  groups,
}: {
  groups: Array<{ id: string; name: string; cohort_name: string }>;
}) {
  return (
    <label>
      المجموعة
      <select name="group_id" required defaultValue="">
        <option value="" disabled>
          اختر مجموعة
        </option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.cohort_name} · {group.name}
          </option>
        ))}
      </select>
    </label>
  );
}
