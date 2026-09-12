"use client";

import { useCallback, useEffect, useState } from "react";
import {
  activeScopeId,
  connectivity,
  deviceRepository,
} from "../offline/client";
import { subscribeToSync, synchronizeNow } from "../offline/runtime";
import {
  failureCopy,
  syncStatusCopy,
  type SyncCounts,
} from "../offline/sync-copy";
import type {
  ConnectivityKind,
  OfflineConflict,
  OutboxItem,
} from "../offline/types";
import { QiwamIcon } from "./qiwam-icon";

const emptyCounts: SyncCounts = { pending: 0, failed: 0, conflicts: 0 };

function timeCopy(value: string | null) {
  if (!value) return "لم تتم مزامنة كاملة بعد";
  return `آخر مزامنة ${new Intl.DateTimeFormat("ar-EG", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

export function SyncStatus() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ConnectivityKind>(
    connectivity.current().kind,
  );
  const [counts, setCounts] = useState(emptyCounts);
  const [failures, setFailures] = useState<OutboxItem[]>([]);
  const [conflicts, setConflicts] = useState<OfflineConflict[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  const refresh = useCallback(async () => {
    const scope = activeScopeId();
    if (!scope) return;
    const repository = deviceRepository();
    const [nextCounts, nextFailures, nextConflicts, nextLastSync] =
      await Promise.all([
        repository.counts(scope),
        repository.failures(scope),
        repository.unresolvedConflicts(scope),
        repository.metaValue<string>(`last-sync:${scope}`),
      ]);
    setCounts(nextCounts);
    setFailures(nextFailures.reverse());
    setConflicts(nextConflicts.reverse());
    setLastSync(nextLastSync);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const unsubscribeConnectivity = connectivity.subscribe((state) =>
      setKind(state.kind),
    );
    const unsubscribeSync = subscribeToSync(() => void refresh());
    const onOutbox = () => void refresh();
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener("minhaj:outbox-changed", onOutbox);
    window.addEventListener("minhaj:update-ready", onUpdate);
    return () => {
      window.clearTimeout(timer);
      unsubscribeConnectivity();
      unsubscribeSync();
      window.removeEventListener("minhaj:outbox-changed", onOutbox);
      window.removeEventListener("minhaj:update-ready", onUpdate);
    };
  }, [refresh]);

  const copy = syncStatusCopy(kind, counts);
  const tone =
    kind === "offline" || kind === "degraded" || kind === "server_error"
      ? "waiting"
      : counts.failed > 0 || counts.conflicts > 0 || kind === "auth_required"
        ? "attention"
        : counts.pending > 0
          ? "working"
          : "ready";

  async function sync() {
    setBusy(true);
    try {
      await synchronizeNow();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function acceptServerVersion(conflict: OfflineConflict) {
    if (kind !== "online") return;
    await deviceRepository().discardConflict(conflict);
    window.location.reload();
  }

  async function retryFailure(failure: OutboxItem) {
    if (failure.status === "blocked_auth") {
      window.location.reload();
      return;
    }
    await deviceRepository().retryFailure(failure);
    await sync();
  }

  return (
    <div className="sync-status-wrap">
      <button
        type="button"
        className={`sync-status-pill is-${tone}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sync-status-mark" aria-hidden="true" />
        <span>{copy.label}</span>
      </button>
      {open && (
        <section className="sync-center" aria-label="مركز المزامنة">
          <header>
            <div>
              <strong>الحفظ والمزامنة</strong>
              <small>{timeCopy(lastSync)}</small>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="إغلاق مركز المزامنة"
              onClick={() => setOpen(false)}
            >
              <QiwamIcon name="close" size={17} />
            </button>
          </header>
          <div className={`sync-center-state is-${tone}`}>
            <QiwamIcon
              name={tone === "ready" ? "check" : "sync"}
              size={22}
              weight="duotone"
            />
            <div>
              <strong>{copy.label}</strong>
              <small>{copy.detail}</small>
            </div>
          </div>
          <div className="sync-counts" aria-label="ملخص المزامنة">
            <span>
              <b>{counts.pending}</b> محفوظة
            </span>
            <span>
              <b>{counts.failed}</b> تحتاج إجراء
            </span>
            <span>
              <b>{counts.conflicts}</b> مراجعة
            </span>
          </div>
          {conflicts.map((conflict) => (
            <article className="sync-issue" key={conflict.id}>
              <div>
                <strong>يوجد تعديل أحدث على الخادم</strong>
                <small>راجع السجل ثم اختر النسخة التي تريد الاحتفاظ بها.</small>
              </div>
              <button
                type="button"
                disabled={kind !== "online"}
                onClick={() => void acceptServerVersion(conflict)}
              >
                استخدام نسخة الخادم
              </button>
            </article>
          ))}
          {failures.map((failure) => (
            <article className="sync-issue" key={failure.id}>
              <div>
                <strong>{failureCopy(failure.status)}</strong>
                <small>افتح الشاشة المرتبطة وراجع التغيير.</small>
              </div>
              <button
                type="button"
                disabled={busy || kind === "offline"}
                onClick={() => void retryFailure(failure)}
              >
                {failure.status === "blocked_auth"
                  ? "تسجيل الدخول"
                  : "إعادة المحاولة"}
              </button>
            </article>
          ))}
          <footer>
            {updateReady && (
              <button type="button" onClick={() => window.location.reload()}>
                تحديث التطبيق
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={busy || kind === "offline"}
              onClick={() => void sync()}
            >
              <QiwamIcon name="sync" size={17} />
              {busy ? "جارٍ المزامنة…" : "مزامنة الآن"}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
