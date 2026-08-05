"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { fetchAccountBookingSession, initiateAccountBookingSessionPayment, type AccountBookingSession } from "@/lib/booking-sessions";
import { formatDate, formatDateTime, statusLabels, statusVariant } from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { getOrCreatePaymentIdempotencyKey } from "@/lib/payment-idempotency";

export default function AccountBookingSessionPage() {
  const { sessionCode } = useParams<{ sessionCode: string }>();
  const router = useRouter();
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [session, setSession] = useState<AccountBookingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [initiatingPayment, setInitiatingPayment] = useState(false);

  async function beginPayment() {
    if (!session || initiatingPayment) return;
    setInitiatingPayment(true);
    setError("");
    try {
      const result = await initiateAccountBookingSessionPayment(
        session.sessionCode,
        getOrCreatePaymentIdempotencyKey(session.sessionCode),
      );
      if (!result.checkoutDestination.startsWith("/")) {
        throw new Error("مسیر پرداخت در دسترس نیست.");
      }
      router.push(result.checkoutDestination);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "شروع پرداخت انجام نشد.");
    } finally {
      setInitiatingPayment(false);
    }
  }

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.authenticated) {
      router.replace(`/login?returnTo=${encodeURIComponent(`/account/booking-sessions/${sessionCode}`)}`);
      return;
    }
    let active = true;
    setLoading(true);
    fetchAccountBookingSession(sessionCode)
      .then((result) => active && setSession(result))
      .catch((caught: Error) => active && setError(caught.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [auth.authenticated, auth.loading, router, sessionCode]);

  if (auth.loading || loading) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-center text-muted-foreground" dir="rtl">در حال بارگذاری سفارش رزرو...</main>;
  }
  if (error || !session) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10" dir="rtl">
        <KoochAlert variant="destructive">{error || "سفارش رزرو پیدا نشد."}</KoochAlert>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-5 px-4 py-8 sm:px-6" dir="rtl">
      <KoochPageHeader
        actions={<KoochButton onClick={() => router.push("/account/reservations")} variant="outline">رزروهای من</KoochButton>}
        description={`${session.property.name} · ${session.reservations.length.toLocaleString("fa-IR")} رزرو مستقل`}
        eyebrow={session.displayCodeLabel || "کد سفارش"}
        title={<span dir="ltr">{session.sessionCode}</span>}
      />

      {session.summary.hasPendingApprovals && (
        <KoochAlert variant="info" title="در انتظار تأیید مالک">
          پس از تأیید همه اتاق‌ها، مهلت پرداخت این سفارش نمایش داده می‌شود.
        </KoochAlert>
      )}
      {session.summary.hasRejectedReservations && (
        <KoochAlert variant="destructive" title="یک یا چند رزرو رد شده است">
          این سفارش در حال حاضر آماده پرداخت نیست.
        </KoochAlert>
      )}
      {session.summary.isPaymentReady && (
        <KoochAlert variant="success" title="سفارش آماده پرداخت است">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>همه اتاق‌ها تأیید شده‌اند و می‌توانید پرداخت را ادامه دهید.</span>
            <KoochButton loading={initiatingPayment} onClick={beginPayment}>پرداخت</KoochButton>
          </div>
        </KoochAlert>
      )}

      <KoochCard className="grid gap-4 sm:grid-cols-3">
        <Detail label="اقامتگاه" value={<Link className="font-bold text-primary hover:underline" href={`/properties/${session.property.slug}`}>{session.property.name}</Link>} />
        <Detail label="مبلغ کل" value={formatCurrency(session.totalAmount, { currencyLabel })} />
        <Detail label="مهلت پرداخت" value={formatDateTime(session.commonPaymentDeadlineUtc ?? session.summary.earliestPaymentDeadlineUtc)} />
      </KoochCard>

      <section aria-labelledby="session-reservations-title" className="grid gap-3">
        <h2 className="text-xl font-black" id="session-reservations-title">رزروهای این سفارش</h2>
        {session.reservations.map((reservation) => (
          <KoochCard className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={reservation.reservationNumber}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Detail label="شماره رزرو" value={<span dir="ltr">{reservation.reservationNumber}</span>} />
              <Detail label="اتاق" value={`${reservation.roomTypeName}${reservation.roomName ? `، ${reservation.roomName}` : ""}`} />
              <Detail label="تاریخ ورود" value={formatDate(reservation.checkInDate)} />
              <Detail label="تاریخ خروج" value={formatDate(reservation.checkOutDate)} />
            </div>
            <div className="flex min-w-36 flex-col items-start justify-between gap-3 sm:items-end">
              <KoochBadge variant={statusVariant(reservation.status)}>{statusLabels[reservation.status] ?? reservation.status}</KoochBadge>
              <strong>{formatCurrency(reservation.finalAmount, { currencyLabel })}</strong>
            </div>
          </KoochCard>
        ))}
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
