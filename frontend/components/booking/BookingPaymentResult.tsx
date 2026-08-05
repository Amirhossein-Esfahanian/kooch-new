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
import { fetchAccountBookingSession, initiateAccountBookingSessionPayment, type AccountBookingSession } from "@/lib/booking-sessions";
import { formatDate, statusLabels, statusVariant } from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { getOrCreatePaymentIdempotencyKey } from "@/lib/payment-idempotency";

export function BookingPaymentResult({
  sessionCode,
  mode,
}: {
  sessionCode: string;
  mode: "success" | "failure";
}) {
  const router = useRouter();
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [session, setSession] = useState<AccountBookingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
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
    const load = async () => {
      try {
        const value = await fetchAccountBookingSession(sessionCode);
        if (!active) return;
        setSession(value);
        setLoading(false);
        if (mode === "success" && value.payment?.status !== "Successful") {
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
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [auth.authenticated, auth.loading, mode, router, sessionCode]);

  async function retry() {
    setRetrying(true);
    setError("");
    try {
      const result = await initiateAccountBookingSessionPayment(
        sessionCode,
        getOrCreatePaymentIdempotencyKey(sessionCode),
      );
      if (!result.checkoutDestination.startsWith("/")) throw new Error();
      router.push(result.checkoutDestination);
    } catch {
      setError("شروع دوباره پرداخت انجام نشد. وضعیت سفارش را بررسی کنید.");
    } finally {
      setRetrying(false);
    }
  }

  if (auth.loading || loading) return <StateAlert>در حال بررسی نتیجه پرداخت...</StateAlert>;
  if (!session) return <StateAlert error>{error || "سفارش رزرو پیدا نشد."}</StateAlert>;

  const successful = session.payment?.status === "Successful";
  return (
    <main className="mx-auto grid max-w-4xl gap-5 px-4 py-8 sm:px-6" dir="rtl">
      <KoochPageHeader eyebrow="نتیجه پرداخت" title={mode === "success" ? "نتیجه سفارش رزرو" : "پرداخت ناموفق"} description={<span>کد سفارش: <b dir="ltr">{session.sessionCode}</b></span>} />
      {mode === "success" ? (
        <KoochAlert variant={successful ? "success" : "info"} title={successful ? "پرداخت با موفقیت ثبت شد" : "در حال نهایی‌سازی پرداخت"}>
          {successful ? "تمام رزروهای این سفارش تأیید شدند." : "نتیجه امن پرداخت دریافت شده و وضعیت به‌صورت خودکار بررسی می‌شود."}
        </KoochAlert>
      ) : (
        <KoochAlert variant="destructive" title="پرداخت تکمیل نشد">
          مبلغی در این شبیه‌سازی موفق ثبت نشده و وضعیت رزروها تغییر نکرده است.
        </KoochAlert>
      )}
      {error && <KoochAlert variant="destructive">{error}</KoochAlert>}
      <KoochCard className="grid gap-3 sm:grid-cols-2">
        <Summary label="اقامتگاه" value={session.property.name} />
        <Summary label="مبلغ کل" value={formatCurrency(session.totalAmount, { currencyLabel })} />
        <Summary label="وضعیت پرداخت" value={session.payment?.status ?? "ثبت نشده"} />
        <Summary label="تعداد رزرو" value={session.reservations.length.toLocaleString("fa-IR")} />
      </KoochCard>
      <section aria-labelledby="payment-reservations" className="grid gap-3">
        <h2 className="text-xl font-black" id="payment-reservations">رزروهای سفارش</h2>
        {session.reservations.map((reservation) => (
          <KoochCard className="flex flex-wrap items-center justify-between gap-4" key={reservation.reservationNumber}>
            <div className="min-w-0">
              <p className="font-black" dir="ltr">{reservation.reservationNumber}</p>
              <p className="mt-1 text-sm text-muted-foreground">{reservation.roomTypeName}{reservation.roomName ? `، ${reservation.roomName}` : ""}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(reservation.checkInDate)} تا {formatDate(reservation.checkOutDate)}</p>
            </div>
            <KoochBadge variant={statusVariant(reservation.status)}>{statusLabels[reservation.status] ?? reservation.status}</KoochBadge>
          </KoochCard>
        ))}
      </section>
      <div className="flex flex-wrap gap-3">
        {mode === "failure" && <KoochButton loading={retrying} onClick={retry}>تلاش دوباره برای پرداخت</KoochButton>}
        <KoochButton onClick={() => router.push(`/account/booking-sessions/${encodeURIComponent(sessionCode)}`)} variant="outline">جزئیات سفارش</KoochButton>
        <Link className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-bold text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/account/reservations">رزروهای من</Link>
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 font-black text-foreground">{value}</p></div>;
}

function StateAlert({ children, error = false }: { children: string; error?: boolean }) {
  return <main className="mx-auto max-w-3xl px-4 py-10" dir="rtl"><KoochAlert variant={error ? "destructive" : "info"}>{children}</KoochAlert></main>;
}
