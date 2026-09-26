"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { GuestVoucherView } from "@/components/reservations/vouchers/GuestVoucherView";

export default function AccountVoucherPage() {
  const { reservationNumber } = useParams<{ reservationNumber: string }>();
  const router = useRouter();
  const session = useAuthSession();
  const allowed = session.authenticated && session.workspaces.includes("account");
  useEffect(() => {
    if (session.loading) return;
    if (!session.authenticated) router.replace("/login");
    else if (!allowed) router.replace(resolveSessionDestination(session));
  }, [session, allowed, router]);

  if (session.loading || !allowed) return <p role="status">در حال بارگذاری...</p>;
  return (
    <div dir="rtl" className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
      <KoochPageHeader title="ووچر رزرو" eyebrow="حساب کاربری" appearance="plain"
        actions={<KoochButton variant="outline" onClick={() => router.push(`/account/reservations/${encodeURIComponent(reservationNumber)}`)}>بازگشت به رزرو</KoochButton>} />
      <GuestVoucherView key={reservationNumber} reservationNumber={reservationNumber} />
    </div>
  );
}
