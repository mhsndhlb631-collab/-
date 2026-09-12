import type { OfflineRepository } from "./repository";
import type { OutboxItem, SafeSyncError, SyncAcknowledgement } from "./types";

const delays = [1_000, 3_000, 10_000, 30_000, 60_000] as const;

export type SyncTransport = (item: OutboxItem) => Promise<SyncAcknowledgement>;

function safeError(
  code: string,
  message: string,
  status: number | null,
  requestId: string | null,
): SafeSyncError {
  return { code, message, httpStatus: status, requestId };
}

function bodyCode(body: Record<string, unknown> | null) {
  return typeof body?.code === "string" ? body.code : "UNKNOWN_ERROR";
}

function bodyMessage(body: Record<string, unknown> | null) {
  return typeof body?.message === "string"
    ? body.message
    : "تعذر مزامنة التغيير.";
}

export function retryAt(attempts: number, timestamp = Date.now()) {
  const delay = delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)];
  return new Date(timestamp + delay).toISOString();
}

export class SyncManager {
  private running = false;

  constructor(
    private readonly repository: OfflineRepository,
    private readonly transport: SyncTransport,
  ) {}

  async run(targetScopeId: string) {
    if (this.running) return { processed: 0, skipped: true };
    this.running = true;
    let processed = 0;
    try {
      await this.repository.recoverInterrupted(targetScopeId);
      const queue = await this.repository.pending(targetScopeId);
      for (const item of queue) {
        if (item.nextAttemptAt && item.nextAttemptAt > new Date().toISOString())
          continue;
        const dependenciesReady = await Promise.all(
          item.dependencies.map((id) => this.repository.dependencyIsSynced(id)),
        );
        if (dependenciesReady.some((ready) => !ready)) continue;
        await this.repository.markSyncing(item);
        try {
          const acknowledgement = await this.transport({
            ...item,
            attempts: item.attempts + 1,
          });
          await this.handleAcknowledgement(item, acknowledgement);
        } catch {
          const error = safeError(
            "NETWORK_FAILURE",
            "تعذر الوصول إلى الخادم. سيعاد المحاولة تلقائيًا.",
            null,
            null,
          );
          await this.repository.defer(item, retryAt(item.attempts + 1), error);
        }
        processed += 1;
      }
      return { processed, skipped: false };
    } finally {
      this.running = false;
    }
  }

  private async handleAcknowledgement(
    item: OutboxItem,
    acknowledgement: SyncAcknowledgement,
  ) {
    if (acknowledgement.ok) {
      await this.repository.acknowledge(
        item,
        acknowledgement.body,
        acknowledgement.requestId,
      );
      return;
    }
    const code = bodyCode(acknowledgement.body);
    const error = safeError(
      code,
      bodyMessage(acknowledgement.body),
      acknowledgement.status,
      acknowledgement.requestId,
    );
    if (acknowledgement.status === 401) {
      await this.repository.fail(item, "blocked_auth", error);
      return;
    }
    if (acknowledgement.status === 403) {
      await this.repository.fail(item, "failed_permission", error);
      return;
    }
    if (
      acknowledgement.status === 409 ||
      ["VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(code)
    ) {
      await this.repository.fail(item, "conflict", error);
      return;
    }
    if ([404, 410].includes(acknowledgement.status)) {
      await this.repository.fail(item, "failed_missing_dependency", error);
      return;
    }
    if (acknowledgement.status === 429 || acknowledgement.status >= 500) {
      await this.repository.defer(item, retryAt(item.attempts + 1), error);
      return;
    }
    await this.repository.fail(item, "failed_validation", error);
  }
}

export function httpSyncTransport(
  fetcher: typeof fetch = fetch,
): SyncTransport {
  return async (item) => {
    const response = await fetcher(item.path, {
      method: item.method,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": item.idempotencyKey,
      },
      body: JSON.stringify(item.payload),
    });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // A malformed server response is handled by its HTTP status without logging it.
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      requestId: response.headers.get("x-request-id"),
    };
  };
}
