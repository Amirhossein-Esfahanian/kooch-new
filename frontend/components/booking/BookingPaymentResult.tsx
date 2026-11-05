"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import {
  fetchAccountBookingSession,
  type AccountBookingSession,
} from "@/lib/booking-sessions";
import { getBookingSessionPaymentEligibility } from "@/lib/booking-payment-eligibility";
import {
  formatDate,
  statusLabels,
  statusVariant,
} from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { directSessionHref, isDirectSessionForProperty, type DirectSessionProperty } from "@/lib/property-booking-session";

export function BookingPaymentResult({
  sessionCode,
  mode,
  directProperty,
}: {
  sessionCode: string;
  mode: "success" | "failure";
  directProperty?: DirectSessionProperty;
}) {
  const router = useRouter();
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [loadedSession, setSession] = useState<AccountBookingSession | null>(null);
  const session = loadedSession && (!directProperty || isDirectSessionForProperty(loadedSession, sessionCode, directProperty)) ? loadedSession : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.authenticated) {
      const returnTo = `/booking/sessions/${sessionCode}/${mode === "success" ? "success" : "payment-failure"}`;
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    let active = true;
    let timer: number | undefined;
    let attempts = 0;
    const load = async () => {
      try {
        attempts += 1;
        const value = await fetchAccountBookingSession(sessionCode);
        if (!active) return;
        if (directProperty && !isDirectSessionForProperty(value, sessionCode, directProperty)) {
          setSession(null);
          setError("سفارش رزرو پیدا نشد.");
          setLoading(false);
          return;
        }
        setSession(value);
        setLoading(false);
        if (directProperty ? attempts < 15 && value.payment?.status !== "Successful" && value.payment?.status !== "Failed" : mode === "success" && value.payment?.status !== "Successful") {
          timer = window.setTimeout(load, 2000);
        }
      } catch {
        if (active) {
          setError("وضعیت سفارش قابل دریافت نیست. دوباره تلاش کنید.");
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [auth.authenticated, auth.loading, directProperty, mode, router, sessionCode]);

  if (auth.loading || loading)
    return <StateAlert>در حال بررسی نتیجه پرداخت...</StateAlert>;
  if (!session)
    return <StateAlert error>{error || "سفارش رزرو پیدا نشد."}</StateAlert>;

  const successful = session.payment?.status === "Successful";
  const resultMode = directProperty ? successful ? "success" : session.payment?.status === "Failed" ? "failure" : "pending" : mode;
  const detailHref = directProperty ? directSessionHref(directProperty, sessionCode) : `/account/booking-sessions/${encodeURIComponent(sessionCode)}`;
  const mixedOutcome = session.summary.hasRejectedReservations;
  const paymentEligibility = getBookingSessionPaymentEligibility(session);
  const canRetry =
    (directProperty ? resultMode === "failure" : mode === "failure") && !successful && paymentEligibility.canPay;
  return (
    <main className="mx-auto grid max-w-4xl gap-5 px-4 py-8 sm:px-6" dir="rtl">
      <KoochPageHeader
        eyebrow="نتیجه پرداخت"
        title={resultMode === "failure" ? "پرداخت ناموفق" : "نتیجه سفارش رزرو"}
        description={
          <span>
            کد سفارش: <b dir="ltr">{session.sessionCode}</b>
          </span>
        }
      />
      {resultMode === "success" ? (
        <KoochAlert
          variant={successful ? "success" : "info"}
          title={
            successful ? "پرداخت با موفقیت ثبت شد" : "در حال نهایی‌سازی پرداخت"
          }
        >
          {successful
            ? mixedOutcome
              ? "پرداخت رزروهای تأییدشده با موفقیت ثبت شد. رزروهای ردشده در سابقه سفارش باقی می‌مانند."
              : "تمام رزروهای این سفارش تأیید شدند."
            : "نتیجه امن پرداخت دریافت شده و وضعیت به‌صورت خودکار بررسی می‌شود."}
        </KoochAlert>
      ) : resultMode === "pending" ? (
        <KoochAlert variant="info" title="نتیجه پرداخت هنوز مشخص نیست" role="status">
          هنوز پرداخت موفق یا ناموفق از سمت سرور تأیید نشده است. وضعیت برای مدت محدودی به‌صورت خودکار بررسی می‌شود؛ برای بررسی دوباره می‌توانید به جزئیات سفارش برگردید.
        </KoochAlert>
      ) : (
        <KoochAlert variant="destructive" title="پرداخت تکمیل نشد">
          {directProperty ? "سرور این تلاش پرداخت را ناموفق گزارش کرده است. وضعیت رزرو و امکان تلاش مجدد را در جزئیات سفارش بررسی کنید." : "مبلغی در این شبیه‌سازی موفق ثبت نشده و وضعیت رزروها تغییر نکرده است."}
        </KoochAlert>
      )}
      {error && <KoochAlert variant="destructive">{error}</KoochAlert>}
      <KoochCard className="grid gap-3 sm:grid-cols-2">
        <Summary label="اقامتگاه" value={session.property.name} />
        {mixedOutcome ? (
          <>
            <Summary
              label="مبلغ اولیه سفارش"
              value={formatCurrency(session.summary.originalTotalAmount, {
                currencyLabel,
              })}
            />
            <Summary
              label={successful ? "مبلغ پرداخت‌شده" : "مبلغ قابل پرداخت"}
              value={formatCurrency(
                session.payment?.amount ?? session.summary.payableAmount,
                { currencyLabel },
              )}
            />
          </>
        ) : (
          <Summary
            label="مبلغ کل"
            value={formatCurrency(session.totalAmount, { currencyLabel })}
          />
        )}
        <Summary
          label="وضعیت پرداخت"
          value={session.payment?.status ?? "ثبت نشده"}
        />
        <Summary
          label="تعداد رزرو"
          value={session.reservations.length.toLocaleString("fa-IR")}
        />
      </KoochCard>
      <section aria-labelledby="payment-reservations" className="grid gap-3">
        <h2 className="text-xl font-bold" id="payment-reservations">
          رزروهای سفارش
        </h2>
        {session.reservations.map((reservation) => (
          <KoochCard
            className="flex flex-wrap items-center justify-between gap-4"
            key={reservation.reservationNumber}
          >
            <div className="min-w-0">
              <p className="font-bold" dir="ltr">
                {reservation.reservationNumber}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {reservation.roomTypeName}
                {reservation.roomName ? `، ${reservation.roomName}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(reservation.checkInDate)} تا{" "}
                {formatDate(reservation.checkOutDate)}
              </p>
            </div>
            <KoochBadge variant={statusVariant(reservation.status)}>
              {statusLabels[reservation.status] ?? reservation.status}
            </KoochBadge>
          </KoochCard>
        ))}
      </section>
      <div className="flex flex-wrap gap-3">
        {canRetry && (
          <KoochButton
            onClick={() =>
              router.push(
                detailHref,
              )
            }
          >
            تلاش مجدد برای پرداخت
          </KoochButton>
        )}
        <KoochButton
          onClick={() =>
            router.push(
              detailHref,
            )
          }
          variant="outline"
        >
          جزئیات سفارش
        </KoochButton>
        {!directProperty && <Link
          className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-bold text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/account/reservations"
        >
          رزروهای من
        </Link>}
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 font-bold text-foreground">{value}</p>
    </div>
  );
}

function StateAlert({
  children,
  error = false,
}: {
  children: string;
  error?: boolean;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10" dir="rtl">
      <KoochAlert variant={error ? "destructive" : "info"}>
        {children}
      </KoochAlert>
    </main>
  );
}
