"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { KoochBadge } from "@/components/KoochBadge";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { GuestBookingListSkeleton } from "./GuestBookingListSkeleton";
import styles from "./GuestBookingLists.module.css";
import {
  type AccountReservation,
  type PagedResult,
  formatDate,
  formatDuration,
  isPaymentEligible,
  statusLabels,
  statusVariant,
  usePaymentCountdown,
} from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { apiRequest } from "@/lib/owner-api";

const pageSize = 10;

function buildPath(page: number) {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
    sort: "createddesc",
  });

  return `/account/reservations?${params.toString()}`;
}

function ReservationPaymentCountdown({
  onExpired,
  reservation,
}: {
  onExpired: () => void | Promise<void>;
  reservation: AccountReservation;
}) {
  const refreshStartedRef = useRef(false);
  const remainingSeconds = usePaymentCountdown(reservation);
  const expired =
    reservation.isPaymentExpired || remainingSeconds === 0;

  useEffect(() => {
    refreshStartedRef.current = false;
  }, [reservation.paymentExpiresAtUtc, reservation.reservationId]);

  useEffect(() => {
    if (remainingSeconds !== 0 || refreshStartedRef.current) return;

    refreshStartedRef.current = true;
    void onExpired();
  }, [onExpired, remainingSeconds]);

  return (
    <div className={styles.countdown}>
      <KoochBadge variant={expired ? "destructive" : "warning"}>
        {expired ? "مهلت گذشته" : formatDuration(remainingSeconds)}
      </KoochBadge>
      {reservation.paymentExpiresAtUtc && (
        <span className="text-xs text-muted-foreground">
          تا {formatDate(reservation.paymentExpiresAtUtc)}
        </span>
      )}
    </div>
  );
}

export type GuestReservationsListProps =
  | { page: number; onPageChange: (page: number) => void }
  | { page?: undefined; onPageChange?: undefined };

export function GuestReservationsList({ page: controlledPage, onPageChange }: GuestReservationsListProps = {}) {
  const session = useAuthSession();
  const currencyLabel = useSiteCurrencyLabel();
  const { authenticated, loading: sessionLoading, workspaces } = session;
  const [reservations, setReservations] = useState<AccountReservation[]>([]);
  const [internalPage, setInternalPage] = useState(1);
  const currentPage = controlledPage ?? internalPage;
  function setCurrentPage(nextPage: number) {
    if (controlledPage === undefined) setInternalPage(nextPage);
    onPageChange?.(nextPage);
  }
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<PagedResult<AccountReservation>>(
        buildPath(currentPage),
      );
      setReservations(response.items);
      setTotalPages(response.totalPages);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "خطا در دریافت رزروها.",
      );
    } finally {
      setLoading(false);
    }
  }, [currentPage]);

  const hasAccountWorkspace = workspaces.includes("account");
  useEffect(() => {
    if (!sessionLoading && authenticated && hasAccountWorkspace) void loadReservations();
  }, [authenticated, hasAccountWorkspace, loadReservations, sessionLoading]);

  return (
    <div className={styles.list}>
      {error && <KoochCard className={styles.error} padding="sm" role="alert">
        <p>{error}</p>
        <KoochButton type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadReservations()}>تلاش دوباره</KoochButton>
      </KoochCard>}

      {loading ? <GuestBookingListSkeleton kind="reservations" /> : reservations.length === 0 ? (
        !error && <KoochCard className={styles.empty}>
          <h2>هنوز رزروی برای حساب شما ثبت نشده است.</h2>
          <p>رزروهای مستقل شما و جزئیات هر اقامت در این بخش نمایش داده می‌شوند.</p>
          <Link className={styles.detailLink} href="/properties">جستجوی اقامتگاه</Link>
        </KoochCard>
      ) : (
        <section aria-label="فهرست رزروها" className={styles.list}>
          {reservations.map(reservation => {
            const eligible = isPaymentEligible(reservation);
            return <KoochCard key={reservation.reservationId} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.identity}>
                  <p className={styles.reference}>شماره رزرو <bdi dir="ltr">{reservation.reservationNumber}</bdi></p>
                  <h2>{reservation.propertyName}</h2>
                  <p>{reservation.roomName || reservation.roomTypeName}</p>
                </div>
                <KoochBadge variant={statusVariant(reservation.status)}>
                  {statusLabels[reservation.status] ?? reservation.status}
                </KoochBadge>
              </div>
              <dl className={styles.facts}>
                <div><dt>ورود</dt><dd><time dateTime={reservation.checkInDate}>{formatDate(reservation.checkInDate)}</time></dd></div>
                <div><dt>خروج</dt><dd><time dateTime={reservation.checkOutDate}>{formatDate(reservation.checkOutDate)}</time></dd></div>
                <div><dt>مبلغ کل ({currencyLabel})</dt><dd>{formatCurrency(reservation.finalAmount ?? reservation.totalPrice, { showCurrency: false })}</dd></div>
                <div><dt>باقی‌مانده ({currencyLabel})</dt><dd>{formatCurrency(reservation.remainingAmount, { showCurrency: false })}</dd></div>
              </dl>
              <div className={styles.cardFooter}>
                {reservation.status === "ApprovedAwaitingPayment" && <div className={styles.deadline}>
                  <span>مهلت پرداخت</span>
                  <ReservationPaymentCountdown onExpired={loadReservations} reservation={reservation} />
                </div>}
                <div className={styles.actions}>
                  <Link className={styles.detailLink} href={`/account/reservations/${encodeURIComponent(reservation.reservationNumber)}`}>جزئیات</Link>
                  {eligible && <Link className={styles.paymentLink} href={`/account/reservations/${encodeURIComponent(reservation.reservationNumber)}`}>پرداخت</Link>}
                </div>
              </div>
            </KoochCard>;
          })}
        </section>
      )}

      {totalPages > 1 && <nav aria-label="صفحه‌بندی رزروها" className={styles.pagination}>
        <span>صفحه {new Intl.NumberFormat("fa-IR").format(currentPage)} از {new Intl.NumberFormat("fa-IR").format(totalPages)}</span>
        <div>
          <KoochButton disabled={currentPage <= 1 || loading} onClick={() => setCurrentPage(currentPage - 1)} size="sm" variant="outline">قبلی</KoochButton>
          <KoochButton disabled={currentPage >= totalPages || loading} onClick={() => setCurrentPage(currentPage + 1)} size="sm" variant="outline">بعدی</KoochButton>
        </div>
      </nav>}
    </div>
  );
}
