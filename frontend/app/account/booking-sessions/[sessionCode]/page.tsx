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
  countBookingNights,
  formatBookingCountdown,
  formatBookingDate,
  formatBookingDeadline,
} from "@/components/booking/booking-display";
import { fetchAccountBookingSession, initiateAccountBookingSessionPayment, type AccountBookingSession } from "@/lib/booking-sessions";
import { statusLabels, statusVariant } from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { getPaymentIdempotencyKeyForCurrentAttempt } from "@/lib/payment-idempotency";
import { isMockPaymentUiEnabled } from "@/lib/account-orders";
import { getBookingSessionPaymentEligibility } from "@/lib/booking-payment-eligibility";
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
  const paymentEligibility = session
    ? getBookingSessionPaymentEligibility(session)
    : null;
  const isContinuationAvailable = paymentEligibility?.isContinuation ?? false;
  const paymentDeadlineUtc = paymentEligibility?.deadlineUtc ?? null;
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
  const canInitiateContinuation = Boolean(
    isContinuationAvailable &&
      (session?.summary.payableReservationCount ?? 0) > 0 &&
      paymentDeadlineUtc &&
      remainingPaymentSeconds !== null &&
      remainingPaymentSeconds > 0,
  );
  const canInitiatePayment = Boolean(
    (session?.summary.isPaymentReady || canInitiateContinuation) &&
      !paymentDeadlineReached,
  );
  const payableAmount = isContinuationAvailable
    ? session?.summary.payableAmount ?? 0
    : session?.totalAmount ?? 0;
  const paymentActionLabel = session?.payment?.status === "Failed"
    ? "تلاش مجدد برای پرداخت"
    : isContinuationAvailable
      ? "ادامه با رزروهای تأییدشده"
      : "پرداخت";
  const mockPaymentEnabled = isMockPaymentUiEnabled();
  const hasExpiredPaymentWindow = Boolean(
    session &&
      !canInitiatePayment &&
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
      getPaymentIdempotencyKeyForCurrentAttempt(
        session.sessionCode,
        session.payment?.status === "Failed" ? session.payment.paymentId : null,
      ),
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
      !(session?.summary.isPaymentReady || isContinuationAvailable)
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
  }, [isContinuationAvailable, paymentDeadlineUtc, remainingPaymentSeconds, session?.summary.isPaymentReady, sessionCode]);

  useEffect(() => {
    const shouldPoll = Boolean(
      session?.summary.hasPendingApprovals || session?.payment?.status === "Pending",
    );
    if (!shouldPoll) return;

    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const result = await fetchAccountBookingSession(sessionCode);
        if (active) setSession(result);
      } catch {
        // Keep the last authoritative state during transient polling failures.
      }
    }, 8_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session?.payment?.status, session?.summary.hasPendingApprovals, sessionCode]);

  if (auth.loading || loading) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-center text-muted-foreground" dir="rtl">در حال بارگذاری سفارش رزرو...</main>;
  }
  if (!session) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10" dir="rtl">
        <KoochAlert variant="destructive">{error || "سفارش رزرو پیدا نشد."}</KoochAlert>
      </main>
    );
  }

  const acceptedReservations = session.reservations.filter((reservation) =>
    ["ApprovedAwaitingPayment", "Confirmed", "Paid"].includes(reservation.status),
  );
  const rejectedReservations = session.reservations.filter(
    (reservation) => reservation.status === "Rejected",
  );
  const otherClosedReservations = session.reservations.filter(
    (reservation) =>
      !["ApprovedAwaitingPayment", "Confirmed", "Paid", "Rejected"].includes(
        reservation.status,
      ),
  );
  const fullyConfirmed = session.reservations.length > 0 && session.reservations.every(
    (reservation) => ["Confirmed", "Paid", "Completed"].includes(reservation.status),
  );
  const fullyRejected = session.reservations.length > 0 && session.reservations.every(
    (reservation) => reservation.status === "Rejected",
  );
  const failedPaymentStillPayable = Boolean(
    session.payment?.status === "Failed" && canInitiatePayment,
  );
  const bookingMode = bookingModePresentation(sessionBookingMode);
  const roomTypeGroups = groupSessionReservations(session.reservations);
  const checkInDate = session.summary.earliestCheckInDate ?? session.reservations[0]?.checkInDate ?? null;
  const checkOutDate = session.summary.latestCheckOutDate ?? session.reservations[0]?.checkOutDate ?? null;

  return (
    <main className="mx-auto grid max-w-5xl gap-5 px-4 pb-28 pt-8 sm:px-6 sm:pb-8" dir="rtl">
      <KoochPageHeader
        actions={<KoochButton onClick={() => router.push("/account/orders")} variant="outline">سفارش‌های من</KoochButton>}
        description={`${session.property.name} · ${session.reservations.length.toLocaleString("fa-IR")} رزرو مستقل`}
        eyebrow={session.displayCodeLabel || "کد سفارش"}
        title={<span dir="ltr">{session.sessionCode}</span>}
      />

      {error && <KoochAlert variant="destructive">{error}</KoochAlert>}

      {session.summary.hasPendingApprovals && (
        <KoochAlert variant="info" title="در انتظار تأیید اقامتگاه">
          <div className="grid gap-3">
            <span>
              {session.reservations.some((reservation) => reservation.status === "ApprovedAwaitingPayment")
                ? "برخی رزروها تأیید شده‌اند، اما پرداخت تا مشخص‌شدن وضعیت همه رزروها در دسترس نیست."
                : "درخواست رزرو برای اقامتگاه ارسال شده است. پس از تأیید، امکان پرداخت برای شما فعال می‌شود."}
            </span>
            {approvalDeadlineUtc && remainingApprovalSeconds !== null && (
              <ReservationDeadline
                deadlineUtc={approvalDeadlineUtc}
                expiredLabel="مهلت پاسخ پایان یافته؛ وضعیت در حال به‌روزرسانی است."
                label="مهلت پاسخ اقامتگاه"
                remainingSeconds={remainingApprovalSeconds}
              />
            )}
          </div>
        </KoochAlert>
      )}
      {session.summary.hasRejectedReservations && isContinuationAvailable && (
        <KoochAlert variant="info" title="بخشی از درخواست رزرو تأیید شده است">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <span>برخی رزروها تأیید و برخی رد شده‌اند. می‌توانید همه رزروهای تأییدشده را با یک پرداخت ادامه دهید.</span>
              <span className="text-sm">امکان انتخاب یا پرداخت جداگانه رزروها وجود ندارد.</span>
              {!mockPaymentEnabled && canInitiateContinuation && (
                <span className="text-sm">درگاه پرداخت در حال حاضر در دسترس نیست. وضعیت سفارش شما محفوظ می‌ماند.</span>
              )}
            </div>
            {mockPaymentEnabled && canInitiateContinuation && (
              <KoochButton className="hidden sm:inline-flex" loading={initiatingPayment} onClick={beginPayment}>
                {paymentActionLabel}
              </KoochButton>
            )}
          </div>
        </KoochAlert>
      )}
      {session.summary.hasRejectedReservations &&
        !isContinuationAvailable &&
        session.payment?.status !== "Successful" && (
        <KoochAlert
          variant="destructive"
          title={fullyRejected ? "درخواست رزرو تأیید نشد" : "بخشی از درخواست رزرو تأیید نشده است"}
        >
          {fullyRejected
            ? "اقامتگاه این درخواست را تأیید نکرده است. جزئیات رزرو برای سابقه سفارش حفظ شده‌اند."
            : "وضعیت هر رزرو را در ادامه بررسی کنید. در حال حاضر پرداختی برای این سفارش در دسترس نیست."}
        </KoochAlert>
      )}
      {session.summary.hasRejectedReservations && session.payment?.status === "Successful" && (
        <KoochAlert variant="info" title="نتیجه این سفارش ترکیبی است">
          پرداخت رزروهای تأییدشده با موفقیت انجام شده و رزروهای ردشده برای حفظ سابقه سفارش نمایش داده می‌شوند.
        </KoochAlert>
      )}
      {fullyConfirmed && !session.summary.hasRejectedReservations && (
        <KoochAlert variant="success" title="رزرو شما تأیید شده است">
          پرداخت با موفقیت ثبت شده و رزروهای این سفارش تأیید شده‌اند.
        </KoochAlert>
      )}
      {failedPaymentStillPayable && (
        <KoochAlert variant="warning" title="تلاش قبلی پرداخت ناموفق بود">
          مهلت پرداخت هنوز فعال است و می‌توانید دوباره از همین سفارش برای پرداخت اقدام کنید.
        </KoochAlert>
      )}
      {canInitiatePayment && !isContinuationAvailable && (
        <KoochAlert
          variant="info"
          title={sessionBookingMode === "OnRequest"
            ? "اقامتگاه درخواست شما را تأیید کرد"
            : "رزرو ثبت شد؛ پرداخت را تکمیل کنید"}
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="grid min-w-0 gap-3">
              <span>
                {sessionBookingMode === "OnRequest"
                  ? "برای تکمیل رزرو، پرداخت را تا پایان مهلت انجام دهید."
                  : "ظرفیت این رزرو تا پایان مهلت پرداخت برای شما نگه داشته شده است."}
              </span>
              <strong className="text-sm text-foreground">
                مبلغ قابل پرداخت: {formatCurrency(payableAmount, { currencyLabel })}
              </strong>
              {paymentDeadlineUtc && remainingPaymentSeconds !== null && (
                <ReservationDeadline
                  deadlineUtc={paymentDeadlineUtc}
                  expiredLabel="مهلت پرداخت پایان یافته است."
                  label="مهلت پرداخت"
                  remainingSeconds={remainingPaymentSeconds}
                />
              )}
              {!mockPaymentEnabled && (
                <span className="text-sm">درگاه پرداخت در حال حاضر در دسترس نیست. وضعیت سفارش شما محفوظ می‌ماند.</span>
              )}
            </div>
            {mockPaymentEnabled && <KoochButton className="hidden shrink-0 sm:inline-flex" loading={initiatingPayment} onClick={beginPayment}>{paymentActionLabel}</KoochButton>}
          </div>
        </KoochAlert>
      )}
      {hasExpiredPaymentWindow && (
        <KoochAlert variant="destructive" title="مهلت پرداخت گذشته است">
          این رزرو دیگر برای پرداخت فعال نیست.
        </KoochAlert>
      )}

      <section aria-labelledby="stay-details-title" className="grid gap-3">
        <h2 className="text-xl font-black text-foreground" id="stay-details-title">جزئیات اقامت</h2>
        <KoochCard className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label={session.displayCodeLabel || "کد سفارش"} value={<span dir="ltr">{session.sessionCode}</span>} />
            <Detail label="اقامتگاه" value={<Link className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/properties/${session.property.slug}`}>{session.property.name}</Link>} />
            <Detail label="نوع رزرو" value={`${bookingMode.icon} ${bookingMode.label}`} />
            <Detail label="تاریخ ورود" value={checkInDate ? formatBookingDate(checkInDate) : "مشخص نشده"} />
            <Detail label="تاریخ خروج" value={checkOutDate ? formatBookingDate(checkOutDate) : "مشخص نشده"} />
            <Detail
              label="مدت اقامت"
              value={`${countBookingNights(session.reservations.map((reservation) => ({
                checkIn: reservation.checkInDate,
                checkOut: reservation.checkOutDate,
              }))).toLocaleString("fa-IR")} شب`}
            />
            {session.summary.hasRejectedReservations ? (
              <>
                <Detail label="مبلغ اولیه سفارش" value={formatCurrency(session.summary.originalTotalAmount, { currencyLabel })} />
                <Detail
                  label={session.payment?.status === "Successful" ? "مبلغ پرداخت‌شده" : "مبلغ قابل پرداخت"}
                  value={formatCurrency(session.payment?.status === "Successful" ? session.payment.amount : session.summary.payableAmount, { currencyLabel })}
                />
                {isContinuationAvailable && (
                  <Detail label="تعداد رزروهای قابل پرداخت" value={`${session.summary.payableReservationCount.toLocaleString("fa-IR")} رزرو`} />
                )}
              </>
            ) : (
              <Detail label="مبلغ کل" value={formatCurrency(session.totalAmount, { currencyLabel })} />
            )}
            {session.payment && (
              <>
                <Detail label="وضعیت پرداخت" value={paymentStatusLabel(session.payment.status)} />
                {session.payment.status === "Successful" && !session.summary.hasRejectedReservations && (
                  <Detail label="مبلغ پرداخت‌شده" value={formatCurrency(session.payment.amount, { currencyLabel })} />
                )}
              </>
            )}
          </div>

          <div className="border-t border-border pt-5">
            <h3 className="text-base font-black text-foreground">اتاق‌ها</h3>
            <ul className="mt-3 grid gap-3" aria-label="خلاصه اتاق‌های سفارش">
              {roomTypeGroups.map((group) => (
                <li className="grid min-w-0 gap-2 rounded-lg bg-muted px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={group.key}>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-black text-foreground">{group.roomTypeName}</p>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">
                      {group.statuses.map((status) => statusLabels[status] ?? status).join("، ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm sm:justify-end">
                    <span className="font-bold text-foreground">{group.quantity.toLocaleString("fa-IR")} اتاق</span>
                    <strong className="text-foreground">{formatCurrency(group.amount, { currencyLabel })}</strong>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </KoochCard>
      </section>

      <section aria-labelledby="guest-details-title" className="grid gap-3">
        <h2 className="text-xl font-black text-foreground" id="guest-details-title">اطلاعات مهمان و اقامت</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {auth.user && (
            <KoochCard>
              <h3 className="text-base font-black text-foreground">اطلاعات رزروکننده</h3>
              <div className="mt-4 grid gap-3">
                <Detail label="نام و نام خانوادگی" value={auth.user.fullName} />
                {auth.user.phoneNumber && <Detail label="شماره موبایل" value={<span dir="ltr">{toPersianDigits(auth.user.phoneNumber)}</span>} />}
                {auth.user.email && <Detail label="ایمیل" value={<span dir="ltr">{auth.user.email}</span>} />}
              </div>
            </KoochCard>
          )}
          <KoochCard>
            <h3 className="text-base font-black text-foreground">مهمان اصلی</h3>
            <div className="mt-4 grid gap-3">
              {session.primaryGuest ? (
                <>
                  <Detail label="نام و نام خانوادگی" value={`${session.primaryGuest.firstName} ${session.primaryGuest.lastName}`} />
                  {session.primaryGuest.mobile && <Detail label="شماره موبایل" value={<span dir="ltr">{toPersianDigits(session.primaryGuest.mobile)}</span>} />}
                  {session.primaryGuest.email && <Detail label="ایمیل" value={<span dir="ltr">{session.primaryGuest.email}</span>} />}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">اطلاعات مهمان اصلی در دسترس نیست.</p>
              )}
            </div>
          </KoochCard>
          <KoochCard>
            <h3 className="text-base font-black text-foreground">زمان تقریبی ورود</h3>
            <p className="mt-4 text-sm font-bold text-foreground">
              {session.expectedArrivalTime
                ? toPersianDigits(session.expectedArrivalTime.slice(0, 5))
                : "مشخص نشده"}
            </p>
          </KoochCard>
          {session.specialRequest?.trim() && (
            <KoochCard>
              <h3 className="text-base font-black text-foreground">درخواست ویژه</h3>
              <p className="mt-4 break-words whitespace-pre-wrap text-sm leading-7 text-foreground">{session.specialRequest}</p>
            </KoochCard>
          )}
        </div>
      </section>

      <section aria-labelledby="session-reservations-title" className="grid gap-4">
        <h2 className="text-xl font-black" id="session-reservations-title">رزروهای این سفارش</h2>
        {session.summary.hasRejectedReservations && !session.summary.hasPendingApprovals ? (
          <>
            <ReservationGroup
              currencyLabel={currencyLabel}
              reservations={acceptedReservations}
              testId="payable-reservations"
              title={session.payment?.status === "Successful" ? "رزروهای تأییدشده" : "تأییدشده و قابل پرداخت"}
            />
            <ReservationGroup
              currencyLabel={currencyLabel}
              reservations={rejectedReservations}
              testId="rejected-reservations"
              title="ردشده"
            />
            <ReservationGroup
              currencyLabel={currencyLabel}
              reservations={otherClosedReservations}
              testId="other-reservations"
              title="سایر رزروها"
            />
          </>
        ) : (
          <ReservationCards currencyLabel={currencyLabel} reservations={session.reservations} />
        )}
      </section>

      {canInitiatePayment && mockPaymentEnabled && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 shadow-lg backdrop-blur sm:hidden" data-testid="session-payment-mobile-action" dir="rtl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-muted-foreground">مبلغ قابل پرداخت</p>
              <p className="truncate font-black text-foreground">{formatCurrency(payableAmount, { currencyLabel })}</p>
              {remainingPaymentSeconds !== null && (
                <p className="text-xs font-bold text-primary">{formatBookingCountdown(remainingPaymentSeconds, "مهلت پایان یافته است.")}</p>
              )}
            </div>
            <KoochButton loading={initiatingPayment} onClick={beginPayment}>{paymentActionLabel}</KoochButton>
          </div>
        </div>
      )}
    </main>
  );
}

type SessionReservation = AccountBookingSession["reservations"][number];

function ReservationGroup({
  currencyLabel,
  reservations,
  testId,
  title,
}: {
  currencyLabel: string;
  reservations: SessionReservation[];
  testId: string;
  title: string;
}) {
  if (reservations.length === 0) return null;
  return (
    <section aria-labelledby={`${testId}-title`} className="grid gap-3" data-testid={testId}>
      <h3 className="text-base font-black text-foreground" id={`${testId}-title`}>{title}</h3>
      <ReservationCards currencyLabel={currencyLabel} reservations={reservations} />
    </section>
  );
}

function ReservationCards({
  currencyLabel,
  reservations,
}: {
  currencyLabel: string;
  reservations: SessionReservation[];
}) {
  return reservations.map((reservation) => (
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
  ));
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

function groupSessionReservations(reservations: SessionReservation[]) {
  const groups = new Map<number, {
    key: number;
    roomTypeName: string;
    quantity: number;
    amount: number;
    statuses: string[];
  }>();

  for (const reservation of reservations) {
    const current = groups.get(reservation.roomTypeId);
    if (current) {
      current.quantity += 1;
      current.amount += reservation.finalAmount;
      if (!current.statuses.includes(reservation.status)) {
        current.statuses.push(reservation.status);
      }
      continue;
    }

    groups.set(reservation.roomTypeId, {
      key: reservation.roomTypeId,
      roomTypeName: reservation.roomTypeName,
      quantity: 1,
      amount: reservation.finalAmount,
      statuses: [reservation.status],
    });
  }

  return [...groups.values()];
}

function paymentStatusLabel(status: string) {
  switch (status) {
    case "Successful":
      return "پرداخت موفق";
    case "Failed":
      return "پرداخت ناموفق";
    case "Pending":
      return "در انتظار پرداخت";
    default:
      return status;
  }
}

function toPersianDigits(value: string) {
  return value.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}
