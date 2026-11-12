"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { GuestReservationsList } from "@/components/account/GuestReservationsList";

export default function AccountReservationsPage() {
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading: sessionLoading, workspaces } = session;
  useEffect(() => {
    if (sessionLoading) return;
    if (!authenticated) {
      router.replace("/login");
      return;
    }
    if (!workspaces.includes("account")) router.replace(resolveSessionDestination(session));
  }, [authenticated, router, session, sessionLoading, workspaces]);

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-5">
        <KoochPageHeader
          actions={
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
              href="/account"
            >
              بازگشت به حساب کاربری
            </Link>
          }
          description="رزروهایی که با حساب مهمان شما ثبت شده‌اند."
          eyebrow="حساب کاربری"
          title="رزروهای من"
        />

        <UnderlineTabs ariaLabel="مسیرهای رزروهای من" items={[
          { href: "/account/reservations", label: "رزروهای مستقل" },
          { href: "/account/orders", label: "سفارش‌های چنداقامتگاهی" },
        ]} />
        <GuestReservationsList />
      </div>
    </main>
  );
}
