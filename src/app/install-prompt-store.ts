"use client";

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;

export function rememberInstallPrompt(event: Event) {
  event.preventDefault();
  deferredPrompt = event as InstallPromptEvent;
}

export function currentInstallPrompt() {
  return deferredPrompt;
}

export function clearInstallPrompt() {
  deferredPrompt = null;
}
