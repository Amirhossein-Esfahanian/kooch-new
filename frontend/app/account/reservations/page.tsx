"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
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
  formatMoney,
  isPaymentEligible,
  statusLabels,
  statusVariant,
} from "@/lib/account-reservations";
import { apiRequest, getAuthRole, getToken } from "@/lib/owner-api";

const pageSize = 10;

function buildPath(page: number) {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
    sort: "createddesc",
  });

  return `/account/reservations?${params.toString()}`;
}

export default function AccountReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<AccountReservation[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
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

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    if (getAuthRole() !== "Client") {
      router.replace("/");
      return;
    }

    void loadReservations();
  }, [loadReservations, router]);

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8"
      dir="rtl"
    >
      <div className="mx-auto grid max-w-6xl gap-5">
        <KoochPageHeader
          actions={
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
              href="/"
            >
              بازگشت به خانه
            </Link>
          }
          description="رزروهایی که با حساب مهمان شما ثبت شده‌اند."
          eyebrow="حساب کاربری"
          title="رزروهای من"
        />

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
              <KoochTableHead>مبلغ کل</KoochTableHead>
              <KoochTableHead>باقی‌مانده</KoochTableHead>
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
                    <KoochTableCell>{reservation.roomTypeName}</KoochTableCell>
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
                      {formatMoney(
                        reservation.totalPrice ?? reservation.finalAmount,
                        reservation.currency,
                      )}
                    </KoochTableCell>
                    <KoochTableCell className="whitespace-nowrap">
                      {formatMoney(
                        reservation.remainingAmount,
                        reservation.currency,
                      )}
                    </KoochTableCell>
                    <KoochTableCell>
                      {reservation.status === "ApprovedAwaitingPayment" ? (
                        <div className="grid gap-1">
                          <KoochBadge
                            variant={eligible ? "warning" : "destructive"}
                          >
                            {reservation.isPaymentExpired
                              ? "مهلت گذشته"
                              : formatDuration(
                                  reservation.remainingPaymentSeconds,
                                )}
                          </KoochBadge>
                          {reservation.paymentExpiresAtUtc && (
                            <span className="text-xs text-muted-foreground">
                              تا {formatDate(reservation.paymentExpiresAtUtc)}
                            </span>
                          )}
                        </div>
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
                onClick={() => setCurrentPage((page) => page - 1)}
                size="sm"
                variant="outline"
              >
                قبلی
              </KoochButton>
              <KoochButton
                disabled={currentPage >= totalPages || loading}
                onClick={() => setCurrentPage((page) => page + 1)}
                size="sm"
                variant="outline"
              >
                بعدی
              </KoochButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
