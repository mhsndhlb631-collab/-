import type { Metadata, Viewport } from "next";
import "@fontsource-variable/cairo";
import "./globals.css";
import { ServiceWorkerRegistration } from "./service-worker-registration";

export const metadata: Metadata = {
  title: "مِنهاج | نظام التشغيل التربوي",
  description: "مِنهاج لإدارة البرامج والمجموعات والرحلة التربوية.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f4f46" },
  ],
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
