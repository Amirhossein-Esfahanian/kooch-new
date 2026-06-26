"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const menuItems = [
  { label: "داشبورد", icon: "▦" },
  { label: "اقامتگاه‌ها", icon: "⌂" },
  { label: "اتاق‌ها", icon: "▣" },
  { label: "رزروها", icon: "◷" },
  { label: "قیمت‌گذاری", icon: "﷼" },
  { label: "ظرفیت", icon: "⇅" },
  { label: "پروموشن‌ها", icon: "%" },
  { label: "کاربران", icon: "👥" },
  { label: "نظرات", icon: "☆" },
  { label: "تنظیمات", icon: "⚙" },
];

const stats = [
  { title: "رزروهای امروز", value: "۲۴", detail: "۶ رزرو نیازمند تایید", icon: "◷", tone: "primary" },
  { title: "اقامتگاه‌های فعال", value: "۱۳۸", detail: "۱۲ اقامتگاه در انتظار بازبینی", icon: "⌂", tone: "success" },
  { title: "درآمد امروز", value: "۱۸٫۶ میلیون", detail: "۱۴٪ رشد نسبت به دیروز", icon: "﷼", tone: "warning" },
  { title: "پروموشن‌های فعال", value: "۱۷", detail: "۵ پیشنهاد مدیریتی منتشر شده", icon: "%", tone: "primary" },
  { title: "نظرات در انتظار", value: "۹", detail: "۳ نظر با امتیاز پایین", icon: "☆", tone: "danger" },
  { title: "ظرفیت‌های نیازمند بررسی", value: "۳۱", detail: "۷ روز پرترافیک در هفته آینده", icon: "⇅", tone: "warning" },
];

const recentReservations = [
  { guest: "سارا نادری", property: "خانه حیاط‌دار کاشان", date: "امروز، ۱۴:۳۰", amount: "۳٫۲ میلیون", status: "در انتظار تایید" },
  { guest: "محمد رستمی", property: "بوتیک هتل باغ فین", date: "امروز، ۱۳:۱۰", amount: "۵٫۸ میلیون", status: "تایید شده" },
  { guest: "نیلوفر قاسمی", property: "اقامتگاه مسیر کویر", date: "دیروز، ۲۱:۴۵", amount: "۲٫۴ میلیون", status: "پرداخت شده" },
  { guest: "آرمان شفیعی", property: "خانه سنتی نقره", date: "دیروز، ۱۸:۲۰", amount: "۴٫۱ میلیون", status: "نیازمند تماس" },
];

const activities = [
  "قیمت اتاق دابل برای آخر هفته به‌روزرسانی شد.",
  "پروموشن «۳ شب اقامت، گشت رایگان» فعال شد.",
  "تصاویر اقامتگاه خانه باغ توسط مالک تغییر کرد.",
  "ظرفیت اتاق شاه‌نشین در تاریخ ۱۲ تیر تکمیل شد.",
  "کاربر جدید به پنل مالک اضافه شد.",
];

const messages = [
  { name: "مالک خانه کاج", text: "درخواست بررسی تصاویر جدید", unread: true },
  { name: "پشتیبانی کوچ", text: "۳ رزرو امروز نیازمند پیگیری است", unread: true },
  { name: "سیستم قیمت‌گذاری", text: "هشدار اختلاف ظرفیت و قیمت", unread: false },
];

const notifications = [
  { title: "رزرو جدید ثبت شد", text: "اقامتگاه خانه حیاط‌دار کاشان یک رزرو تازه دارد.", unread: true },
  { title: "نیاز به تایید تصویر", text: "۴ تصویر جدید در صف بررسی قرار گرفته است.", unread: true },
  { title: "هشدار ظرفیت", text: "ظرفیت برخی اتاق‌ها برای آخر هفته کامل شده است.", unread: false },
];

const drawerEvents = [
  { time: "۱۰:۳۰", title: "بررسی رزروهای امروز" },
  { time: "۱۲:۰۰", title: "تماس با مالک اقامتگاه باغ فین" },
  { time: "۱۶:۴۵", title: "بازبینی پروموشن‌های منتشر شده" },
];

const drawerNotes = [
  "تصاویر ۴ اقامتگاه نیاز به تایید دارد.",
  "قیمت‌گذاری آخر هفته برای ۲ اتاق خالی است.",
];

const quickSettings = ["نمایش اعلان‌های فوری", "حالت فشرده پنل", "یادآوری رزروهای جدید"];

const chartBars = [34, 58, 44, 72, 63, 86, 51, 79, 92, 66, 74, 88];

export default function DashboardPrototypePage() {
  return <DashboardShell />;
}

function DashboardShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [drawerType, setDrawerType] = useState<"messages" | "notifications" | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    if (!drawerType && !profileMenuOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerType(null);
        setProfileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [drawerType, profileMenuOpen]);

  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden font-[var(--font-kooch)] ${
        darkMode ? "bg-[#0b0f17] text-slate-100" : "bg-slate-100 text-slate-950"
      }`}
      dir="rtl"
    >
      {mobileSidebarOpen && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/45 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          type="button"
          aria-label="بستن منو"
        />
      )}
      <div className="flex h-full">
        <DashboardSidebar
          collapsed={collapsed}
          darkMode={darkMode}
          mobileOpen={mobileSidebarOpen}
          onCollapse={() => setCollapsed((value) => !value)}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardHeader
            activeDrawer={drawerType}
            darkMode={darkMode}
            profileMenuOpen={profileMenuOpen}
            onDrawerToggle={(type) => {
              setProfileMenuOpen(false);
              setDrawerType((current) => (current === type ? null : type));
            }}
            onProfileMenuClose={() => setProfileMenuOpen(false)}
            onProfileMenuToggle={() => {
              setDrawerType(null);
              setProfileMenuOpen((value) => !value);
            }}
            onThemeToggle={() => setDarkMode((value) => !value)}
            onSidebarToggle={() => setMobileSidebarOpen(true)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-6">
              <div className="grid min-w-0 gap-5">
                <HeroHeader darkMode={darkMode} />
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {stats.map((stat) => (
                    <DashboardStatCard darkMode={darkMode} key={stat.title} {...stat} />
                  ))}
                </section>

                <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                  <DashboardSectionCard darkMode={darkMode} title="نمودار رزروها" subtitle="placeholder ساده بدون کتابخانه نمودار">
                    <SimpleChart darkMode={darkMode} />
                  </DashboardSectionCard>
                  <DashboardSectionCard darkMode={darkMode} title="وضعیت اقامتگاه‌ها" subtitle="نمای خلاصه mock data">
                    <PropertyStatus darkMode={darkMode} />
                  </DashboardSectionCard>
                </section>

                <DashboardSectionCard darkMode={darkMode} title="رزروهای اخیر" subtitle="آخرین درخواست‌های ثبت‌شده در کوچ">
                  <RecentReservations darkMode={darkMode} />
                </DashboardSectionCard>
              </div>

              <aside className="grid h-fit gap-5 lg:sticky lg:top-6">
                <DashboardSectionCard darkMode={darkMode} title="فعالیت‌های اخیر" subtitle="رویدادهای مهم پنل">
                  <ActivityList darkMode={darkMode} />
                </DashboardSectionCard>
                <DashboardSectionCard darkMode={darkMode} title="پیام‌ها / اعلان‌ها" subtitle="placeholder ریل کناری">
                  <MessageRail darkMode={darkMode} />
                </DashboardSectionCard>
              </aside>
            </main>
          </div>
        </div>
      </div>
      <DashboardSideDrawer darkMode={darkMode} type={drawerType} onClose={() => setDrawerType(null)} />
    </div>
  );
}

function DashboardSidebar({
  collapsed,
  darkMode,
  mobileOpen,
  onCollapse,
  onMobileClose,
}: {
  collapsed: boolean;
  darkMode: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onMobileClose: () => void;
}) {
  return (
    <aside
      className={`fixed inset-y-0 right-0 z-50 h-full shrink-0 border-l transition-all duration-300 md:static md:z-auto md:block ${
        mobileOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"
      } ${collapsed ? "md:w-24" : "md:w-72"} w-72 ${
        darkMode ? "border-white/10 bg-[#111720]" : "border-slate-200 bg-slate-200/95"
      }`}
    >
      <div className="flex h-full flex-col p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--theme-primary)] text-lg font-black text-white shadow-lg shadow-blue-600/20">
              ک
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-black">Kooch</p>
                <p className={mutedText(darkMode)}>داشبورد نمونه</p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className={`hidden h-9 w-9 place-items-center rounded-lg border text-sm transition hover:border-[var(--theme-primary)] md:grid ${
                darkMode ? "border-white/10 bg-white/5" : "border-slate-300 bg-white"
              }`}
              onClick={onCollapse}
              type="button"
              aria-label="جمع کردن منو"
            >
              ☰
            </button>
            <button
              className={`grid h-9 w-9 place-items-center rounded-lg border text-sm md:hidden ${darkMode ? "border-white/10 bg-white/5" : "border-slate-300 bg-white"}`}
              onClick={onMobileClose}
              type="button"
              aria-label="بستن منو"
            >
              ×
            </button>
          </div>
        </div>

        <nav className="mt-6 grid gap-1">
          {menuItems.map((item, index) => (
            <button
              className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm font-black transition ${
                index === 0
                  ? "bg-[var(--theme-primary)] text-white shadow-lg shadow-blue-600/20"
                  : darkMode
                    ? "text-slate-300 hover:bg-white/10 hover:text-white"
                    : "text-slate-700 hover:bg-white hover:text-[var(--theme-primary-text)]"
              } ${collapsed ? "md:justify-center" : "justify-start"}`}
              key={item.label}
              type="button"
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs ${
                  index === 0 ? "bg-white/20" : darkMode ? "bg-white/5" : "bg-white/70"
                }`}
              >
                {item.icon}
              </span>
              <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={`mt-auto rounded-2xl border p-4 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          {!collapsed ? (
            <>
              <p className="text-sm font-black">نمونه قابل بازاستفاده</p>
              <p className={`mt-2 text-xs leading-6 ${mutedText(darkMode)}`}>
                این شِل بعداً می‌تواند پایه AdminLayout و OwnerLayout شود.
              </p>
            </>
          ) : (
            <p className="text-center text-lg">✦</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function DashboardHeader({
  activeDrawer,
  darkMode,
  onDrawerToggle,
  onProfileMenuClose,
  onProfileMenuToggle,
  onThemeToggle,
  onSidebarToggle,
  profileMenuOpen,
}: {
  activeDrawer: "messages" | "notifications" | null;
  darkMode: boolean;
  onDrawerToggle: (type: "messages" | "notifications") => void;
  onProfileMenuClose: () => void;
  onProfileMenuToggle: () => void;
  onThemeToggle: () => void;
  onSidebarToggle: () => void;
  profileMenuOpen: boolean;
}) {
  return (
    <header className={`border-b px-4 py-3 lg:px-6 ${darkMode ? "border-white/10 bg-[#0f141d]" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={`grid h-10 w-10 place-items-center rounded-xl border md:hidden ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
          onClick={onSidebarToggle}
          type="button"
          aria-label="نمایش منو"
        >
          ☰
        </button>
        <div className={`hidden text-xs font-bold sm:block ${mutedText(darkMode)}`}>
          خانه / داشبوردها / نمونه پنل کوچ
        </div>
        <div className={`mr-auto flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border px-3 py-2 md:max-w-md ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
          <span className={mutedText(darkMode)}>⌕</span>
          <input
            className="w-full border-0 bg-transparent p-0 text-sm outline-none"
            placeholder="جستجو در اقامتگاه، رزرو، کاربر..."
            type="search"
          />
        </div>
        <HeaderIcon active={activeDrawer === "messages"} darkMode={darkMode} label="پیام‌ها" onClick={() => onDrawerToggle("messages")}>
          ✉
        </HeaderIcon>
        <HeaderIcon active={activeDrawer === "notifications"} darkMode={darkMode} label="اعلان‌ها" onClick={() => onDrawerToggle("notifications")}>
          🔔
        </HeaderIcon>
        <button
          className={`grid h-10 w-10 place-items-center rounded-xl border transition hover:border-[var(--theme-primary)] ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
          onClick={onThemeToggle}
          type="button"
          aria-label="تغییر حالت روشن و تیره"
        >
          {darkMode ? "☀" : "☾"}
        </button>
        <div className="relative">
          {profileMenuOpen && (
            <button
              className="fixed inset-0 z-[60] cursor-default"
              onClick={onProfileMenuClose}
              type="button"
              aria-label="بستن منوی پروفایل"
            />
          )}
          <button
            className={`relative z-[80] flex items-center gap-2 rounded-xl border px-2 py-1.5 transition hover:border-[var(--theme-primary)] ${
              profileMenuOpen
                ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)]"
                : darkMode
                  ? "border-white/10 bg-white/5"
                  : "border-slate-200 bg-slate-50"
            }`}
            onClick={onProfileMenuToggle}
            type="button"
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--theme-primary)] text-xs font-black text-white">ک</span>
            <span className="hidden text-sm font-black lg:inline">مدیر کوچ</span>
            <span className={mutedText(darkMode)}>⌄</span>
          </button>
          {profileMenuOpen && (
            <div
              className={`absolute left-0 top-12 z-[90] w-52 overflow-hidden rounded-xl border p-1 text-sm font-bold shadow-2xl ${
                darkMode ? "border-white/10 bg-[#111720] text-slate-100" : "border-slate-200 bg-white text-slate-800"
              }`}
              role="menu"
            >
              {["مشاهده پروفایل", "تنظیمات حساب", "خروج از حساب"].map((item) => (
                <button
                  className={`block w-full rounded-lg px-3 py-2 text-right transition ${
                    darkMode ? "hover:bg-white/10" : "hover:bg-slate-100"
                  } ${item === "خروج از حساب" ? "text-[var(--theme-danger)]" : ""}`}
                  key={item}
                  onClick={onProfileMenuClose}
                  role="menuitem"
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function HeroHeader({ darkMode }: { darkMode: boolean }) {
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${surfaceClass(darkMode)}`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-black text-[var(--theme-primary-text)]">پروتوتایپ بصری</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight lg:text-4xl">داشبورد مدیریتی کوچ</h1>
          <p className={`mt-3 max-w-3xl text-sm leading-7 ${mutedText(darkMode)}`}>
            یک نمونه حرفه‌ای و Fuse-inspired برای ارزیابی ساختار پنل؛ بدون اتصال به بک‌اند و بدون تغییر در صفحات فعلی.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[var(--theme-primary-soft)] px-4 py-2 text-sm font-black text-[var(--theme-primary-text)]">امروز: ۶ تیر ۱۴۰۵</span>
          <span className={`rounded-full px-4 py-2 text-sm font-black ${darkMode ? "bg-white/5 text-slate-200" : "bg-slate-100 text-slate-700"}`}>Mock Data</span>
        </div>
      </div>
    </section>
  );
}

function DashboardStatCard({
  title,
  value,
  detail,
  icon,
  tone,
  darkMode,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
  tone: string;
  darkMode: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "bg-[var(--theme-success-soft)] text-[var(--theme-success)]"
      : tone === "warning"
        ? "bg-[var(--theme-warning-soft)] text-[var(--theme-warning)]"
        : tone === "danger"
          ? "bg-[var(--theme-danger-soft)] text-[var(--theme-danger)]"
          : "bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]";

  return (
    <article className={`rounded-2xl border p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl ${surfaceClass(darkMode)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-bold ${mutedText(darkMode)}`}>{title}</p>
          <p className="mt-3 text-3xl font-black">{value}</p>
        </div>
        <span className={`grid h-12 w-12 place-items-center rounded-xl text-lg ${toneClass}`}>{icon}</span>
      </div>
      <p className={`mt-5 rounded-xl px-3 py-2 text-xs font-bold ${darkMode ? "bg-white/5 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
        {detail}
      </p>
    </article>
  );
}

function DashboardSectionCard({
  title,
  subtitle,
  children,
  darkMode,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  darkMode: boolean;
}) {
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${surfaceClass(darkMode)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">{title}</h2>
          {subtitle && <p className={`mt-1 text-sm ${mutedText(darkMode)}`}>{subtitle}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function SimpleChart({ darkMode }: { darkMode: boolean }) {
  return (
    <div className={`h-72 rounded-2xl p-4 ${darkMode ? "bg-[#0b0f17]" : "bg-slate-50"}`}>
      <div className="flex h-full items-end gap-2">
        {chartBars.map((height, index) => (
          <div className="flex flex-1 flex-col items-center gap-2" key={index}>
            <div
              className="w-full rounded-t-lg bg-gradient-to-t from-[var(--theme-primary)] to-[var(--theme-accent)] opacity-85 transition hover:opacity-100"
              style={{ height: `${height}%` }}
            />
            <span className={`text-[10px] font-bold ${mutedText(darkMode)}`}>{index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertyStatus({ darkMode }: { darkMode: boolean }) {
  const rows = [
    ["تایید شده", "۸۶٪"],
    ["در انتظار بازبینی", "۹٪"],
    ["نیازمند اصلاح", "۵٪"],
  ];

  return (
    <div className="grid gap-4">
      {rows.map(([label, value], index) => (
        <div key={label}>
          <div className="mb-2 flex items-center justify-between text-sm font-bold">
            <span>{label}</span>
            <span className={mutedText(darkMode)}>{value}</span>
          </div>
          <div className={`h-3 overflow-hidden rounded-full ${darkMode ? "bg-white/10" : "bg-slate-100"}`}>
            <div
              className={`h-full rounded-full ${index === 0 ? "bg-[var(--theme-success)]" : index === 1 ? "bg-[var(--theme-warning)]" : "bg-[var(--theme-danger)]"}`}
              style={{ width: value }}
            />
          </div>
        </div>
      ))}
      <div className={`rounded-2xl border border-dashed p-5 text-center ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
        <p className="text-3xl font-black text-[var(--theme-primary-text)]">۱۴۲</p>
        <p className={`mt-1 text-sm ${mutedText(darkMode)}`}>کل اقامتگاه‌های ثبت‌شده</p>
      </div>
    </div>
  );
}

function RecentReservations({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl">
      <div className="grid gap-3">
        {recentReservations.map((reservation) => (
          <div
            className={`grid gap-3 rounded-2xl border p-4 transition hover:border-[var(--theme-primary)] md:grid-cols-[1fr_1fr_120px_120px] ${
              darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
            }`}
            key={`${reservation.guest}-${reservation.date}`}
          >
            <div>
              <p className="font-black">{reservation.guest}</p>
              <p className={`mt-1 text-xs ${mutedText(darkMode)}`}>{reservation.date}</p>
            </div>
            <p className="font-bold">{reservation.property}</p>
            <p className="font-black text-[var(--theme-primary-text)]">{reservation.amount}</p>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${darkMode ? "bg-white/10" : "bg-white"}`}>{reservation.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityList({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="grid gap-3">
      {activities.map((activity, index) => (
        <div className="flex gap-3" key={activity}>
          <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--theme-primary-soft)] text-xs font-black text-[var(--theme-primary-text)]">
            {index + 1}
          </span>
          <p className={`rounded-xl border p-3 text-sm leading-6 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>{activity}</p>
        </div>
      ))}
    </div>
  );
}

function MessageRail({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="grid gap-3">
      {messages.map((message) => (
        <div className={`rounded-2xl border p-4 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`} key={message.name}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-black">{message.name}</p>
            {message.unread && <span className="h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />}
          </div>
          <p className={`mt-2 text-sm leading-6 ${mutedText(darkMode)}`}>{message.text}</p>
        </div>
      ))}
    </div>
  );
}

function DashboardSideDrawer({
  darkMode,
  onClose,
  type,
}: {
  darkMode: boolean;
  onClose: () => void;
  type: "messages" | "notifications" | null;
}) {
  const open = Boolean(type);
  const title = type === "messages" ? "پیام‌ها" : "اعلان‌ها";

  return (
    <div className={`pointer-events-none fixed inset-0 z-[120] ${open ? "" : "invisible"}`} aria-hidden={!open}>
      <button
        className={`absolute inset-0 bg-slate-950/35 transition-opacity duration-300 ${open ? "pointer-events-auto opacity-100" : "opacity-0"}`}
        onClick={onClose}
        type="button"
        aria-label="بستن پنل"
      />
      <aside
        className={`pointer-events-auto absolute inset-x-3 bottom-3 max-h-[88vh] overflow-hidden rounded-2xl border shadow-2xl transition duration-300 sm:inset-x-auto sm:bottom-0 sm:left-0 sm:top-0 sm:h-full sm:max-h-none sm:w-[330px] sm:rounded-none sm:rounded-r-2xl ${
          open ? "translate-y-0 opacity-100 sm:translate-x-0" : "translate-y-8 opacity-0 sm:-translate-x-full sm:translate-y-0"
        } ${darkMode ? "border-white/10 bg-[#111720] text-slate-100" : "border-slate-200 bg-white text-slate-950"}`}
        dir="rtl"
      >
        <div className="flex h-full flex-col">
          <div className={`flex items-center justify-between border-b p-4 ${darkMode ? "border-white/10" : "border-slate-200"}`}>
            <div>
              <p className="text-xs font-bold text-[var(--theme-primary-text)]">پنل سریع</p>
              <h2 className="mt-1 text-xl font-black">{title}</h2>
            </div>
            <button
              className={`grid h-9 w-9 place-items-center rounded-lg border text-sm transition hover:border-[var(--theme-primary)] ${
                darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
              }`}
              onClick={onClose}
              type="button"
              aria-label="بستن"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <section className={`rounded-2xl border p-4 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
              <p className={`text-xs font-bold ${mutedText(darkMode)}`}>امروز</p>
              <p className="mt-1 text-2xl font-black">۶ تیر ۱۴۰۵</p>
              <p className={`mt-2 text-sm ${mutedText(darkMode)}`}>۳ رویداد و ۲ یادداشت برای بررسی</p>
            </section>

            <DrawerSection darkMode={darkMode} title="رویدادها">
              <div className="space-y-2">
                {drawerEvents.map((event) => (
                  <div className={`rounded-xl border p-3 ${darkMode ? "border-white/10 bg-[#0b0f17]" : "border-slate-200 bg-white"}`} key={event.time}>
                    <p className="text-xs font-black text-[var(--theme-primary-text)]">{event.time}</p>
                    <p className="mt-1 text-sm font-bold leading-6">{event.title}</p>
                  </div>
                ))}
              </div>
            </DrawerSection>

            <DrawerSection darkMode={darkMode} title="یادداشت‌ها">
              <div className="space-y-2">
                {drawerNotes.map((note) => (
                  <p className={`rounded-xl border p-3 text-sm leading-6 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`} key={note}>
                    {note}
                  </p>
                ))}
              </div>
            </DrawerSection>

            <DrawerSection darkMode={darkMode} title={type === "messages" ? "پیام‌های اخیر" : "اعلان‌های اخیر"}>
              <div className="space-y-2">
                {type === "messages"
                  ? messages.map((message) => (
                      <div className={`rounded-xl border p-3 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`} key={message.name}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-black">{message.name}</p>
                          {message.unread && <span className="h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />}
                        </div>
                        <p className={`mt-2 text-xs leading-5 ${mutedText(darkMode)}`}>{message.text}</p>
                      </div>
                    ))
                  : notifications.map((notification) => (
                      <div
                        className={`rounded-xl border p-3 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
                        key={notification.title}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-black">{notification.title}</p>
                          {notification.unread && <span className="h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />}
                        </div>
                        <p className={`mt-2 text-xs leading-5 ${mutedText(darkMode)}`}>{notification.text}</p>
                      </div>
                    ))}
              </div>
            </DrawerSection>

            <DrawerSection darkMode={darkMode} title="تنظیمات سریع">
              <div className="space-y-2">
                {quickSettings.map((setting, index) => (
                  <label
                    className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 text-sm font-bold ${
                      darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                    }`}
                    key={setting}
                  >
                    <span>{setting}</span>
                    <span className={`h-6 w-10 rounded-full p-1 transition ${index === 0 ? "bg-[var(--theme-primary)]" : darkMode ? "bg-white/10" : "bg-slate-200"}`}>
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${index === 0 ? "translate-x-0" : "-translate-x-4"}`} />
                    </span>
                  </label>
                ))}
              </div>
            </DrawerSection>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DrawerSection({ children, darkMode, title }: { children: ReactNode; darkMode: boolean; title: string }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-black">{title}</h3>
      <div className={darkMode ? "text-slate-100" : "text-slate-800"}>{children}</div>
    </section>
  );
}

function HeaderIcon({
  active,
  children,
  label,
  darkMode,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  darkMode: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`relative grid h-10 w-10 place-items-center rounded-xl border transition hover:border-[var(--theme-primary)] ${
        active
          ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]"
          : darkMode
            ? "border-white/10 bg-white/5"
            : "border-slate-200 bg-slate-50"
      }`}
      onClick={onClick}
      type="button"
      aria-label={label}
      aria-pressed={active}
    >
      {children}
      <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />
    </button>
  );
}

function surfaceClass(darkMode: boolean) {
  return darkMode ? "border-white/10 bg-[#171d27]" : "border-slate-200 bg-white";
}

function mutedText(darkMode: boolean) {
  return darkMode ? "text-slate-400" : "text-slate-500";
}
