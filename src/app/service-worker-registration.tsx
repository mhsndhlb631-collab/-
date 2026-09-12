"use client";

import { useEffect } from "react";

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
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    let disposed = false;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async (registration) => {
        if (disposed) return;
        await navigator.serviceWorker.ready;
        const worker =
          registration.active ??
          registration.waiting ??
          registration.installing;
        worker?.postMessage({
          type: "WARM_STATIC_CACHE",
          urls: loadedStaticAssets(),
        });
        if (registration.waiting)
          window.dispatchEvent(new CustomEvent("minhaj:update-ready"));
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && registration.waiting)
              window.dispatchEvent(new CustomEvent("minhaj:update-ready"));
          });
        });
      })
      .catch(() => {
        // IndexedDB remains the source of operational data if SW registration fails.
      });
    return () => {
      disposed = true;
    };
  }, []);
  return null;
}
