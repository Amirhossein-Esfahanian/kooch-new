"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { UserProfileAvatarProvider } from "@/components/auth/UserProfileAvatarProvider";
import { KoochUserProfileForm } from "@/components/KoochUserProfileForm";
import { AccountSkeleton } from "./AccountSkeleton";
import styles from "./GuestProfilePage.module.css";

export function GuestProfilePage() {
  const session = useAuthSession();
  const router = useRouter();
  const allowed = session.authenticated && session.workspaces.includes("account");
  useEffect(() => {
    if (session.loading) return;
    if (!session.authenticated) router.replace("/login?returnTo=%2Faccount%2Fprofile");
    else if (!allowed) router.replace(resolveSessionDestination(session));
  }, [allowed, router, session]);

  return <main dir="rtl" className={styles.page}>
    <header className={styles.header}><h1>پروفایل من</h1><p>تصویر پروفایل، اطلاعات نمایشی و تنظیمات اعلان‌ها را مدیریت کنید.</p></header>
    {session.loading || !allowed ? <div role="status" aria-busy="true" className={styles.skeleton}>
      <span className="sr-only">در حال آماده‌سازی پروفایل…</span>
      <AccountSkeleton variant="block" /><AccountSkeleton variant="block" /><AccountSkeleton variant="block" />
    </div> : <UserProfileAvatarProvider>
      <KoochUserProfileForm key={session.user?.userId ?? "account"} active actionsWhenDirty onCancel={() => {}} onSaved={() => {}}>
        {({ form, actions }) => <div className={styles.editor}>{form}{actions && <footer className={styles.actions}>{actions}</footer>}</div>}
      </KoochUserProfileForm>
    </UserProfileAvatarProvider>}
  </main>;
}
