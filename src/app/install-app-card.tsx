"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  clearInstallPrompt,
  currentInstallPrompt,
  type InstallPromptEvent,
} from "./install-prompt-store";
import { QiwamIcon } from "./qiwam-icon";

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

const VISITS_KEY = "minhaj:pwa-visits";
const VISIT_SESSION_KEY = "minhaj:pwa-visit-counted";
const IOS_DISMISS_KEY = "minhaj:pwa-ios-dismissed-until";
const IOS_DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as NavigatorWithStandalone).standalone === true
  );
}

function isIosDevice() {
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function InstallAppCard({
  placement,
}: {
  placement: "home" | "settings" | "hidden";
}) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [visits, setVisits] = useState(1);
  const [iosDismissed, setIosDismissed] = useState(true);
  const [prompting, setPrompting] = useState(false);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      setInstalled(isStandalone());
      setIos(isIosDevice());
      const dismissedUntil = Number(
        window.localStorage.getItem(IOS_DISMISS_KEY) ?? "0",
      );
      setIosDismissed(dismissedUntil > Date.now());

      let count = Math.max(
        0,
        Number(window.localStorage.getItem(VISITS_KEY) ?? "0"),
      );
      if (!window.sessionStorage.getItem(VISIT_SESSION_KEY)) {
        count += 1;
        window.localStorage.setItem(VISITS_KEY, String(count));
        window.sessionStorage.setItem(VISIT_SESSION_KEY, "1");
      }
      setVisits(count);
      setPromptEvent(currentInstallPrompt());
    }, 0);

    const onPrompt = () => {
      setInstalled(false);
      setPromptEvent(currentInstallPrompt());
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onDisplayMode = () => setInstalled(isStandalone());
    window.addEventListener("minhaj:install-available", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayMode);
    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener("minhaj:install-available", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayMode);
    };
  }, []);

  const visible = useMemo(() => {
    if (placement === "hidden" || installed) return false;
    if (placement === "home" && visits < 2) return false;
    if (promptEvent) return true;
    return ios && !iosDismissed;
  }, [installed, ios, iosDismissed, placement, promptEvent, visits]);

  if (!visible) return null;

  async function install() {
    if (!promptEvent || prompting) return;
    setPrompting(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      clearInstallPrompt();
      setPromptEvent(null);
    } finally {
      setPrompting(false);
    }
  }

  function dismissIosHelp() {
    window.localStorage.setItem(
      IOS_DISMISS_KEY,
      String(Date.now() + IOS_DISMISS_MS),
    );
    setIosDismissed(true);
  }

  return (
    <aside
      className={`install-app-card is-${placement}`}
      aria-labelledby="install-app-title"
    >
      <Image
        src="/brand/minhaj-logo.png"
        alt=""
        width={64}
        height={64}
        className="install-app-logo"
      />
      <div className="install-app-copy">
        <span className="section-kicker">تطبيق منهاج</span>
        <strong id="install-app-title">ثبّت منهاج على جهازك</strong>
        {promptEvent ? (
          <p>افتح المنصة بسرعة من الشاشة الرئيسية واعمل بواجهة مستقلة.</p>
        ) : (
          <p className="ios-install-steps">
            من Safari اضغط <b>مشاركة</b>، ثم <b>إضافة إلى الشاشة الرئيسية</b>،
            ثم <b>إضافة</b>.
          </p>
        )}
      </div>
      {promptEvent ? (
        <button
          type="button"
          className="install-app-action"
          disabled={prompting}
          onClick={() => void install()}
        >
          <QiwamIcon name="download" size={18} weight="bold" />
          {prompting ? "جارٍ فتح التثبيت…" : "تثبيت منهاج"}
        </button>
      ) : (
        <div className="install-app-ios-actions">
          <span aria-hidden="true">
            <QiwamIcon name="share" size={19} weight="bold" />
          </span>
          <button type="button" onClick={dismissIosHelp}>
            فهمت
          </button>
        </div>
      )}
    </aside>
  );
}
