"use client";
import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { TrackingWorkspace } from "./tracking-workspace";
import { LearningWorkspace } from "./learning-workspace";
import { FollowupWorkspace } from "./followup-workspace";
import { ResponsibleCenter } from "./responsible-center";
import { JourneyPanel } from "./journey-panel";
import { PeopleWorkspace } from "./people-workspace";
import { DistributionWorkspace } from "./distribution-workspace";
import { PremiumToday } from "./premium-today";
import { QiwamIcon, type QiwamIconName } from "./qiwam-icon";
import {
  activeScopeId,
  deviceRepository,
  OfflineReadError,
  readJson,
  restoreAuthenticatedIdentity,
  saveAuthenticatedIdentity,
  setOfflineScope,
} from "../offline/client";
import { CommandError, writeJson } from "../offline/commands";
import { startOfflineRuntime } from "../offline/runtime";
import { SyncStatus } from "./sync-status";

type Overview = {
  actor_role: "RESPONSIBLE" | "MENTOR" | "STUDENT";
  templates: { id: string; name: string; level: string; status: string }[];
  plans: {
    id: string;
    template_id: string | null;
    name: string;
    version: number;
    status: string;
  }[];
  cohorts: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
    groups: { id: string; name: string }[];
  }[];
  sessions: {
    id: string;
    group_name: string;
    name: string;
    starts_at: string;
    status: string;
    row_version: number;
  }[];
};
const empty: Overview = {
  actor_role: "RESPONSIBLE",
  templates: [],
  plans: [],
  cohorts: [],
  sessions: [],
};

type Me = {
  account_id: string;
  workspace_id: string;
  display_name: string;
  login_name: string;
  role: Overview["actor_role"];
  workspace_name: string;
};
type View =
  | "today"
  | "people"
  | "program"
  | "sessions"
  | "tracking"
  | "learning"
  | "followup"
  | "reports"
  | "progress"
  | "account";
const viewLabels: Record<View, string> = {
  today: "اليوم",
  people: "الطلاب والمربون",
  program: "البرنامج والمجموعات",
  sessions: "الجلسات",
  tracking: "التتبع",
  learning: "التعلم والتكاليف",
  followup: "المتابعة",
  reports: "التقارير",
  progress: "التقدم",
  account: "الحساب",
};
const roleLabels = {
  RESPONSIBLE: "مسؤول",
  MENTOR: "مربي",
  STUDENT: "طالب",
};

const navGroups: { label: string; views: View[] }[] = [
  { label: "الرئيسية", views: ["today", "reports"] },
  { label: "الإدارة", views: ["people", "program", "sessions"] },
  {
    label: "التتبع",
    views: ["tracking", "learning", "followup", "progress"],
  },
  { label: "الإعدادات", views: ["account"] },
];

const viewIcons: Record<View, QiwamIconName> = {
  today: "home",
  people: "people",
  program: "program",
  sessions: "calendar",
  tracking: "target",
  learning: "learning",
  followup: "followup",
  reports: "reports",
  progress: "progress",
  account: "settings",
};

export function OperationsShell() {
  const [data, setData] = useState<Overview>(empty),
    [me, setMe] = useState<Me | null>(null),
    [signedIn, setSignedIn] = useState(false),
    [initializing, setInitializing] = useState(true),
    [changeRequired, setChangeRequired] = useState(false),
    [passwordOptional, setPasswordOptional] = useState(false),
    [activeView, setActiveView] = useState<View>("today"),
    [theme, setTheme] = useState<"dark" | "light">("dark"),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [mobileNavOpen, setMobileNavOpen] = useState(false),
    [paletteOpen, setPaletteOpen] = useState(false),
    [paletteQuery, setPaletteQuery] = useState(""),
    [profileOpen, setProfileOpen] = useState(false),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [passwordVisible, setPasswordVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("qiwam-theme");
    const restoreTheme = window.setTimeout(() => {
      if (savedTheme === "light") setTheme("light");
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setProfileOpen(false);
        setNotificationsOpen(false);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(restoreTheme);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  useEffect(() => {
    const scope = activeScopeId();
    if (!signedIn || !scope) return;
    return startOfflineRuntime(scope);
  }, [signedIn]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("qiwam-theme", next);
  }
  async function load() {
    const cachedIdentity = await restoreAuthenticatedIdentity<Me>();
    let identityResult;
    try {
      identityResult = await readJson<Me>("/api/v1/me", {
        scope: cachedIdentity?.scope.id,
      });
    } catch (error) {
      if (error instanceof OfflineReadError && error.code === "UNAUTHORIZED") {
        if (cachedIdentity)
          await deviceRepository().revokeScope(cachedIdentity.scope.id);
        setOfflineScope(null);
        setSignedIn(false);
        setMe(null);
        return false;
      }
      throw error;
    }
    const identity = identityResult.data;
    const scope =
      identityResult.source === "server"
        ? await saveAuthenticatedIdentity(identity)
        : cachedIdentity?.scope;
    if (!scope) throw new Error("تعذر استعادة مساحة العمل المحفوظة.");
    const [overviewResult, sessionsResult] = await Promise.all([
      readJson<Omit<Overview, "sessions">>("/api/v1/programs", {
        scope: scope.id,
      }),
      readJson<{ sessions: Overview["sessions"] }>("/api/v1/sessions", {
        scope: scope.id,
      }),
    ]);
    setMe(identity);
    setData({
      ...overviewResult.data,
      sessions: sessionsResult.data.sessions,
    });
    setSignedIn(true);
    return true;
  }
  useEffect(() => {
    let cancelled = false;
    const initialize = window.setTimeout(() => {
      void load()
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setInitializing(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(initialize);
    };
  }, []);
  async function command(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      const result = await writeJson(
        path,
        body,
        method as "POST" | "PUT" | "PATCH" | "DELETE",
      );
      if (!result.queued_offline) await load();
      setMessage(
        result.queued_offline
          ? "تم حفظ التغيير على الجهاز، وسيُزامن عند عودة الاتصال."
          : "تم الحفظ بنجاح.",
      );
      return result;
    } catch (error) {
      if (error instanceof CommandError && error.status === 401) {
        const scope = activeScopeId();
        if (scope) await deviceRepository().revokeScope(scope);
        setOfflineScope(null);
        setSignedIn(false);
        setMe(null);
      }
      setMessage(
        error instanceof Error ? error.message : "تعذر تنفيذ العملية.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login_name: form.get("login_name"),
          password: form.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "تعذر تسجيل الدخول.");
      if (result.next === "CHANGE_PASSWORD") {
        setPasswordOptional(false);
        setChangeRequired(true);
      } else {
        await load();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تسجيل الدخول.");
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      current = String(form.get("current_password") ?? ""),
      next = String(form.get("new_password") ?? ""),
      confirmation = String(form.get("confirm_password") ?? "");
    if (next !== confirmation) {
      setMessage("تأكيد كلمة المرور غير مطابق.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "تعذر تغيير كلمة المرور.");
      setChangeRequired(false);
      setPasswordOptional(false);
      setSignedIn(false);
      setMe(null);
      setMessage("تم تغيير كلمة المرور. سجل الدخول بالكلمة الجديدة.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذر تغيير كلمة المرور.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      setOfflineScope(null);
      setSignedIn(false);
      setMe(null);
      setActiveView("today");
      setBusy(false);
      setMessage("تم تسجيل الخروج.");
    }
  }
  if (initializing)
    return (
      <main className="app-loading" aria-busy="true">
        <div className="brand-mark-static" aria-hidden="true">
          <Image
            src="/brand/minhaj-logo.png"
            alt=""
            width={112}
            height={112}
            priority
          />
        </div>
        <p role="status">جارٍ تجهيز مساحتك…</p>
      </main>
    );
  if (changeRequired)
    return (
      <main className="auth-page">
        <section className="login-card" aria-labelledby="change-title">
          <span className="section-kicker">حماية الحساب</span>
          <h1 id="change-title">تغيير كلمة المرور</h1>
          <p className="muted">اختر كلمة جديدة قبل متابعة استخدام المنصة.</p>
          <form onSubmit={changePassword} className="stack">
            <label>
              كلمة المرور الحالية
              <input
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              كلمة المرور الجديدة
              <input
                name="new_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              تأكيد كلمة المرور
              <input
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <button disabled={busy}>
              {busy ? "جارٍ الحفظ…" : "حفظ وتسجيل الدخول من جديد"}
            </button>
            {passwordOptional && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMessage("");
                  setChangeRequired(false);
                  setPasswordOptional(false);
                }}
              >
                رجوع إلى الحساب
              </button>
            )}
          </form>
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
        </section>
      </main>
    );
  if (!signedIn)
    return (
      <main className="login-page">
        <section className="brand-panel">
          <span className="eyebrow">منصة مِنهاج</span>
          <h1>نظام التشغيل التربوي</h1>
          <p>
            كل ما تحتاجه لإدارة الرحلة التربوية، في مساحة واحدة واضحة وذكية.
          </p>
          <div className="product-preview" aria-hidden="true">
            <div className="preview-bar">
              <i />
              <i />
              <i />
              <span>لوحة اليوم</span>
            </div>
            <div className="preview-body">
              <aside>
                <b>
                  <Image
                    src="/brand/minhaj-logo.png"
                    alt=""
                    width={18}
                    height={18}
                  />
                </b>
                <i />
                <i />
                <i />
              </aside>
              <section>
                <div className="preview-title" />
                <div className="preview-stats">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="preview-chart">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </section>
            </div>
            <div className="floating-stat floating-stat-one">
              <small>معدل الحضور</small>
              <strong>٩٢٪</strong>
              <span>↑ ٨٪ هذا الشهر</span>
            </div>
            <div className="floating-stat floating-stat-two">
              <small>جلسة اليوم</small>
              <strong>٤ جلسات</strong>
              <span>الجميع على الموعد</span>
            </div>
          </div>
          <div className="brand-mark" aria-hidden="true">
            <Image
              src="/brand/minhaj-logo.png"
              alt=""
              width={92}
              height={92}
              priority
            />
          </div>
        </section>
        <section className="login-card">
          <span className="section-kicker">دخول آمن</span>
          <h2>مرحبًا بعودتك</h2>
          <p className="muted">استخدم اسم الدخول وكلمة المرور.</p>
          <form onSubmit={login} className="stack">
            <label>
              اسم الدخول
              <span className="input-with-icon">
                <i aria-hidden="true">
                  <QiwamIcon name="user" size={18} />
                </i>
                <input
                  name="login_name"
                  autoComplete="username"
                  placeholder="أدخل اسم المستخدم"
                  required
                />
              </span>
            </label>
            <label>
              كلمة المرور
              <span className="input-with-icon">
                <i aria-hidden="true">
                  <QiwamIcon name="settings" size={18} />
                </i>
                <input
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="أدخل كلمة المرور"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setPasswordVisible((value) => !value)}
                  aria-label={
                    passwordVisible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                  }
                >
                  <QiwamIcon
                    name={passwordVisible ? "check" : "user"}
                    size={17}
                  />
                </button>
              </span>
            </label>
            <button disabled={busy}>
              {busy ? "جارٍ التحقق…" : "تسجيل الدخول"}
            </button>
          </form>
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
        </section>
      </main>
    );
  const allowedViews: View[] =
    data.actor_role === "RESPONSIBLE"
      ? [
          "today",
          "people",
          "reports",
          "program",
          "sessions",
          "tracking",
          "learning",
          "followup",
          "progress",
          "account",
        ]
      : data.actor_role === "MENTOR"
        ? [
            "today",
            "sessions",
            "tracking",
            "learning",
            "followup",
            "progress",
            "program",
            "account",
          ]
        : ["today", "program", "tracking", "learning", "progress", "account"];
  const searchTargets: Array<{
    id: string;
    title: string;
    detail: string;
    view: View;
    icon: QiwamIconName;
  }> = [
    ...allowedViews.map((view) => ({
      id: `view-${view}`,
      title: viewLabels[view],
      detail: `صفحة ${viewLabels[view]}`,
      view,
      icon: viewIcons[view],
    })),
    ...data.cohorts.map((cohort) => ({
      id: `cohort-${cohort.id}`,
      title: cohort.name,
      detail: "دفعة في البرنامج",
      view: "program" as View,
      icon: "program" as QiwamIconName,
    })),
    ...data.cohorts.flatMap((cohort) =>
      cohort.groups.map((group) => ({
        id: `group-${group.id}`,
        title: group.name,
        detail: `مجموعة · ${cohort.name}`,
        view: "program" as View,
        icon: "people" as QiwamIconName,
      })),
    ),
    ...data.sessions.map((session) => ({
      id: `session-${session.id}`,
      title: session.name,
      detail: `جلسة · ${session.group_name}`,
      view: "sessions" as View,
      icon: "calendar" as QiwamIconName,
    })),
  ];
  const normalizedQuery = paletteQuery.trim().toLocaleLowerCase("ar");
  const filteredTargets = searchTargets
    .filter((target) =>
      `${target.title} ${target.detail}`
        .toLocaleLowerCase("ar")
        .includes(normalizedQuery),
    )
    .slice(0, 12);
  return (
    <main
      className={`dashboard app-theme-${theme}${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`}
      id="main-content"
    >
      <a className="skip-link" href="#workspace-content">
        انتقل إلى المحتوى
      </a>
      <aside className={`saas-sidebar${mobileNavOpen ? " is-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="qiwam-logo" aria-hidden="true">
            <Image
              src="/brand/minhaj-logo.png"
              alt=""
              width={32}
              height={32}
              priority
            />
          </span>
          <div className="sidebar-label">
            <strong>مِنهاج</strong>
            <small>نظام التشغيل التربوي</small>
          </div>
          <button
            className="icon-button mobile-close"
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="إغلاق القائمة"
          >
            <QiwamIcon name="close" size={18} />
          </button>
        </div>
        <button
          className="command-trigger"
          type="button"
          onClick={() => setPaletteOpen(true)}
        >
          <QiwamIcon name="search" size={18} weight="light" />
          <span className="sidebar-label">بحث سريع</span>
          <kbd className="sidebar-label">Ctrl K</kbd>
        </button>
        <nav className="sidebar-nav" aria-label="أقسام مساحة العمل">
          {navGroups.map((group) => {
            const groupViews = group.views.filter((view) =>
              allowedViews.includes(view),
            );
            if (!groupViews.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label sidebar-label">
                  {group.label}
                </span>
                {groupViews.map((view) => (
                  <button
                    type="button"
                    key={view}
                    title={viewLabels[view]}
                    aria-current={activeView === view ? "page" : undefined}
                    onClick={() => {
                      setActiveView(view);
                      setMobileNavOpen(false);
                    }}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      <QiwamIcon
                        name={viewIcons[view]}
                        size={20}
                        weight={activeView === view ? "bold" : "regular"}
                      />
                    </span>
                    <span className="sidebar-label">{viewLabels[view]}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button
            className="user-summary"
            type="button"
            onClick={() => setProfileOpen((value) => !value)}
            aria-expanded={profileOpen}
          >
            <span className="avatar">
              {me?.display_name?.slice(0, 1) ?? "ق"}
            </span>
            <span className="sidebar-label">
              <strong>{me?.display_name}</strong>
              <small>{roleLabels[data.actor_role]}</small>
            </span>
            <span className="sidebar-label">
              <QiwamIcon name="caret-down" size={14} />
            </span>
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <button
                type="button"
                onClick={() => {
                  setActiveView("account");
                  setProfileOpen(false);
                }}
              >
                إعدادات الحساب
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={busy}
              >
                تسجيل الخروج
              </button>
            </div>
          )}
          <button
            className="collapse-button"
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={
              sidebarCollapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي"
            }
          >
            <span aria-hidden="true">
              <QiwamIcon
                name={sidebarCollapsed ? "caret-left" : "caret-right"}
                size={17}
              />
            </span>
            <span className="sidebar-label">طي القائمة</span>
          </button>
        </div>
      </aside>
      {mobileNavOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="إغلاق القائمة"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <section className="app-stage">
        <header className="topbar">
          <div className="topbar-heading">
            <button
              className="icon-button mobile-menu"
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="فتح القائمة"
            >
              <QiwamIcon name="menu" size={20} />
            </button>
            <div>
              <div className="breadcrumbs">
                <span>الرئيسية</span>
                <b>/</b>
                <strong>{viewLabels[activeView]}</strong>
              </div>
              <h1>{viewLabels[activeView]}</h1>
            </div>
          </div>
          <div className="account-actions">
            <button
              className="top-search"
              type="button"
              onClick={() => setPaletteOpen(true)}
            >
              <QiwamIcon name="search" size={18} weight="light" />
              <span>ابحث في مِنهاج…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === "dark" ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"
              }
            >
              <QiwamIcon
                name={theme === "dark" ? "sun" : "moon"}
                size={18}
                weight="light"
              />
            </button>
            <button
              className="icon-button notification-button"
              type="button"
              aria-label="الإشعارات"
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              <QiwamIcon name="bell" size={18} weight="light" />
              <i />
            </button>
            {notificationsOpen && (
              <section
                className="notification-panel"
                aria-label="مركز الإشعارات"
              >
                <header>
                  <div>
                    <strong>الإشعارات</strong>
                    <small>آخر تحديثات مساحة العمل</small>
                  </div>
                  <span>الكل مقروء</span>
                </header>
                <div className="notification-empty">
                  <b aria-hidden="true">
                    <QiwamIcon name="bell" size={24} weight="duotone" />
                  </b>
                  <strong>لا توجد إشعارات جديدة</strong>
                  <small>ستظهر هنا التنبيهات التي تحتاج تدخلك.</small>
                </div>
              </section>
            )}
            <SyncStatus />
            <span className="status-dot">{me?.workspace_name ?? "متصل"}</span>
            <button
              type="button"
              className="avatar top-avatar"
              onClick={() => setProfileOpen((value) => !value)}
              aria-label="قائمة الحساب"
            >
              {me?.display_name?.slice(0, 1) ?? "م"}
            </button>
          </div>
        </header>
        {message && (
          <div className="toast-notice" role="status">
            <span aria-hidden="true">
              <QiwamIcon name="check" size={16} weight="bold" />
            </span>
            <div>
              <strong>تحديث المنصة</strong>
              <p>{message}</p>
            </div>
            <button
              type="button"
              onClick={() => setMessage("")}
              aria-label="إغلاق الرسالة"
            >
              <QiwamIcon name="close" size={15} />
            </button>
          </div>
        )}
        <div id="workspace-content" className="workspace-content" tabIndex={-1}>
          {activeView === "today" && (
            <PremiumToday
              data={data}
              role={data.actor_role}
              displayName={me?.display_name ?? "مستخدم مِنهاج"}
              open={setActiveView}
            />
          )}
          {activeView === "people" && data.actor_role === "RESPONSIBLE" && (
            <PeopleWorkspace busy={busy} command={command} />
          )}
          {activeView === "program" && (
            <JourneyPanel key="program" kind="program" />
          )}
          {activeView === "progress" && (
            <JourneyPanel key="progress" kind="progress" />
          )}
          {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
            <section className="stats">
              <article>
                <strong>{data.templates.length}</strong>
                <span>قوالب</span>
              </article>
              <article>
                <strong>
                  {data.plans.filter((p) => p.status === "PUBLISHED").length}
                </strong>
                <span>خطط منشورة</span>
              </article>
              <article>
                <strong>{data.cohorts.length}</strong>
                <span>دفعات</span>
              </article>
              <article>
                <strong>{data.cohorts.flatMap((c) => c.groups).length}</strong>
                <span>مجموعات</span>
              </article>
              <article>
                <strong>{data.sessions.length}</strong>
                <span>جلسات</span>
              </article>
            </section>
          )}
          {activeView === "reports" && data.actor_role === "RESPONSIBLE" && (
            <ResponsibleCenter />
          )}
          {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
            <section className="workspace-grid">
              <TemplateForm busy={busy} submit={command} />
              <PlanForm busy={busy} data={data} submit={command} />
              <CohortForm busy={busy} data={data} submit={command} />
            </section>
          )}
          {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
            <DistributionWorkspace
              busy={busy}
              cohorts={data.cohorts}
              command={command}
            />
          )}
          {activeView === "sessions" && data.actor_role !== "STUDENT" && (
            <SessionWorkspace
              busy={busy}
              sessions={data.sessions}
              command={command}
            />
          )}
          {activeView === "tracking" && (
            <TrackingWorkspace
              busy={busy}
              actorRole={data.actor_role}
              command={command}
            />
          )}
          {activeView === "learning" && (
            <LearningWorkspace
              busy={busy}
              actorRole={data.actor_role}
              command={command}
            />
          )}
          {activeView === "followup" && data.actor_role !== "STUDENT" && (
            <FollowupWorkspace busy={busy} command={command} />
          )}
          {activeView === "program" && data.actor_role === "RESPONSIBLE" && (
            <section className="panel table-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">السجل</span>
                  <h2>الدفعات الحالية</h2>
                </div>
              </div>
              {data.cohorts.length ? (
                <div className="cohort-list">
                  {data.cohorts.map((c) => (
                    <article key={c.id}>
                      <div>
                        <strong>{c.name}</strong>
                        <span>
                          {c.starts_on} — {c.ends_on}
                        </span>
                      </div>
                      <div className="chips">
                        {c.groups.map((g) => (
                          <span key={g.id}>{g.name}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty">
                  لا توجد دفعات بعد. ابدأ بقالب ثم انشر خطة.
                </p>
              )}
            </section>
          )}
          {activeView === "account" && me && (
            <section className="panel table-panel account-panel">
              <div>
                <span className="section-kicker">الحساب</span>
                <h2>{me.display_name}</h2>
              </div>
              <dl>
                <div>
                  <dt>اسم الدخول</dt>
                  <dd>{me.login_name}</dd>
                </div>
                <div>
                  <dt>الدور</dt>
                  <dd>{roleLabels[me.role]}</dd>
                </div>
                <div>
                  <dt>الجهة</dt>
                  <dd>{me.workspace_name}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => {
                  setMessage("");
                  setPasswordOptional(true);
                  setChangeRequired(true);
                }}
              >
                تغيير كلمة المرور
              </button>
            </section>
          )}
        </div>
      </section>
      {paletteOpen && (
        <div
          className="palette-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPaletteOpen(false);
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="البحث السريع"
          >
            <div className="palette-input">
              <QiwamIcon name="search" size={20} weight="light" />
              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                placeholder="ابحث عن صفحة أو إجراء…"
                aria-label="نص البحث"
              />
              <kbd>ESC</kbd>
            </div>
            <div className="palette-results">
              <span className="palette-caption">انتقال سريع</span>
              {filteredTargets.map((target) => (
                <button
                  type="button"
                  key={target.id}
                  onClick={() => {
                    setActiveView(target.view);
                    setPaletteOpen(false);
                    setPaletteQuery("");
                  }}
                >
                  <span className="nav-icon">
                    <QiwamIcon name={target.icon} size={20} />
                  </span>
                  <span>
                    <strong>{target.title}</strong>
                    <small>{target.detail}</small>
                  </span>
                  <kbd>↵</kbd>
                </button>
              ))}
              {!filteredTargets.length && (
                <div className="palette-empty">
                  لا توجد نتائج مطابقة. جرّب اسم صفحة أو مجموعة أو جلسة.
                </div>
              )}
            </div>
            <footer>
              <span>↑↓ للتنقل</span>
              <span>Enter للاختيار</span>
              <span>Esc للإغلاق</span>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
type FormProps = {
  busy: boolean;
  data?: Overview;
  submit: (path: string, body: unknown) => Promise<unknown>;
};
function TemplateForm({ busy, submit }: FormProps) {
  return (
    <article className="panel">
      <span className="section-kicker">01</span>
      <h2>قالب جديد</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit("/api/v1/program-templates", {
            name: f.get("name"),
            level: f.get("level"),
          });
          e.currentTarget.reset();
        }}
      >
        <label>
          اسم البرنامج
          <input name="name" required />
        </label>
        <label>
          المستوى
          <input name="level" required />
        </label>
        <button disabled={busy}>إنشاء القالب</button>
      </form>
    </article>
  );
}
function PlanForm({ busy, data = empty, submit }: FormProps) {
  return (
    <article className="panel">
      <span className="section-kicker">02</span>
      <h2>نشر خطة</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            template = String(f.get("template"));
          void submit(`/api/v1/program-templates/${template}/plans`, {
            name: f.get("name"),
            weeks: [
              {
                week_number: 1,
                week_type: "STANDARD",
                title: "أسبوع الانطلاق",
                objectives: ["التهيئة"],
              },
              {
                week_number: 2,
                week_type: "STANDARD",
                title: "أسبوع البناء",
                objectives: ["التطبيق"],
              },
            ],
            sessions: [
              {
                week_number: 1,
                name: "اللقاء التربوي",
                session_type: "GROUP",
                day_offset: 1,
                starts_at: "18:00",
                duration_minutes: 90,
                attendance_required: true,
                metrics: [
                  {
                    name: "التفاعل",
                    value_type: "SCORE",
                    required: true,
                    applies_to: ["PRESENT", "LATE"],
                    constraints: { min: 0, max: 10 },
                  },
                  {
                    name: "الأدب",
                    value_type: "ENUM",
                    required: true,
                    applies_to: ["PRESENT", "LATE"],
                    constraints: { options: ["ممتاز", "جيد", "يحتاج متابعة"] },
                  },
                ],
              },
            ],
            tracking: [
              {
                name: "ورد القرآن",
                meaning: "عدد صفحات الورد المقروءة في اليوم",
                unit: "صفحة",
                value_type: "COUNT",
                constraints: { min: 0, max: 100 },
                target: { min: 2 },
                allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
                allows_batch: true,
                allows_weekly_summary: false,
                requires_review: true,
                weight: 1,
                schedule: {
                  period_kind: "DAILY",
                  start_week: 1,
                  end_week: null,
                  days_of_week: [0, 1, 2, 3, 4, 5, 6],
                  due_time: "22:00",
                },
              },
              {
                name: "الصلاة في وقتها",
                meaning: "المحافظة على الصلوات المفروضة في وقتها",
                unit: null,
                value_type: "BOOLEAN",
                constraints: {},
                target: { value: true },
                allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
                allows_batch: true,
                allows_weekly_summary: false,
                requires_review: false,
                weight: 1,
                schedule: {
                  period_kind: "DAILY",
                  start_week: 1,
                  end_week: null,
                  days_of_week: [0, 1, 2, 3, 4, 5, 6],
                  due_time: "23:00",
                },
              },
              {
                name: "محاسبة الأسبوع",
                meaning: "تقييم أسبوعي مختصر للالتزام والتقدم",
                unit: "من 10",
                value_type: "SCORE",
                constraints: { min: 0, max: 10 },
                target: { min: 7 },
                allowed_sources: ["STUDENT", "MENTOR", "PAPER_TRANSCRIBED"],
                allows_batch: true,
                allows_weekly_summary: true,
                requires_review: true,
                weight: 1,
                schedule: {
                  period_kind: "WEEKLY",
                  start_week: 1,
                  end_week: null,
                  days_of_week: [5],
                  due_time: "21:00",
                },
              },
            ],
            content: [
              {
                week_number: 1,
                title: "مدخل الأسبوع",
                body: "اقرأ أهداف الأسبوع واستعد للتطبيق العملي.",
              },
            ],
            assignments: [
              {
                week_number: 1,
                title: "تطبيق الأسبوع",
                instructions: "اكتب أهم فائدة وكيف ستطبقها.",
                due_day_offset: 5,
                max_score: 10,
                weight: 1,
              },
            ],
            exams: [
              {
                week_number: 1,
                title: "اختبار الأسبوع",
                day_offset: 6,
                max_score: 20,
                weight: 1,
              },
            ],
          });
        }}
      >
        <label>
          القالب
          <select name="template" required defaultValue="">
            <option value="" disabled>
              اختر قالبًا
            </option>
            {data.templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          اسم نسخة الخطة
          <input name="name" required />
        </label>
        <button disabled={busy || !data.templates.length}>
          نشر خطة من أسبوعين
        </button>
      </form>
    </article>
  );
}
function CohortForm({ busy, data = empty, submit }: FormProps) {
  return (
    <article className="panel wide">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">03</span>
          <h2>إطلاق دفعة</h2>
        </div>
        <span className="muted">نسخة مستقلة تحفظ التاريخ</span>
      </div>
      <form
        className="cohort-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit("/api/v1/cohorts", {
            name: f.get("name"),
            source_plan_id: f.get("plan"),
            starts_on: f.get("starts_on"),
            ends_on: f.get("ends_on"),
            groups: String(f.get("groups"))
              .split("،")
              .map((x) => x.trim())
              .filter(Boolean),
          });
        }}
      >
        <label>
          اسم الدفعة
          <input name="name" required />
        </label>
        <label>
          الخطة
          <select name="plan" required defaultValue="">
            <option value="" disabled>
              اختر خطة
            </option>
            {data.plans
              .filter((p) => p.template_id && p.status === "PUBLISHED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · ن{p.version}
                </option>
              ))}
          </select>
        </label>
        <label>
          البداية
          <input name="starts_on" type="date" required />
        </label>
        <label>
          النهاية
          <input name="ends_on" type="date" required />
        </label>
        <label className="span-two">
          المجموعات، بفاصلة عربية
          <input name="groups" placeholder="المجموعة أ، المجموعة ب" required />
        </label>
        <button disabled={busy}>إنشاء الدفعة</button>
      </form>
    </article>
  );
}

type SessionSummary = Overview["sessions"][number];
type SessionDetail = {
  session: SessionSummary & { attendance_required: boolean };
  roster: {
    id: string;
    display_name: string;
    attendance_status: string;
    reason: string | null;
    attendance_row_version: number;
    metrics: {
      definition_id: string;
      name: string;
      value_type: string;
      constraints: { min?: number; max?: number; options?: string[] };
      required: boolean;
      applies_to: string[];
      value: unknown;
      row_version: number | null;
    }[];
  }[];
};
function SessionWorkspace({
  busy,
  sessions,
  command,
}: {
  busy: boolean;
  sessions: SessionSummary[];
  command: (path: string, body: unknown, method?: string) => Promise<unknown>;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  async function openDetail(id: string) {
    try {
      const result = await readJson<SessionDetail>(`/api/v1/sessions/${id}`);
      setDetail(result.data);
    } catch {
      // The existing empty state remains if this session has never been synchronized.
    }
  }
  async function act(path: string, body: unknown, method = "POST") {
    await command(path, body, method);
    await openDetail(detail?.session.id ?? path.split("/")[4]);
  }
  return (
    <section className="panel table-panel session-workspace">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">الجلسات</span>
          <h2>مساحة تسجيل اللقاء</h2>
        </div>
        <span className="muted">حفظ جزئي ثم إغلاق</span>
      </div>
      <div className="session-tabs">
        {!sessions.length && (
          <div className="action-empty">
            <strong>لا توجد جلسات بعد</strong>
            <p>
              أنشئ قالبًا وخطة، ثم أطلق دفعة؛ سيولّد النظام مواعيد الجلسات
              تلقائيًا.
            </p>
          </div>
        )}
        {sessions.map((s) => (
          <button
            className="secondary"
            key={s.id}
            onClick={() => void openDetail(s.id)}
          >
            {s.name} · {s.group_name}
            <small>
              {attendanceLabels[s.status] ??
                (
                  {
                    PLANNED: "مخططة",
                    OPEN: "مفتوحة",
                    CLOSED: "مغلقة",
                    CANCELLED: "ملغاة",
                  } as Record<string, string>
                )[s.status] ??
                s.status}
              {" · "}
              {new Intl.DateTimeFormat("ar-EG", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(s.starts_at))}
            </small>
          </button>
        ))}
      </div>
      {detail && (
        <div className="session-detail">
          <div className="session-actions">
            <strong>{detail.session.name}</strong>
            {detail.session.status === "PLANNED" && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(`/api/v1/sessions/${detail.session.id}/open`, {})
                }
              >
                فتح الجلسة
              </button>
            )}
            {detail.session.status === "OPEN" && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(`/api/v1/sessions/${detail.session.id}/close`, {
                    row_version: detail.session.row_version,
                  })
                }
              >
                إغلاق الجلسة
              </button>
            )}
          </div>
          {detail.session.status === "OPEN" && (
            <form
              className="roster-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  records = detail.roster.map((r) => ({
                    roster_id: r.id,
                    attendance: {
                      status: f.get(`a-${r.id}`),
                      reason: f.get(`reason-${r.id}`) || null,
                      row_version: r.attendance_row_version,
                    },
                    metrics: r.metrics.flatMap((m) => {
                      const raw = f.get(`m-${r.id}-${m.definition_id}`);
                      if (raw === "" || raw === null) return [];
                      return [
                        {
                          definition_id: m.definition_id,
                          value: [
                            "COUNT",
                            "PERCENT",
                            "SCORE",
                            "DURATION",
                            "NUMBER",
                          ].includes(m.value_type)
                            ? Number(raw)
                            : m.value_type === "BOOLEAN"
                              ? raw === "true"
                              : raw,
                          row_version: m.row_version,
                        },
                      ];
                    }),
                  }));
                void act(
                  `/api/v1/sessions/${detail.session.id}/records`,
                  {
                    occurrence_row_version: detail.session.row_version,
                    records,
                  },
                  "PUT",
                );
              }}
            >
              {detail.roster.map((r) => (
                <RosterFields key={r.id} row={r} />
              ))}
              <button disabled={busy}>حفظ السجل</button>
            </form>
          )}
          {detail.session.status === "CLOSED" && (
            <div className="closed-roster">
              <p className="success-banner">أُغلقت الجلسة وحُفظ سجلها.</p>
              {detail.roster.map((row) => (
                <article key={row.id}>
                  <strong>{row.display_name}</strong>
                  <span>
                    {attendanceLabels[row.attendance_status] ??
                      row.attendance_status}
                  </span>
                  {row.metrics.map((metric) => (
                    <small key={metric.definition_id}>
                      {metric.name}: {String(metric.value ?? "—")}
                    </small>
                  ))}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const attendanceLabels: Record<string, string> = {
  NOT_RECORDED: "لم يسجل",
  PRESENT: "حاضر",
  LATE: "متأخر",
  EXCUSED_ABSENCE: "غائب بعذر",
  UNEXCUSED_ABSENCE: "غائب بلا عذر",
};
function RosterFields({ row }: { row: SessionDetail["roster"][number] }) {
  const [attendance, setAttendance] = useState(row.attendance_status);
  const absent = ["EXCUSED_ABSENCE", "UNEXCUSED_ABSENCE"].includes(attendance);
  return (
    <article>
      <h3>{row.display_name}</h3>
      <label>
        الحضور
        <select
          name={`a-${row.id}`}
          value={attendance}
          onChange={(event) => setAttendance(event.target.value)}
          required
        >
          <option value="NOT_RECORDED" disabled>
            لم يسجل
          </option>
          <option value="PRESENT">حاضر</option>
          <option value="LATE">متأخر</option>
          <option value="EXCUSED_ABSENCE">غائب بعذر</option>
          <option value="UNEXCUSED_ABSENCE">غائب بلا عذر</option>
        </select>
      </label>
      {absent && (
        <label>
          سبب الغياب
          <input
            name={`reason-${row.id}`}
            defaultValue={row.reason ?? ""}
            minLength={3}
            required
          />
        </label>
      )}
      {row.metrics
        .filter((metric) => metric.applies_to.includes(attendance))
        .map((metric) => (
          <label key={metric.definition_id}>
            {metric.name}
            {metric.required && " *"}
            {metric.value_type === "ENUM" ? (
              <select
                name={`m-${row.id}-${metric.definition_id}`}
                defaultValue={
                  typeof metric.value === "string" ? metric.value : ""
                }
                required={metric.required}
              >
                <option value="">اختر التقييم</option>
                {(metric.constraints.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : metric.value_type === "BOOLEAN" ? (
              <select
                name={`m-${row.id}-${metric.definition_id}`}
                defaultValue={
                  typeof metric.value === "boolean" ? String(metric.value) : ""
                }
                required={metric.required}
              >
                <option value="">اختر</option>
                <option value="true">نعم</option>
                <option value="false">لا</option>
              </select>
            ) : (
              <input
                name={`m-${row.id}-${metric.definition_id}`}
                type={
                  ["COUNT", "PERCENT", "SCORE", "DURATION", "NUMBER"].includes(
                    metric.value_type,
                  )
                    ? "number"
                    : "text"
                }
                min={metric.constraints.min}
                max={metric.constraints.max}
                required={metric.required}
                defaultValue={
                  typeof metric.value === "string" ||
                  typeof metric.value === "number"
                    ? metric.value
                    : ""
                }
              />
            )}
          </label>
        ))}
    </article>
  );
}
