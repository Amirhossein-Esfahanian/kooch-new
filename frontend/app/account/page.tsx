"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { AccountOverview } from "@/components/account/AccountOverview";
import { AccountContentSkeleton } from "@/components/account/AccountSkeleton";

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

  if (loading) return <AccountContentSkeleton />;
  if (!authenticated || !hasAccountWorkspace) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
        role="status"
      >
        در حال آماده‌سازی حساب کاربری...
      </div>
    );
  }

  return <AccountOverview key={session.user?.userId ?? "account"} displayName={session.user?.fullName || session.user?.email || ""} />;
}
