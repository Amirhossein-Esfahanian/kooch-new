"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type AuthWorkspace,
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochCheckbox } from "@/components/KoochCheckbox";
import { KoochDialog } from "@/components/KoochDialog";
import {
  clearRememberedWorkspace,
  saveRememberedWorkspace,
} from "@/lib/auth-session";

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
  const [rememberChoice, setRememberChoice] = useState(false);
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
      router.replace(resolveSessionDestination(session, workspaces[0]));
    }
  }, [authenticated, loading, router, session, workspaces]);

  function choose(option: WorkspaceOption) {
    if (!user) return;

    if (rememberChoice) {
      saveRememberedWorkspace(user.userId, option.key);
    } else {
      clearRememberedWorkspace(user.userId);
    }

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
    <main className="min-h-[50vh]" dir="rtl">
      <KoochDialog
        backdropClassName="!bg-[color-mix(in_srgb,var(--background)_70%,transparent)] backdrop-blur-md"
        bodyClassName="!bg-transparent !px-4 !py-5 sm:!px-6 sm:!py-6"
        closeDisabled
        contentClassName="!h-auto max-h-[calc(100dvh-2rem)] !max-w-3xl !rounded-2xl !border-border/70 !bg-[color-mix(in_srgb,var(--card)_80%,transparent)] shadow-2xl backdrop-blur-2xl [&_[data-slot=dialog-header]]:!bg-transparent"
        description={
          <>
            {user?.fullName ? `${user.fullName} عزیز، ` : ""}
            یکی از محیط‌های مجاز خود را انتخاب کنید.
          </>
        }
        onOpenChange={() => undefined}
        open
        showCloseButton={false}
        size="md"
        title="می‌خواهید وارد کدام محیط شوید؟"
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleOptions.map((option) => (
            <button
              className="group flex min-h-40 min-w-0 flex-col items-start rounded-xl border border-border/80 bg-background/60 p-4 text-right text-foreground shadow-sm transition hover:border-[var(--theme-primary-border)] hover:bg-[var(--theme-primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:p-5"
              key={option.key}
              onClick={() => choose(option)}
              type="button"
            >
              <span className="text-lg font-bold leading-7 text-foreground">
                {option.title}
              </span>
              <span className="mt-2 block min-w-0 text-sm leading-7 text-muted-foreground">
                {option.description}
              </span>
              <span className="mt-auto pt-4 text-sm font-bold text-[var(--theme-primary-text)] group-hover:underline">
                ورود به این محیط
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 border-t border-border/70 pt-4">
          <KoochCheckbox
            checked={rememberChoice}
            label="انتخاب من را به خاطر بسپار"
            onChange={(event) => setRememberChoice(event.target.checked)}
            wrapperClassName="min-h-11 max-w-full cursor-pointer items-start py-2 leading-6 [&>span]:min-w-0 [&>span]:whitespace-normal"
          />
        </div>
      </KoochDialog>
    </main>
  );
}
