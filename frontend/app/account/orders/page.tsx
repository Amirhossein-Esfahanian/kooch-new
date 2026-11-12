"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { GuestOrdersList } from "@/components/account/GuestOrdersList";

export default function AccountOrdersPage() {
  const router = useRouter();
  const auth = useAuthSession();
  const hasAccountWorkspace = auth.workspaces.includes("account");
  useEffect(() => {
    if (auth.loading) return;
    if (!auth.authenticated) {
      router.replace(`/login?returnTo=${encodeURIComponent("/account/orders")}`);
      return;
    }
    if (!hasAccountWorkspace) router.replace(resolveSessionDestination(auth));
  }, [auth, hasAccountWorkspace, router]);
  if (auth.loading || !auth.authenticated || !hasAccountWorkspace) {
    return <div className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground" role="status">در حال آماده‌سازی سفارش‌ها...</div>;
  }
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-5">
        <KoochPageHeader
          actions={
            <div className="flex flex-wrap gap-2">
              <KoochButton
                onClick={() => router.push("/account/reservations")}
                variant="outline"
              >
                رزروهای مستقل
              </KoochButton>
              <KoochButton
                onClick={() => router.push("/account")}
                variant="ghost"
              >
                حساب کاربری
              </KoochButton>
            </div>
          }
          description="هر سفارش یک یا چند رزرو مستقل از یک اقامتگاه را در یک پرداخت گروه‌بندی می‌کند."
          eyebrow="حساب کاربری"
          title="سفارش‌های من"
        />
        <GuestOrdersList />
      </div>
    </main>
  );
}
