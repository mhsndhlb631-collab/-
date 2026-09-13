"use client";

import { useEffect } from "react";
import {
  clearInstallPrompt,
  rememberInstallPrompt,
} from "./install-prompt-store";
import { hasUnsavedChanges } from "./update-safety";

function loadedStaticAssets() {
  return performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((value) => {
      const url = new URL(value, window.location.origin);
      return (
        url.origin === window.location.origin &&
        (url.pathname.startsWith("/_next/static/") ||
          url.pathname.startsWith("/brand/") ||
          url.pathname.startsWith("/icons/"))
      );
    });
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      rememberInstallPrompt(event);
      window.dispatchEvent(new CustomEvent("minhaj:install-available"));
    };
    const onInstalled = () => clearInstallPrompt();
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return () => {
        window.removeEventListener("beforeinstallprompt", onInstallPrompt);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }
    let disposed = false;
    let applyingUpdate = false;
    let registration: ServiceWorkerRegistration | null = null;
    const onControllerChange = () => {
      if (!applyingUpdate || disposed) return;
      applyingUpdate = false;
      window.location.reload();
    };
    const applyUpdate = () => {
      if (!registration?.waiting) return;
      if (hasUnsavedChanges()) {
        window.dispatchEvent(new CustomEvent("minhaj:update-blocked"));
        return;
      }
      applyingUpdate = true;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    window.addEventListener("minhaj:apply-update", applyUpdate);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async (nextRegistration) => {
        if (disposed) return;
        registration = nextRegistration;
        const activeRegistration = nextRegistration;
        await navigator.serviceWorker.ready;
        const worker =
          activeRegistration.active ??
          activeRegistration.waiting ??
          activeRegistration.installing;
        worker?.postMessage({
          type: "WARM_STATIC_CACHE",
          urls: loadedStaticAssets(),
        });
        if (activeRegistration.waiting)
          window.dispatchEvent(new CustomEvent("minhaj:update-ready"));
        activeRegistration.addEventListener("updatefound", () => {
          const installing = activeRegistration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && activeRegistration.waiting)
              window.dispatchEvent(new CustomEvent("minhaj:update-ready"));
          });
        });
        const checkForUpdate = () => {
          if (document.visibilityState === "visible")
            void activeRegistration.update();
        };
        document.addEventListener("visibilitychange", checkForUpdate);
        const updateTimer = window.setInterval(checkForUpdate, 60 * 60 * 1000);
        window.addEventListener(
          "pagehide",
          () => {
            document.removeEventListener("visibilitychange", checkForUpdate);
            window.clearInterval(updateTimer);
          },
          { once: true },
        );
      })
      .catch(() => {
        // IndexedDB remains the source of operational data if SW registration fails.
      });
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      window.removeEventListener("minhaj:apply-update", applyUpdate);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
