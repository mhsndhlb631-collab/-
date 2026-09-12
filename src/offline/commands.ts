import { activeScopeId, connectivity, deviceRepository } from "./client";
import type { OfflineOperation, QueuedMutation } from "./types";

export type CommandResult = Record<string, unknown> & {
  queued_offline?: boolean;
  device_mutation_id?: string;
};

export class CommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

function pathId(path: string, segment: string) {
  const parts = new URL(path, "https://minhaj.local").pathname.split("/");
  const index = parts.indexOf(segment);
  return index >= 0 ? (parts[index + 1] ?? null) : null;
}

function firstRowVersion(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  if (
    "row_version" in value &&
    typeof (value as { row_version?: unknown }).row_version === "number"
  )
    return (value as { row_version: number }).row_version;
  for (const nested of Object.values(value)) {
    const version = firstRowVersion(nested);
    if (version !== null) return version;
  }
  return null;
}

function mutationIdentity(path: string, mutationId: string) {
  if (path.includes("/sessions/"))
    return { entityType: "session", entityId: pathId(path, "sessions")! };
  if (path.includes("/tracking/entries"))
    return {
      entityType: "tracking_entry",
      entityId: pathId(path, "entries") ?? mutationId,
    };
  if (path.includes("/assignments/"))
    return {
      entityType: "assignment_submission",
      entityId: pathId(path, "assignments")!,
    };
  if (path.includes("/students/") && path.includes("/followups"))
    return { entityType: "followup", entityId: mutationId };
  for (const entityType of ["attention", "actions", "cases"] as const) {
    if (path.includes(`/${entityType}`))
      return {
        entityType: entityType === "actions" ? "action" : entityType,
        entityId: pathId(path, entityType) ?? mutationId,
      };
  }
  return { entityType: "domain_command", entityId: mutationId };
}

function operation(method: string, path: string): OfflineOperation {
  if (method === "DELETE") return "DELETE";
  if (method === "PUT" || method === "PATCH") return "UPDATE";
  return path.match(
    /\/(open|close|cancel|publish|review|resolve|claim|snooze)$/,
  )
    ? "COMMAND"
    : "CREATE";
}

function commandName(method: string, path: string) {
  return `${method}_${new URL(path, "https://minhaj.local").pathname
    .replace(/^\/api\/v1\//, "")
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase()}`;
}

async function applySessionOptimism(
  scope: string,
  path: string,
  body: unknown,
) {
  const sessionId = pathId(path, "sessions");
  if (!sessionId) return;
  const recordBody = body as {
    records?: Array<{
      roster_id: string;
      attendance?: { status: string; reason: string | null };
      metrics?: Array<{ definition_id: string; value: unknown }>;
    }>;
  };
  await deviceRepository().mutateSnapshots(
    scope,
    (resource) => resource === `/api/v1/sessions/${sessionId}`,
    (payload) => {
      if (!payload || typeof payload !== "object") return payload;
      const detail = structuredClone(payload) as {
        session?: { status: string };
        roster?: Array<{
          id: string;
          attendance_status: string;
          reason: string | null;
          metrics: Array<{ definition_id: string; value: unknown }>;
        }>;
      };
      if (path.endsWith("/open") && detail.session)
        detail.session.status = "OPEN";
      if (path.endsWith("/close") && detail.session)
        detail.session.status = "CLOSED";
      if (path.endsWith("/cancel") && detail.session)
        detail.session.status = "CANCELLED";
      for (const record of recordBody.records ?? []) {
        const roster = detail.roster?.find(
          (item) => item.id === record.roster_id,
        );
        if (!roster) continue;
        if (record.attendance) {
          roster.attendance_status = record.attendance.status;
          roster.reason = record.attendance.reason;
        }
        for (const metric of record.metrics ?? []) {
          const target = roster.metrics.find(
            (item) => item.definition_id === metric.definition_id,
          );
          if (target) target.value = metric.value;
        }
      }
      return detail;
    },
  );
  await deviceRepository().mutateSnapshots(
    scope,
    (resource) => resource === "/api/v1/sessions",
    (payload) => {
      if (!payload || typeof payload !== "object") return payload;
      const result = structuredClone(payload) as {
        sessions?: Array<{ id: string; status: string }>;
      };
      const session = result.sessions?.find((item) => item.id === sessionId);
      if (session && path.endsWith("/open")) session.status = "OPEN";
      if (session && path.endsWith("/close")) session.status = "CLOSED";
      if (session && path.endsWith("/cancel")) session.status = "CANCELLED";
      return result;
    },
  );
}

async function applyTrackingOptimism(
  scope: string,
  path: string,
  body: unknown,
) {
  if (!path.includes("/tracking/entries")) return;
  const entries = (body as { entries?: Array<Record<string, unknown>> })
    .entries;
  if (!entries?.length) return;
  await deviceRepository().mutateSnapshots(
    scope,
    (resource) => resource.startsWith("/api/v1/tracking/expected?"),
    (payload) => {
      if (!payload || typeof payload !== "object") return payload;
      const result = structuredClone(payload) as {
        expected?: Array<Record<string, unknown> & { entry?: unknown }>;
      };
      for (const input of entries) {
        const target = result.expected?.find(
          (item) =>
            item.enrollment_id === input.enrollment_id &&
            item.definition_id === input.definition_id &&
            item.period_start === input.period_start &&
            item.period_end === input.period_end,
        );
        if (target)
          target.entry = {
            ...(typeof target.entry === "object" ? target.entry : {}),
            value: input.value,
            source: input.source,
            row_version: input.row_version,
            review_status: "PENDING",
          };
      }
      return result;
    },
  );
}

async function applyLearningOptimism(
  scope: string,
  path: string,
  body: unknown,
  mutationId: string,
) {
  if (!path.includes("/assignments/") || !path.endsWith("/submission")) return;
  const assignmentId = pathId(path, "assignments");
  if (!assignmentId) return;
  const input = body as {
    enrollment_id?: string;
    answer?: string;
    row_version?: number | null;
  };
  await deviceRepository().mutateSnapshots(
    scope,
    (resource) => resource === "/api/v1/learning",
    (payload) => {
      if (!payload || typeof payload !== "object") return payload;
      const result = structuredClone(payload) as {
        assignments?: Array<{
          id: string;
          submissions: Array<Record<string, unknown>>;
        }>;
      };
      const assignment = result.assignments?.find(
        (item) => item.id === assignmentId,
      );
      if (!assignment) return result;
      const existing = assignment.submissions.find(
        (item) => item.enrollment_id === input.enrollment_id,
      );
      const submission = {
        id: typeof existing?.id === "string" ? existing.id : mutationId,
        enrollment_id: input.enrollment_id,
        answer: input.answer,
        status: "SUBMITTED",
        score: null,
        row_version: input.row_version,
        saved_on_device: true,
      };
      if (existing) Object.assign(existing, submission);
      else assignment.submissions.push(submission);
      return result;
    },
  );
}

async function applyFollowupOptimism(
  scope: string,
  path: string,
  mutationId: string,
) {
  const transitions: Record<string, string> = {
    claim: "IN_PROGRESS",
    snooze: "SNOOZED",
    resolve: "RESOLVED",
    dismiss: "DISMISSED",
    start: "IN_PROGRESS",
    complete: "DONE_PENDING_VERIFICATION",
    verify: "VERIFIED",
    cancel: "CANCELLED",
    reopen: "OPEN",
    archive: "ARCHIVED",
  };
  const transition = path.split("/").at(-1) ?? "";
  const status = transitions[transition];
  if (!status) return;
  const resource = path.includes("/attention/")
    ? "/api/v1/attention"
    : path.includes("/actions/")
      ? "/api/v1/actions"
      : path.includes("/cases/")
        ? "/api/v1/cases"
        : null;
  if (!resource) return;
  const plural = resource.split("/").at(-1)!;
  const id = pathId(path, plural) ?? mutationId;
  await deviceRepository().mutateSnapshots(
    scope,
    (candidate) => candidate === resource,
    (payload) => {
      if (!payload || typeof payload !== "object") return payload;
      const result = structuredClone(payload) as Record<
        string,
        Array<Record<string, unknown>>
      >;
      const collection = result[plural === "attention" ? "attentions" : plural];
      const target = collection?.find((item) => item.id === id);
      if (target) {
        target.status = status;
        target.saved_on_device = true;
      }
      return result;
    },
  );
}

async function enqueue(
  path: string,
  body: unknown,
  method: QueuedMutation["method"],
  mutationId: string,
  idempotencyKey: string,
) {
  const scope = activeScopeId();
  if (!scope) throw new Error("OFFLINE_SCOPE_UNAVAILABLE");
  const identity = mutationIdentity(path, mutationId);
  const item = await deviceRepository().enqueue({
    id: mutationId,
    idempotencyKey,
    scopeId: scope,
    entityType: identity.entityType,
    entityId: identity.entityId,
    operation: operation(method, path),
    command: commandName(method, path),
    method,
    path,
    payload: body,
    dependencies: [],
    baseVersion: firstRowVersion(body),
    optimisticData: body,
  });
  await Promise.all([
    applySessionOptimism(scope, path, body),
    applyTrackingOptimism(scope, path, body),
    applyLearningOptimism(scope, path, body, mutationId),
    applyFollowupOptimism(scope, path, mutationId),
  ]);
  return {
    id: identity.entityId,
    queued_offline: true,
    device_mutation_id: item.id,
  } satisfies CommandResult;
}

export async function writeJson(
  path: string,
  body: unknown,
  method: QueuedMutation["method"] = "POST",
): Promise<CommandResult> {
  const mutationId = crypto.randomUUID();
  const idempotencyKey = mutationId;
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return enqueue(path, body, method, mutationId, idempotencyKey);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    connectivity.reportHttp(response.status);
    const result = (await response.json()) as CommandResult & {
      code?: string;
      message?: string;
    };
    if (response.ok) return result;
    if (response.status === 429 || response.status >= 500)
      return enqueue(path, body, method, mutationId, idempotencyKey);
    throw new CommandError(
      result.message ?? "تعذر تنفيذ العملية.",
      response.status,
      result.code ?? "UNKNOWN_ERROR",
      response.headers.get("x-request-id"),
    );
  } catch (error) {
    if (error instanceof CommandError) throw error;
    connectivity.reportNetworkFailure();
    return enqueue(path, body, method, mutationId, idempotencyKey);
  }
}
