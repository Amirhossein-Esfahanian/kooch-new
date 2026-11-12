"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { KoochBadge } from "@/components/KoochBadge";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
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
    <div className="grid gap-1">
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
    <>
        {error && (
          <KoochCard
            className="border-destructive/30 bg-destructive/10 text-destructive"
            padding="sm"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        <KoochTable>
          <KoochTableHeader>
            <KoochTableRow>
              <KoochTableHead>شماره رزرو</KoochTableHead>
              <KoochTableHead>اقامتگاه</KoochTableHead>
              <KoochTableHead>اتاق</KoochTableHead>
              <KoochTableHead>ورود</KoochTableHead>
              <KoochTableHead>خروج</KoochTableHead>
              <KoochTableHead>وضعیت</KoochTableHead>
              <KoochTableHead>مبلغ کل ({currencyLabel})</KoochTableHead>
              <KoochTableHead>باقی‌مانده ({currencyLabel})</KoochTableHead>
              <KoochTableHead>پرداخت</KoochTableHead>
              <KoochTableHead>عملیات</KoochTableHead>
            </KoochTableRow>
          </KoochTableHeader>
          <KoochTableBody>
            {loading ? (
              <KoochTableEmpty colSpan={10}>در حال بارگذاری...</KoochTableEmpty>
            ) : reservations.length === 0 ? (
              <KoochTableEmpty colSpan={10}>
                هنوز رزروی برای حساب شما ثبت نشده است.
              </KoochTableEmpty>
            ) : (
              reservations.map((reservation) => {
                const eligible = isPaymentEligible(reservation);
                return (
                  <KoochTableRow key={reservation.reservationId}>
                    <KoochTableCell className="font-semibold">
                      {reservation.reservationNumber}
                    </KoochTableCell>
                    <KoochTableCell>{reservation.propertyName}</KoochTableCell>
                    <KoochTableCell>
                      {reservation.roomName || reservation.roomTypeName}
                    </KoochTableCell>
                    <KoochTableCell className="whitespace-nowrap">
                      {formatDate(reservation.checkInDate)}
                    </KoochTableCell>
                    <KoochTableCell className="whitespace-nowrap">
                      {formatDate(reservation.checkOutDate)}
                    </KoochTableCell>
                    <KoochTableCell>
                      <KoochBadge variant={statusVariant(reservation.status)}>
                        {statusLabels[reservation.status] ?? reservation.status}
                      </KoochBadge>
                    </KoochTableCell>
                    <KoochTableCell className="whitespace-nowrap font-semibold">
                      {formatCurrency(
                        reservation.finalAmount ?? reservation.totalPrice,
                        { showCurrency: false },
                      )}
                    </KoochTableCell>
                    <KoochTableCell className="whitespace-nowrap">
                      {formatCurrency(reservation.remainingAmount, {
                        showCurrency: false,
                      })}
                    </KoochTableCell>
                    <KoochTableCell>
                      {reservation.status === "ApprovedAwaitingPayment" ? (
                        <ReservationPaymentCountdown
                          onExpired={loadReservations}
                          reservation={reservation}
                        />
                      ) : (
                        "-"
                      )}
                    </KoochTableCell>
                    <KoochTableCell>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          className="inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                          href={`/account/reservations/${encodeURIComponent(
                            reservation.reservationNumber,
                          )}`}
                        >
                          جزئیات
                        </Link>
                        {eligible && (
                          <Link
                            className="inline-flex min-h-9 items-center justify-center rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)]"
                            href={`/account/reservations/${encodeURIComponent(
                              reservation.reservationNumber,
                            )}`}
                          >
                            پرداخت
                          </Link>
                        )}
                      </div>
                    </KoochTableCell>
                  </KoochTableRow>
                );
              })
            )}
          </KoochTableBody>
        </KoochTable>

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground">
            <span>
              صفحه {new Intl.NumberFormat("fa-IR").format(currentPage)} از{" "}
              {new Intl.NumberFormat("fa-IR").format(totalPages)}
            </span>
            <div className="flex items-center gap-2">
              <KoochButton
                disabled={currentPage <= 1 || loading}
                onClick={() => setCurrentPage(currentPage - 1)}
                size="sm"
                variant="outline"
              >
                قبلی
              </KoochButton>
              <KoochButton
                disabled={currentPage >= totalPages || loading}
                onClick={() => setCurrentPage(currentPage + 1)}
                size="sm"
                variant="outline"
              >
                بعدی
              </KoochButton>
            </div>
          </div>
        )}
    </>
  );
}
