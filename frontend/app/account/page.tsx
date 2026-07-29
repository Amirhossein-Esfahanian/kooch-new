"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";

export default function AccountPage() {
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading, workspaces } = session;
  const hasAccountWorkspace = workspaces.includes("account");

  useEffect(() => {
    if (loading) return;

    if (!authenticated) {
      router.replace("/login");
      return;
    }

    if (!hasAccountWorkspace) {
      router.replace(resolveSessionDestination(session));
    }
  }, [authenticated, hasAccountWorkspace, loading, router, session]);

  if (loading || !authenticated || !hasAccountWorkspace) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
        role="status"
      >
        در حال آماده‌سازی حساب کاربری...
      </div>
    );
  }

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8"
      dir="rtl"
    >
      <div className="mx-auto grid max-w-5xl gap-5">
        <KoochPageHeader
          description="رزروهای ثبت‌شده با حساب کاربری خود را مشاهده و پیگیری کنید."
          eyebrow="محیط مهمان"
          title="حساب کاربری"
        />

        <KoochCard className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-foreground">رزروهای من</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
              فهرست رزروها، وضعیت پرداخت و جزئیات اقامت‌های خود را در این بخش
              ببینید.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-primary bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href="/account/reservations"
          >
            مشاهده رزروهای من
          </Link>
        </KoochCard>
      </div>
    </main>
  );
}
