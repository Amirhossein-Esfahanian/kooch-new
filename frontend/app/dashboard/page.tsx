"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";

export default function DashboardRedirectPage() {
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading } = session;

  useEffect(() => {
    if (loading) return;

    if (!authenticated) {
      router.replace("/login");
      return;
    }

    router.replace(resolveSessionDestination(session));
  }, [authenticated, loading, router, session]);

  return (
    <div
      className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
      role="status"
    >
      در حال انتقال...
    </div>
  );
}
