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
import {
  bookingModePresentation,
  formatBookingCountdown,
  formatBookingDate,
  formatBookingDeadline,
} from "@/components/booking/booking-display";
import { fetchAccountBookingSession, initiateAccountBookingSessionPayment, type AccountBookingSession } from "@/lib/booking-sessions";
import { statusLabels, statusVariant } from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { getOrCreatePaymentIdempotencyKey } from "@/lib/payment-idempotency";
import { isMockPaymentUiEnabled } from "@/lib/account-orders";
import { useReservationPaymentCountdown } from "@/lib/reservation-countdown";

export default function AccountBookingSessionPage() {
  const { sessionCode } = useParams<{ sessionCode: string }>();
  const router = useRouter();
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [session, setSession] = useState<AccountBookingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [initiatingPayment, setInitiatingPayment] = useState(false);
  const paymentDeadlineUtc =
    session?.commonPaymentDeadlineUtc ??
    session?.summary.earliestPaymentDeadlineUtc ??
    null;
  const approvalDeadlineUtc = session?.summary.earliestApprovalDeadlineUtc ?? null;
  const remainingPaymentSeconds = useReservationPaymentCountdown(
    Boolean(paymentDeadlineUtc),
    paymentDeadlineUtc,
    undefined,
    session?.sessionCode,
  );
  const remainingApprovalSeconds = useReservationPaymentCountdown(
    Boolean(session?.summary.hasPendingApprovals && approvalDeadlineUtc),
    approvalDeadlineUtc,
    undefined,
    `${session?.sessionCode ?? sessionCode}:approval`,
  );
  const sessionBookingMode = session?.reservations.some(
    (reservation) => reservation.approvalExpiresAtUtc !== null,
  )
    ? "OnRequest"
    : "Instant";
  const paymentDeadlineReached = remainingPaymentSeconds === 0;
  const canInitiatePayment = Boolean(
    session?.summary.isPaymentReady && !paymentDeadlineReached,
  );
  const mockPaymentEnabled = isMockPaymentUiEnabled();
  const hasExpiredPaymentWindow = Boolean(
    session &&
      !session.summary.isPaymentReady &&
      (session.reservations.some(
        (reservation) => reservation.status === "PaymentExpired",
      ) ||
        (paymentDeadlineReached &&
          session.reservations.some(
            (reservation) => reservation.status === "ApprovedAwaitingPayment",
          ))),
  );

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

  useEffect(() => {
    if (
      remainingApprovalSeconds !== 0 ||
      !approvalDeadlineUtc ||
      !session?.summary.hasPendingApprovals
    ) {
      return;
    }

    let active = true;
    let attempts = 0;
    const refreshStatus = async () => {
      attempts += 1;
      try {
        const result = await fetchAccountBookingSession(sessionCode);
        if (active) setSession(result);
      } catch {
        // The existing page error remains visible; a transient refresh failure must not rewrite status locally.
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => {
      if (attempts >= 12) {
        window.clearInterval(timer);
        return;
      }
      void refreshStatus();
    }, 5_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [approvalDeadlineUtc, remainingApprovalSeconds, session?.summary.hasPendingApprovals, sessionCode]);

  useEffect(() => {
    if (
      remainingPaymentSeconds !== 0 ||
      !paymentDeadlineUtc ||
      !session?.summary.isPaymentReady
    ) {
      return;
    }

    let active = true;
    let attempts = 0;
    const refreshStatus = async () => {
      attempts += 1;
      try {
        const result = await fetchAccountBookingSession(sessionCode);
        if (active) setSession(result);
      } catch {
        // A transient refresh failure must not make an expired payment action available locally.
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => {
      if (attempts >= 12) {
        window.clearInterval(timer);
        return;
      }
      void refreshStatus();
    }, 5_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [paymentDeadlineUtc, remainingPaymentSeconds, session?.summary.isPaymentReady, sessionCode]);

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
    <main className="mx-auto grid max-w-5xl gap-5 px-4 pb-28 pt-8 sm:px-6 sm:pb-8" dir="rtl">
      <KoochPageHeader
        actions={<KoochButton onClick={() => router.push("/account/orders")} variant="outline">سفارش‌های من</KoochButton>}
        description={`${session.property.name} · ${session.reservations.length.toLocaleString("fa-IR")} رزرو مستقل`}
        eyebrow={session.displayCodeLabel || "کد سفارش"}
        title={<span dir="ltr">{session.sessionCode}</span>}
      />

      {session.summary.hasPendingApprovals && (
        <KoochAlert variant="info" title="در انتظار تأیید اقامتگاه">
          <div className="grid gap-3">
            <span>رزرو پس از تأیید اقامتگاه قابل پرداخت خواهد شد.</span>
            {approvalDeadlineUtc && remainingApprovalSeconds !== null && (
              <ReservationDeadline
                deadlineUtc={approvalDeadlineUtc}
                expiredLabel="مهلت پاسخ پایان یافته؛ وضعیت در حال به‌روزرسانی است."
                label="مهلت باقی‌مانده برای پاسخ مالک"
                remainingSeconds={remainingApprovalSeconds}
              />
            )}
          </div>
        </KoochAlert>
      )}
      {session.summary.hasRejectedReservations && (
        <KoochAlert variant="destructive" title="بخشی از درخواست رزرو تأیید نشده است">
          پرداخت بخشی از سفارش امکان‌پذیر نیست. وضعیت هر رزرو را در ادامه بررسی کنید.
        </KoochAlert>
      )}
      {canInitiatePayment && (
        <KoochAlert variant="success" title="سفارش آماده پرداخت است">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <span>ظرفیت این رزرو تا پایان مهلت پرداخت برای شما نگه داشته شده است.</span>
              {!mockPaymentEnabled && (
                <span className="text-sm">درگاه پرداخت در حال حاضر در دسترس نیست. وضعیت سفارش شما محفوظ می‌ماند.</span>
              )}
            </div>
            {mockPaymentEnabled && <KoochButton className="hidden sm:inline-flex" loading={initiatingPayment} onClick={beginPayment}>پرداخت</KoochButton>}
          </div>
        </KoochAlert>
      )}
      {hasExpiredPaymentWindow && (
        <KoochAlert variant="destructive" title="مهلت پرداخت به پایان رسیده است">
          امکان پرداخت این سفارش دیگر فعال نیست. وضعیت پرداخت از سرور به‌روزرسانی شده است.
        </KoochAlert>
      )}

      <KoochCard className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="اقامتگاه" value={<Link className="font-bold text-primary hover:underline" href={`/properties/${session.property.slug}`}>{session.property.name}</Link>} />
        <Detail
          label="نوع رزرو"
          value={`${bookingModePresentation(sessionBookingMode).icon} ${bookingModePresentation(sessionBookingMode).label}`}
        />
        <Detail label="مبلغ کل" value={formatCurrency(session.totalAmount, { currencyLabel })} />
        {paymentDeadlineUtc && remainingPaymentSeconds !== null && (
          <ReservationDeadline
            deadlineUtc={paymentDeadlineUtc}
            expiredLabel="مهلت پرداخت پایان یافته است."
            label="مهلت پرداخت"
            remainingSeconds={remainingPaymentSeconds}
          />
        )}
      </KoochCard>

      <section aria-labelledby="session-reservations-title" className="grid gap-3">
        <h2 className="text-xl font-black" id="session-reservations-title">رزروهای این سفارش</h2>
        {session.reservations.map((reservation) => (
          <KoochCard className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={reservation.reservationNumber}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Detail label="شماره رزرو" value={<span dir="ltr">{reservation.reservationNumber}</span>} />
              <Detail label="اتاق" value={`${reservation.roomTypeName}${reservation.roomName ? `، ${reservation.roomName}` : ""}`} />
              <Detail label="تاریخ ورود" value={formatBookingDate(reservation.checkInDate)} />
              <Detail label="تاریخ خروج" value={formatBookingDate(reservation.checkOutDate)} />
            </div>
            <div className="flex min-w-36 flex-col items-start justify-between gap-3 sm:items-end">
              <KoochBadge variant={statusVariant(reservation.status)}>{statusLabels[reservation.status] ?? reservation.status}</KoochBadge>
              <strong>{formatCurrency(reservation.finalAmount, { currencyLabel })}</strong>
            </div>
          </KoochCard>
        ))}
      </section>

      {canInitiatePayment && mockPaymentEnabled && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 shadow-lg backdrop-blur sm:hidden" data-testid="session-payment-mobile-action" dir="rtl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-muted-foreground">مبلغ قابل پرداخت</p>
              <p className="truncate font-black text-foreground">{formatCurrency(session.totalAmount, { currencyLabel })}</p>
            </div>
            <KoochButton loading={initiatingPayment} onClick={beginPayment}>پرداخت</KoochButton>
          </div>
        </div>
      )}
    </main>
  );
}

function ReservationDeadline({
  deadlineUtc,
  expiredLabel,
  label,
  remainingSeconds,
}: {
  deadlineUtc: string;
  expiredLabel: string;
  label: string;
  remainingSeconds: number;
}) {
  return (
    <div className="min-w-0" aria-live="off">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">
        {formatBookingDeadline(deadlineUtc)}
      </p>
      <p className="mt-1 text-xs font-black text-primary" role="timer">
        زمان باقی‌مانده: {formatBookingCountdown(remainingSeconds, expiredLabel)}
      </p>
    </div>
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
