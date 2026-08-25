"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  type AuthWorkspace,
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { setStoredWorkspace } from "@/lib/auth-session";

type WorkspaceOption = {
  key: AuthWorkspace;
  title: string;
  description: string;
};

const options: WorkspaceOption[] = [
  {
    key: "account",
    title: "محیط مهمان",
    description: "مشاهده حساب کاربری و رزروهای شخصی شما",
  },
  {
    key: "owner",
    title: "پنل اقامتگاه‌ها",
    description: "مدیریت اقامتگاه‌ها، اتاق‌ها، تصاویر و موجودی",
  },
  {
    key: "admin",
    title: "پنل مدیریت",
    description: "مدیریت اقامتگاه‌ها، کاربران، امکانات و گزارش‌ها",
  },
];

export default function ChooseWorkspacePage() {
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading, user, workspaces } = session;
  const visibleOptions = options.filter((option) =>
    workspaces.includes(option.key),
  );

  useEffect(() => {
    if (loading) return;

    if (!authenticated) {
      router.replace("/login");
      return;
    }

    if (workspaces.length === 1) {
      setStoredWorkspace(workspaces[0]);
      router.replace(resolveSessionDestination(session, workspaces[0]));
    }
  }, [authenticated, loading, router, session, workspaces]);

  function choose(option: WorkspaceOption) {
    setStoredWorkspace(option.key);
    router.push(resolveSessionDestination(session, option.key));
  }

  if (loading || !authenticated || workspaces.length <= 1) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
        role="status"
      >
        در حال آماده‌سازی محیط کاربری...
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8" dir="rtl">
      <header className="mb-8 max-w-2xl">
        <p className="text-sm font-bold text-[var(--theme-primary-text)]">
          انتخاب محیط کاربری
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
          می‌خواهید وارد کدام محیط شوید؟
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {user?.fullName ? `${user.fullName} عزیز، ` : ""}
          محیط موردنظر را انتخاب کنید. این انتخاب برای ورود بعدی شما ذخیره
          می‌شود.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {visibleOptions.map((option) => (
          <button
            className="group min-h-44 rounded-xl border border-border bg-card p-6 text-right text-card-foreground shadow-sm transition hover:border-[var(--theme-primary-border)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            key={option.key}
            onClick={() => choose(option)}
            type="button"
          >
            <span className="text-xl font-bold text-foreground">
              {option.title}
            </span>
            <span className="mt-3 block text-sm leading-7 text-muted-foreground">
              {option.description}
            </span>
            <span className="mt-6 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition group-hover:bg-[var(--primary-hover)]">
              ورود به محیط
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
