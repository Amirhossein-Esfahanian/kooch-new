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
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden bg-background"
        data-slot="workspace-background"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--theme-primary) 16%, transparent) 0%, transparent 38%), radial-gradient(circle at 16% 82%, color-mix(in srgb, var(--theme-accent) 14%, transparent) 0%, transparent 40%)",
          }}
        />
        <div className="absolute -right-24 top-[8%] h-80 w-80 rounded-full bg-[color-mix(in_srgb,var(--theme-primary)_18%,transparent)] blur-[96px] sm:h-[28rem] sm:w-[28rem]" />
        <div className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-[color-mix(in_srgb,var(--theme-accent)_16%,transparent)] blur-[112px] sm:h-96 sm:w-96" />
      </div>

      <KoochDialog
        backdropClassName="!bg-[color-mix(in_srgb,var(--background)_42%,transparent)] backdrop-blur-md"
        bodyClassName="!bg-transparent !px-4 !py-4 sm:!px-5"
        closeDisabled
        contentClassName="!h-auto max-h-[calc(100dvh-2rem)] !max-w-2xl !grid-rows-[auto_auto] !rounded-2xl !border-[color-mix(in_srgb,var(--border)_78%,transparent)] !bg-[color-mix(in_srgb,var(--card)_84%,transparent)] shadow-2xl backdrop-blur-2xl [&_[data-slot=dialog-header]]:!bg-transparent [&_[data-slot=dialog-header]]:!px-5 [&_[data-slot=dialog-header]]:!py-4 sm:[&_[data-slot=dialog-header]]:!px-6"
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
        <div className="mx-auto grid w-full min-w-0 max-w-xl gap-3 sm:grid-cols-2">
          {visibleOptions.map((option) => (
            <button
              className="group flex min-h-36 min-w-0 flex-col items-start rounded-xl border border-border/80 bg-background/60 p-4 text-right text-foreground shadow-sm transition hover:border-[var(--theme-primary-border)] hover:bg-[var(--theme-primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              key={option.key}
              onClick={() => choose(option)}
              type="button"
            >
              <span className="text-lg font-bold leading-7 text-foreground">
                {option.title}
              </span>
              <span className="mt-1.5 block min-w-0 text-sm leading-7 text-muted-foreground">
                {option.description}
              </span>
              <span className="mt-auto pt-3 text-sm font-bold text-[var(--theme-primary-text)] group-hover:underline">
                ورود به این محیط
              </span>
            </button>
          ))}
        </div>

        <div className="mx-auto mt-4 w-full max-w-xl border-t border-border/70 pt-3">
          <KoochCheckbox
            checked={rememberChoice}
            label="انتخاب من را به خاطر بسپار"
            onChange={(event) => setRememberChoice(event.target.checked)}
            wrapperClassName="min-h-11 max-w-full cursor-pointer items-start py-1.5 leading-6 [&>span]:min-w-0 [&>span]:whitespace-normal"
          />
        </div>
      </KoochDialog>
    </main>
  );
}
