import type { ActorRole } from "./types";
import { readJson } from "./client";

type SessionSummary = {
  id: string;
  starts_at: string;
  status: string;
};

function cairoDate(offset = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function offlinePreloadPaths(
  role: ActorRole,
  sessions: SessionSummary[],
) {
  const common = [
    "/api/v1/me/today",
    "/api/v1/me/program",
    "/api/v1/me/progress",
    "/api/v1/learning",
    `/api/v1/tracking/expected?from=${cairoDate()}&to=${cairoDate(7)}`,
  ];
  const staff =
    role === "STUDENT"
      ? []
      : ["/api/v1/attention", "/api/v1/actions", "/api/v1/cases"];
  const responsible =
    role === "RESPONSIBLE"
      ? [
          "/api/v1/people",
          "/api/v1/today",
          "/api/v1/mentors",
          "/api/v1/audit-events?limit=6",
        ]
      : [];
  const sessionDetails = [...sessions]
    .sort((left, right) => {
      const priority = (status: string) =>
        status === "OPEN" ? 0 : status === "PLANNED" ? 1 : 2;
      return (
        priority(left.status) - priority(right.status) ||
        Date.parse(right.starts_at) - Date.parse(left.starts_at)
      );
    })
    .slice(0, 12)
    .map((session) => `/api/v1/sessions/${session.id}`);
  return [...new Set([...common, ...staff, ...responsible, ...sessionDetails])];
}

export async function warmOfflineDataset(
  scope: string,
  role: ActorRole,
  sessions: SessionSummary[],
) {
  const results = await Promise.allSettled(
    offlinePreloadPaths(role, sessions).map((path) =>
      readJson(path, { scope }),
    ),
  );
  const saved = results.filter(
    (result) => result.status === "fulfilled",
  ).length;
  const repository = (await import("./client")).deviceRepository();
  await repository.setMeta(`last-data-refresh:${scope}`, {
    completedAt: new Date().toISOString(),
    saved,
    total: results.length,
  });
  return { saved, total: results.length };
}
