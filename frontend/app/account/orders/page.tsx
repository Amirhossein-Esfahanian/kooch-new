"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  isMockPaymentUiEnabled,
  orderStatusLabels,
  orderStatusVariant,
  paymentStatusLabels,
  useOrderPaymentCountdown,
} from "@/lib/account-orders";
import { formatDate, formatDuration } from "@/lib/account-reservations";
import {
  fetchAccountBookingSessions,
  type AccountBookingSessionListItem,
} from "@/lib/booking-sessions";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";

const PAGE_SIZE = 10;

export default function AccountOrdersPage() {
  const router = useRouter();
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [orders, setOrders] = useState<AccountBookingSessionListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasAccountWorkspace = auth.workspaces.includes("account");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAccountBookingSessions(page, PAGE_SIZE);
      setOrders(result.items);
      setTotalPages(result.totalPages);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "دریافت سفارش‌ها انجام نشد.",
      );
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.authenticated) {
      router.replace(
        `/login?returnTo=${encodeURIComponent("/account/orders")}`,
      );
      return;
    }
    if (!hasAccountWorkspace) {
      router.replace(resolveSessionDestination(auth));
      return;
    }
    void loadOrders();
  }, [auth, hasAccountWorkspace, loadOrders, router]);

  if (auth.loading || !auth.authenticated || !hasAccountWorkspace) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
        role="status"
      >
        در حال آماده‌سازی سفارش‌ها...
      </div>
    );
  }

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8"
      dir="rtl"
    >
      <div className="mx-auto grid max-w-6xl gap-5">
        <KoochPageHeader
          actions={
            <div className="flex flex-wrap gap-2">
              <KoochButton
                onClick={() => router.push("/account/reservations")}
                variant="outline"
              >
                رزروهای مستقل
              </KoochButton>
              <KoochButton
                onClick={() => router.push("/account")}
                variant="ghost"
              >
                حساب کاربری
              </KoochButton>
            </div>
          }
          description="هر سفارش یک یا چند رزرو مستقل از یک اقامتگاه را در یک پرداخت گروه‌بندی می‌کند."
          eyebrow="حساب کاربری"
          title="سفارش‌های من"
        />

        {error && <KoochAlert variant="destructive">{error}</KoochAlert>}

        {loading ? (
          <KoochCard
            className="py-12 text-center text-sm font-semibold text-muted-foreground"
            role="status"
          >
            در حال بارگذاری سفارش‌ها...
          </KoochCard>
        ) : orders.length === 0 ? (
          <KoochCard className="grid justify-items-center gap-3 py-12 text-center">
            <h2 className="text-lg font-bold">هنوز سفارشی ثبت نشده است</h2>
            <p className="max-w-xl text-sm leading-7 text-muted-foreground">
              پس از انتخاب و ثبت یک یا چند اتاق، سفارش شما در این بخش نمایش داده
              می‌شود.
            </p>
            <Link
              className="font-semibold text-primary hover:underline"
              href="/"
            >
              مشاهده اقامتگاه‌ها
            </Link>
          </KoochCard>
        ) : (
          <section aria-label="فهرست سفارش‌ها" className="grid gap-4">
            {orders.map((order) => (
              <OrderCard
                currencyLabel={currencyLabel}
                key={order.sessionCode}
                order={order}
              />
            ))}
          </section>
        )}

        {totalPages > 1 && (
          <nav
            aria-label="صفحه‌بندی سفارش‌ها"
            className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground"
          >
            <span>
              صفحه {page.toLocaleString("fa-IR")} از{" "}
              {totalPages.toLocaleString("fa-IR")}
            </span>
            <div className="flex gap-2">
              <KoochButton
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => value - 1)}
                size="sm"
                variant="outline"
              >
                قبلی
              </KoochButton>
              <KoochButton
                disabled={page >= totalPages || loading}
                onClick={() => setPage((value) => value + 1)}
                size="sm"
                variant="outline"
              >
                بعدی
              </KoochButton>
            </div>
          </nav>
        )}
      </div>
    </main>
  );
}

function OrderCard({
  currencyLabel,
  order,
}: {
  currencyLabel: string;
  order: AccountBookingSessionListItem;
}) {
  const remainingSeconds = useOrderPaymentCountdown(
    order.paymentDeadlineUtc,
    order.sessionCode,
  );
  const canContinuePayment = Boolean(
    isMockPaymentUiEnabled() &&
    order.isPaymentReady &&
    remainingSeconds !== null &&
    remainingSeconds > 0 &&
    order.paymentStatus !== "Successful",
  );
  const stayDates =
    order.checkInDate && order.checkOutDate
      ? `${formatDate(order.checkInDate)} تا ${formatDate(order.checkOutDate)}`
      : "تاریخ اقامت ثبت نشده";

  return (
    <KoochCard className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <p className="text-xs font-bold text-muted-foreground">کد سفارش</p>
          <Link
            className="mt-1 block truncate font-bold text-primary hover:underline"
            dir="ltr"
            href={`/account/booking-sessions/${encodeURIComponent(order.sessionCode)}`}
          >
            {order.sessionCode}
          </Link>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-muted-foreground">
            اقامتگاه و تاریخ
          </p>
          <p className="mt-1 truncate text-sm font-bold">
            {order.property.name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{stayDates}</p>
        </div>
        <div>
          <p className="text-xs font-bold text-muted-foreground">
            {order.derivedStatus === "Mixed"
              ? "رزروها و مبلغ اولیه سفارش"
              : "رزروها و مبلغ کل"}
          </p>
          <p className="mt-1 text-sm font-bold">
            {order.reservationCount.toLocaleString("fa-IR")} رزرو مستقل
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCurrency(order.totalAmount, { currencyLabel })}
          </p>
        </div>
        <div className="flex flex-wrap content-start gap-2">
          <KoochBadge variant={orderStatusVariant(order.derivedStatus)}>
            {orderStatusLabels[order.derivedStatus] ?? "وضعیت ترکیبی"}
          </KoochBadge>
          {order.paymentStatus && (
            <KoochBadge
              variant={
                order.paymentStatus === "Successful"
                  ? "success"
                  : order.paymentStatus === "Failed"
                    ? "destructive"
                    : "muted"
              }
            >
              {paymentStatusLabels[order.paymentStatus] ?? order.paymentStatus}
            </KoochBadge>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 lg:justify-end">
        {order.paymentDeadlineUtc && (
          <div
            aria-live="off"
            className="min-w-36 text-xs text-muted-foreground"
          >
            <span className="block font-bold text-foreground">مهلت پرداخت</span>
            <span>{formatDuration(remainingSeconds)}</span>
          </div>
        )}
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href={`/account/booking-sessions/${encodeURIComponent(order.sessionCode)}`}
        >
          جزئیات
        </Link>
        {canContinuePayment && order.derivedStatus !== "Mixed" && (
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            href={`/account/booking-sessions/${encodeURIComponent(order.sessionCode)}`}
          >
            {order.paymentStatus === "Failed"
              ? "تلاش مجدد برای پرداخت"
              : "ادامه پرداخت"}
          </Link>
        )}
      </div>
    </KoochCard>
  );
}
