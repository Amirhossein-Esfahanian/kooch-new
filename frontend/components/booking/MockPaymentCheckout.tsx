"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import {
  fetchAccountBookingSession,
  fetchAccountPaymentProviders,
  simulateMockBookingSessionPayment,
  type AccountBookingSession,
} from "@/lib/booking-sessions";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { directSessionHref, isDirectSessionForProperty, type DirectSessionProperty } from "@/lib/property-booking-session";

export function MockPaymentCheckout({ sessionCode, directProperty }: { sessionCode: string; directProperty?: DirectSessionProperty }) {
  const router = useRouter();
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [loadedSession, setSession] = useState<AccountBookingSession | null>(null);
  const session = loadedSession && (!directProperty || isDirectSessionForProperty(loadedSession, sessionCode, directProperty)) ? loadedSession : null;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"success" | "failure" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [testProviderAvailable, setTestProviderAvailable] = useState(false);
  const submissionPending = useRef(false);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.authenticated) {
      router.replace(
        `/login?returnTo=${encodeURIComponent(`/booking/sessions/${sessionCode}/mock-payment`)}`,
      );
      return;
    }
    let active = true;
    Promise.all([
      fetchAccountBookingSession(sessionCode),
      fetchAccountPaymentProviders(),
    ])
      .then(([value, providers]) => {
        if (!active) return;
        if (directProperty && !isDirectSessionForProperty(value, sessionCode, directProperty)) {
          setError("سفارش رزرو پیدا نشد.");
          return;
        }
        setSession(value);
        setTestProviderAvailable(providers.some((provider) => provider.value === "internal-test"));
      })
      .catch((caught: Error) => active && setError(caught.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [auth.authenticated, auth.loading, directProperty, router, sessionCode]);

  useEffect(() => {
    if (directProperty && session?.payment?.status === "Successful") {
      router.replace(directSessionHref(directProperty, sessionCode, "success"));
    }
  }, [directProperty, router, session?.payment?.status, sessionCode]);

  useEffect(() => {
    if (!session?.payment || session.payment.status !== "Pending") return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetchAccountBookingSession(sessionCode)
        .then((value) => {
          if (!active) return;
          if (directProperty && !isDirectSessionForProperty(value, sessionCode, directProperty)) {
            setSession(null);
            return;
          }
          setSession(value);
          if (value.payment?.status === "Successful") {
            router.replace(
              directProperty ? directSessionHref(directProperty, sessionCode, "success") : `/booking/sessions/${encodeURIComponent(sessionCode)}/success`,
            );
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [directProperty, router, session?.payment, sessionCode]);

  async function simulate(succeeded: boolean) {
    if (submissionPending.current || !testProviderAvailable || (directProperty && (!session || session.payment?.status !== "Pending"))) return;
    submissionPending.current = true;
    setSubmitting(succeeded ? "success" : "failure");
    setError("");
    try {
      const result = await simulateMockBookingSessionPayment(
        sessionCode,
        succeeded,
      );
      router.push(directProperty
        ? directSessionHref(directProperty, sessionCode, result.state === "failed" ? "payment-failure" : "success")
        : result.redirectDestination);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "پرداخت آزمایشی انجام نشد.",
      );
    } finally {
      submissionPending.current = false;
      setSubmitting(null);
    }
  }

  if (auth.loading || loading)
    return <PageState>در حال آماده‌سازی پرداخت آزمایشی...</PageState>;
  if (!session)
    return <PageState error>{error || "سفارش رزرو پیدا نشد."}</PageState>;
  if (directProperty && session.payment?.status !== "Pending")
    return <PageState>این تلاش پرداخت فعال نیست. نتیجه را در جزئیات سفارش بررسی کنید.</PageState>;
  if (!testProviderAvailable)
    return <PageState>در حال حاضر روش پرداخت فعالی در دسترس نیست. وضعیت سفارش محفوظ می‌ماند.</PageState>;

  return (
    <main className="mx-auto grid max-w-3xl gap-5 px-4 py-8 sm:px-6" dir="rtl">
      <KoochPageHeader
        eyebrow={directProperty ? undefined : "درگاه آزمایشی کوچ"}
        title="پرداخت آزمایشی"
        description="این صفحه فقط در محیط توسعه و تست فعال است و تراکنش واقعی ایجاد نمی‌کند."
      />
      <KoochAlert variant="warning">
        هیچ اطلاعات بانکی وارد نکنید. این صفحه فقط نتیجهٔ آزمایشی را از طریق
        سرور ثبت می‌کند.
      </KoochAlert>
      {error && <KoochAlert variant="destructive">{error}</KoochAlert>}
      <KoochCard className="grid gap-4">
        <Detail label="کد سفارش" value={session.sessionCode} ltr />
        <Detail
          label="مبلغ کل"
          value={formatCurrency(session.totalAmount, { currencyLabel })}
        />
        <div>
          <p className="text-xs font-bold text-muted-foreground">
            شماره رزروها
          </p>
          <ul className="mt-2 grid gap-2">
            {session.reservations.map((reservation) => (
              <li
                className="rounded-lg bg-muted px-3 py-2 text-sm font-bold"
                dir="ltr"
                key={reservation.reservationNumber}
              >
                {reservation.reservationNumber}
              </li>
            ))}
          </ul>
        </div>
      </KoochCard>
      <div className="grid gap-3 sm:grid-cols-2">
        <KoochButton
          disabled={submitting !== null}
          loading={submitting === "success"}
          onClick={() => simulate(true)}
        >
          پرداخت موفق آزمایشی
        </KoochButton>
        <KoochButton
          disabled={submitting !== null}
          loading={submitting === "failure"}
          onClick={() => simulate(false)}
          variant="outline"
        >
          شکست پرداخت آزمایشی
        </KoochButton>
      </div>
    </main>
  );
}

function Detail({
  label,
  value,
  ltr = false,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p
        className="mt-1 font-bold text-foreground"
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function PageState({
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
