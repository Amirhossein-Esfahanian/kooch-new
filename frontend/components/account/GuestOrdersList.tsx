"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
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
import { GuestBookingListSkeleton } from "./GuestBookingListSkeleton";
import styles from "./GuestBookingLists.module.css";

const PAGE_SIZE = 10;

export type GuestOrdersListProps =
  | { page: number; onPageChange: (page: number) => void }
  | { page?: undefined; onPageChange?: undefined };

export function GuestOrdersList({ page: controlledPage, onPageChange }: GuestOrdersListProps = {}) {
  const auth = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const [orders, setOrders] = useState<AccountBookingSessionListItem[]>([]);
  const [internalPage, setInternalPage] = useState(1);
  const page = controlledPage ?? internalPage;
  function setPage(nextPage: number) {
    if (controlledPage === undefined) setInternalPage(nextPage);
    onPageChange?.(nextPage);
  }
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
    if (!auth.loading && auth.authenticated && hasAccountWorkspace) void loadOrders();
  }, [auth.loading, auth.authenticated, hasAccountWorkspace, loadOrders]);

  return (
    <div className={styles.list}>
      {error && <KoochAlert variant="destructive" icon={null} className={styles.error}>
        <p>{error}</p>
        <KoochButton type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadOrders()}>تلاش دوباره</KoochButton>
      </KoochAlert>}

      {loading ? <GuestBookingListSkeleton kind="orders" /> : orders.length === 0 ? (
        !error && <KoochCard className={styles.empty}>
          <h2>هنوز سفارشی ثبت نشده است</h2>
          <p>پس از انتخاب و ثبت یک یا چند اتاق، سفارش شما در این بخش نمایش داده می‌شود.</p>
          <Link className={styles.detailLink} href="/">مشاهده اقامتگاه‌ها</Link>
        </KoochCard>
      ) : (
        <section aria-label="فهرست سفارش‌ها" className={styles.list}>
          {orders.map(order => <OrderCard currencyLabel={currencyLabel} key={order.sessionCode} order={order} />)}
        </section>
      )}

      {totalPages > 1 && <nav aria-label="صفحه‌بندی سفارش‌ها" className={styles.pagination}>
        <span>صفحه {page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}</span>
        <div>
          <KoochButton disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} size="sm" variant="outline">قبلی</KoochButton>
          <KoochButton disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)} size="sm" variant="outline">بعدی</KoochButton>
        </div>
      </nav>}
    </div>
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
    <KoochCard className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.identity}>
          <div className={styles.reference}><span>کد سفارش</span>
            <Link dir="ltr" href={`/account/booking-sessions/${encodeURIComponent(order.sessionCode)}`}>{order.sessionCode}</Link>
          </div>
          <h2>{order.property.name}</h2>
        </div>
        <div className={styles.statuses}>
          <KoochBadge variant={orderStatusVariant(order.derivedStatus)}>
            {orderStatusLabels[order.derivedStatus] ?? "وضعیت ترکیبی"}
          </KoochBadge>
          {order.paymentStatus && <KoochBadge variant={order.paymentStatus === "Successful" ? "success" : order.paymentStatus === "Failed" ? "destructive" : "muted"}>
            {paymentStatusLabels[order.paymentStatus] ?? order.paymentStatus}
          </KoochBadge>}
        </div>
      </div>
      <dl className={`${styles.facts} ${styles.orderFacts}`}>
        <div><dt>تاریخ اقامت</dt><dd>{stayDates}</dd></div>
        <div><dt>رزروهای سفارش</dt><dd>{order.reservationCount.toLocaleString("fa-IR")} رزرو مستقل</dd></div>
        <div><dt>{order.derivedStatus === "Mixed" ? "رزروها و مبلغ اولیه سفارش" : "رزروها و مبلغ کل"}</dt>
          <dd>{formatCurrency(order.totalAmount, { currencyLabel })}</dd></div>
      </dl>
      <div className={styles.cardFooter}>
        {order.paymentDeadlineUtc && <div aria-live="off" className={styles.deadline}>
          <span>مهلت پرداخت</span><span>{formatDuration(remainingSeconds)}</span>
        </div>}
        <div className={styles.actions}>
          <Link className={styles.detailLink} href={`/account/booking-sessions/${encodeURIComponent(order.sessionCode)}`}>جزئیات</Link>
          {canContinuePayment && order.derivedStatus !== "Mixed" && <Link className={styles.paymentLink} href={`/account/booking-sessions/${encodeURIComponent(order.sessionCode)}`}>
            {order.paymentStatus === "Failed" ? "تلاش مجدد برای پرداخت" : "ادامه پرداخت"}
          </Link>}
        </div>
      </div>
    </KoochCard>
  );
}
