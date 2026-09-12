import type { Metadata } from "next";
import "@fontsource-variable/cairo";
import "./globals.css";

export const metadata: Metadata = {
  title: "مِنهاج | نظام التشغيل التربوي",
  description: "مِنهاج لإدارة البرامج والمجموعات والرحلة التربوية.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
