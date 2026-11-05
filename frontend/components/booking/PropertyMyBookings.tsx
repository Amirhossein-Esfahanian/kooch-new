"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { PropertyBookingShell } from "@/components/booking/PropertyBookingShell";
import { CheckoutIdentityStep } from "@/components/booking/CheckoutIdentityStep";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { fetchAccountBookingSessions, type PagedAccountBookingSessions } from "@/lib/booking-sessions";
import { directSessionHref, type DirectSessionProperty } from "@/lib/property-booking-session";
import { formatBookingDate } from "@/components/booking/booking-display";
import { orderStatusLabels, orderStatusVariant } from "@/lib/account-orders";
import { statusLabels } from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";

export function PropertyMyBookings({ property }: { property: DirectSessionProperty }) {
  const auth = useAuthSession();
  return <PropertyBookingShell property={property}>
    <BookingsContent key={`${property.id}:${property.slug}:${auth.user?.userId}:${auth.authenticated}`} property={property} />
  </PropertyBookingShell>;
}

function BookingsContent({ property }: { property: DirectSessionProperty }) {
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<PagedAccountBookingSessions | null>(null);
  const [error, setError] = useState("");
  useEffect(() => auth.registerInlineSessionRecovery?.(() => setResult(null)), [auth.registerInlineSessionRecovery]);
  useEffect(() => {
    if (auth.loading || !auth.authenticated) return;
    let active = true;
    setResult(null);
    setError("");
    void fetchAccountBookingSessions(page, 10, { propertyId: property.id, commissionType: 2 })
      .then((value) => {
        if (!active) return;
        // Defense in depth: never display a mixed or old, unfiltered API response.
        if (value.items.some((item) => item.property.propertyId !== property.id || item.property.slug !== property.slug || item.commissionType !== 2 || !item.reservations)) {
          throw new Error("پاسخ فهرست با اقامتگاه و کانال رزرو مطابقت ندارد.");
        }
        setResult(value);
      })
      .catch(() => { if (active) setError("دریافت رزروها انجام نشد. دوباره تلاش کنید."); });
    return () => { active = false; };
  }, [auth.authenticated, auth.loading, page, property.id, property.slug, retry]);

  return <main className="mx-auto grid max-w-5xl gap-5 px-4 py-8 sm:px-6" dir="rtl">
    <h1 className="text-2xl font-bold">رزروهای من</h1>
    {auth.loading ? <p role="status">در حال بررسی حساب...</p> : !auth.authenticated ?
      <section className="max-w-xl" aria-label="ورود برای مشاهده رزروها"><CheckoutIdentityStep intent="account" allowAlternateLogin={false} onAuthenticated={() => undefined} /></section>
      : error ? <><KoochAlert variant="destructive" role="alert">{error}</KoochAlert><KoochButton className="justify-self-start" onClick={() => setRetry((value) => value + 1)}>تلاش مجدد</KoochButton></>
      : !result ? <p role="status">در حال بارگذاری رزروها...</p>
      : result.items.length === 0 ? <KoochAlert variant="info">هنوز رزروی از لینک عمومی این اقامتگاه در حساب شما ثبت نشده است.</KoochAlert>
      : <section className="grid gap-4" aria-label="فهرست رزروهای اقامتگاه">
        {result.items.map((item) => <KoochCard className="grid gap-4" key={item.sessionCode}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold" dir="ltr">{item.sessionCode}</h2>
            <KoochBadge variant={orderStatusVariant(item.derivedStatus)}>{orderStatusLabels[item.derivedStatus] ?? item.derivedStatus}</KoochBadge>
          </div>
          <p>{item.checkInDate ? formatBookingDate(item.checkInDate) : "تاریخ ورود مشخص نیست"} تا {item.checkOutDate ? formatBookingDate(item.checkOutDate) : "تاریخ خروج مشخص نیست"}</p>
          <ul className="grid gap-2" aria-label="اتاق‌های رزرو">
            {item.reservations!.map((reservation) => <li className="flex flex-wrap justify-between gap-2 text-sm" key={reservation.reservationNumber}>
              <span>{reservation.roomTypeName}{reservation.roomName ? `، ${reservation.roomName}` : ""} · <b dir="ltr">{reservation.reservationNumber}</b></span>
              <span>{statusLabels[reservation.status] ?? reservation.status} · {formatCurrency(reservation.finalAmount, { currencyLabel })}</span>
            </li>)}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <strong>{formatCurrency(item.totalAmount, { currencyLabel })}</strong>
            <Link className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={directSessionHref(property, item.sessionCode)}>جزئیات رزرو و پرداخت</Link>
          </div>
        </KoochCard>)}
      </section>}
    {auth.authenticated && result && result.totalPages > 1 && <nav className="flex flex-wrap items-center justify-end gap-3" aria-label="صفحه‌بندی رزروها">
      <span>صفحه {result.page.toLocaleString("fa-IR")} از {result.totalPages.toLocaleString("fa-IR")}</span>
      <KoochButton variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>قبلی</KoochButton>
      <KoochButton variant="outline" disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>بعدی</KoochButton>
    </nav>}
  </main>;
}
