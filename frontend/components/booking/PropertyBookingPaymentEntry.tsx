"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { CheckoutIdentityStep } from "@/components/booking/CheckoutIdentityStep";
import { BookingPaymentResult } from "@/components/booking/BookingPaymentResult";
import { MockPaymentCheckout } from "@/components/booking/MockPaymentCheckout";
import { PropertyBookingShell } from "@/components/booking/PropertyBookingShell";
import { fetchAccountBookingSession } from "@/lib/booking-sessions";
import { fetchPublicApi, type PublicProperty } from "@/lib/public-properties";
import { directSessionHref, isDirectSessionForProperty, type DirectSessionProperty, type BookingPaymentPageKind } from "@/lib/property-booking-session";

type Props = { sessionCode: string; kind: BookingPaymentPageKind; directProperty?: DirectSessionProperty };

export function PropertyBookingPaymentEntry(props: Props) {
  const auth = useAuthSession();
  return <PaymentEntryContent key={`${props.sessionCode}:${props.kind}:${props.directProperty?.id}:${props.directProperty?.slug}:${auth.user?.userId}:${auth.authenticated}`} {...props} />;
}

function PaymentEntryContent({ sessionCode, kind, directProperty }: Props) {
  const auth = useAuthSession();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!directProperty) return;
    return auth.registerInlineSessionRecovery?.(() => setReady(false));
  }, [auth.registerInlineSessionRecovery, directProperty]);

  useEffect(() => {
    if (auth.loading || !auth.authenticated) return;
    let active = true;
    setReady(false);
    setError("");
    void (async () => {
      try {
        const session = await fetchAccountBookingSession(sessionCode);
        if (!active) return;
        if (session.sessionCode !== sessionCode) throw new Error("سفارش رزرو پیدا نشد.");
        if (directProperty) {
          if (!isDirectSessionForProperty(session, sessionCode, directProperty)) throw new Error("سفارش رزرو پیدا نشد.");
        } else if (session.commissionType === 2) {
          // Resolve from the owned session, never from a return URL, query or browser storage.
          const property = await fetchPublicApi<PublicProperty>(`/properties/${encodeURIComponent(session.property.slug)}`);
          if (!active) return;
          if (property.status !== "Approved" || !isDirectSessionForProperty(session, sessionCode, property)) throw new Error("اقامتگاه این سفارش در دسترس نیست.");
          router.replace(directSessionHref(property, sessionCode, kind));
          return;
        } else if (session.commissionType !== null && session.commissionType !== 0 && session.commissionType !== 1) {
          throw new Error("اطلاعات کانال سفارش در دسترس نیست. کمی بعد دوباره تلاش کنید.");
        }
        setReady(true);
      } catch {
        if (active) setError("وضعیت سفارش قابل دریافت نیست یا به این اقامتگاه تعلق ندارد.");
      }
    })();
    return () => { active = false; };
  }, [auth.authenticated, auth.loading, directProperty, kind, retry, router, sessionCode]);

  const content = kind === "mock-payment"
    ? <MockPaymentCheckout sessionCode={sessionCode} directProperty={directProperty} />
    : <BookingPaymentResult sessionCode={sessionCode} mode={kind === "success" ? "success" : "failure"} directProperty={directProperty} />;

  if (directProperty) {
    return <PropertyBookingShell property={directProperty}>
      {!auth.loading && !auth.authenticated
        ? <section className="mx-auto max-w-xl px-4 py-8" aria-label="ورود برای مشاهده نتیجه پرداخت"><CheckoutIdentityStep allowAlternateLogin={false} onAuthenticated={() => undefined} /></section>
        : ready ? content : state()}
    </PropertyBookingShell>;
  }
  // Legacy Account authentication retains its existing return-to behavior.
  if (!auth.loading && !auth.authenticated) return content;
  return ready ? <div className="flex min-h-screen flex-col"><Header /><div className="flex-1">{content}</div><Footer /></div> : state();

  function state() {
    return <section className="mx-auto grid max-w-3xl gap-3 px-4 py-10" dir="rtl" aria-label="بررسی سفارش">
      <KoochAlert variant={error ? "destructive" : "info"} role={error ? "alert" : "status"}>{error || "در حال بررسی سفارش رزرو..."}</KoochAlert>
      {error && <KoochButton className="justify-self-start" variant="outline" onClick={() => setRetry((value) => value + 1)}>تلاش مجدد</KoochButton>}
    </section>;
  }
}
