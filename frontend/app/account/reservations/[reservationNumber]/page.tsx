"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, type ReactNode, useRef, useState } from "react";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  type AccountReservation,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  isPaymentEligible,
  statusLabels,
  statusVariant,
  usePaymentCountdown,
} from "@/lib/account-reservations";
import { apiRequest, getAuthRole, getToken } from "@/lib/owner-api";

type DetailItemProps = {
  label: string;
  value: ReactNode;
};

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background px-3 py-2">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="min-h-6 text-sm font-bold text-foreground">{value}</dd>
    </div>
  );
}

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <KoochCard className="grid gap-3" padding="sm" variant="elevated">
      <h2 className="text-sm font-black text-foreground">{title}</h2>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </KoochCard>
  );
}

export default function AccountReservationDetailsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reservationNumber = decodeURIComponent(
    useParams<{ reservationNumber: string }>().reservationNumber,
  );
  const [reservation, setReservation] = useState<AccountReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const expiryRefreshStartedRef = useRef(false);
  const remainingSeconds = usePaymentCountdown(reservation);
  const paymentToken = searchParams.get("token");

  const loadReservation = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<AccountReservation>(
        `/account/reservations/${encodeURIComponent(reservationNumber)}`,
      );
      setReservation(response);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "خطا در دریافت جزئیات رزرو.",
      );
    } finally {
      setLoading(false);
    }
  }, [reservationNumber]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    if (getAuthRole() !== "Client") {
      router.replace("/");
      return;
    }

    void loadReservation();
  }, [loadReservation, router]);

  useEffect(() => {
    if (
      reservation?.status !== "ApprovedAwaitingPayment" ||
      remainingSeconds !== 0 ||
      expiryRefreshStartedRef.current
    ) {
      return;
    }

    expiryRefreshStartedRef.current = true;
    void loadReservation();
  }, [loadReservation, remainingSeconds, reservation?.status]);

  const eligible = reservation ? isPaymentEligible(reservation) : false;

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-5">
        <KoochPageHeader
          actions={
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
              href="/account/reservations"
            >
              بازگشت به رزروها
            </Link>
          }
          description={reservation?.reservationNumber ?? reservationNumber}
          eyebrow="حساب کاربری"
          title="جزئیات رزرو"
        />

        {error && (
          <KoochCard
            className="border-destructive/30 bg-destructive/10 text-destructive"
            padding="sm"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        {loading && !reservation ? (
          <KoochCard padding="sm" variant="elevated">
            <p className="text-sm font-semibold text-muted-foreground">
              در حال بارگذاری...
            </p>
          </KoochCard>
        ) : reservation ? (
          <>
            <KoochCard className="grid gap-4 md:grid-cols-[1fr_auto]" padding="md" variant="elevated">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <KoochBadge variant={statusVariant(reservation.status)}>
                    {statusLabels[reservation.status] ?? reservation.status}
                  </KoochBadge>
                  {reservation.status === "ApprovedAwaitingPayment" && (
                    <KoochBadge
                      variant={
                        reservation.isPaymentExpired || remainingSeconds === 0
                          ? "destructive"
                          : "warning"
                      }
                    >
                      {reservation.isPaymentExpired || remainingSeconds === 0
                        ? "مهلت پرداخت تمام شده است."
                        : `زمان باقی‌مانده: ${formatDuration(remainingSeconds)}`}
                    </KoochBadge>
                  )}
                </div>
                <p className="text-lg font-black text-foreground">
                  {reservation.propertyName}
                </p>
                <p className="text-sm font-semibold text-muted-foreground">
                  {reservation.roomTypeName}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {eligible ? (
                  paymentToken ? (
                    <KoochButton disabled>
                      پرداخت آنلاین هنوز فعال نیست
                    </KoochButton>
                  ) : (
                    <KoochButton disabled>
                      پرداخت با لینک ارسال‌شده انجام می‌شود
                    </KoochButton>
                  )
                ) : (
                  <KoochButton disabled variant="outline">
                    پرداخت لازم نیست
                  </KoochButton>
                )}
              </div>
            </KoochCard>

            <DetailSection title="رزرو">
              <DetailItem
                label="شماره رزرو"
                value={reservation.reservationNumber}
              />
              <DetailItem
                label="وضعیت"
                value={
                  <KoochBadge variant={statusVariant(reservation.status)}>
                    {statusLabels[reservation.status] ?? reservation.status}
                  </KoochBadge>
                }
              />
              <DetailItem
                label="تاریخ ایجاد"
                value={formatDateTime(reservation.createdAtUtc)}
              />
            </DetailSection>

            <DetailSection title="اقامت">
              <DetailItem label="اقامتگاه" value={reservation.propertyName} />
              <DetailItem label="اتاق" value={reservation.roomTypeName} />
              <DetailItem
                label="تاریخ ورود"
                value={formatDate(reservation.checkInDate)}
              />
              <DetailItem
                label="تاریخ خروج"
                value={formatDate(reservation.checkOutDate)}
              />
              <DetailItem
                label="تعداد شب"
                value={formatNumber(reservation.nightsCount)}
              />
              <DetailItem
                label="تعداد اتاق"
                value={formatNumber(reservation.roomCount)}
              />
              <DetailItem
                label="بزرگسال"
                value={formatNumber(reservation.adults)}
              />
              <DetailItem label="کودک" value={formatNumber(reservation.children)} />
            </DetailSection>

            <DetailSection title="مالی">
              <DetailItem
                label="مبلغ کل"
                value={formatMoney(
                  reservation.totalPrice ?? reservation.finalAmount,
                  reservation.currency,
                )}
              />
              <DetailItem
                label="پرداخت‌شده"
                value={formatMoney(reservation.paidAmount, reservation.currency)}
              />
              <DetailItem
                label="باقی‌مانده"
                value={formatMoney(
                  reservation.remainingAmount,
                  reservation.currency,
                )}
              />
              <DetailItem label="واحد پول" value={reservation.currency} />
            </DetailSection>

            <DetailSection title="پرداخت">
              <DetailItem
                label="مهلت پرداخت"
                value={formatDateTime(reservation.paymentExpiresAtUtc)}
              />
              <DetailItem
                label="زمان باقی‌مانده"
                value={
                  reservation.status === "ApprovedAwaitingPayment" ? (
                    <KoochBadge
                      variant={
                        reservation.isPaymentExpired || remainingSeconds === 0
                          ? "destructive"
                          : "warning"
                      }
                    >
                      {reservation.isPaymentExpired || remainingSeconds === 0
                        ? "مهلت پرداخت تمام شده است."
                        : formatDuration(remainingSeconds)}
                    </KoochBadge>
                  ) : (
                    "-"
                  )
                }
              />
              <DetailItem
                label="عملیات پرداخت"
                value={
                  eligible ? (
                    paymentToken ? (
                      "درگاه پرداخت هنوز فعال نشده است."
                    ) : (
                      "برای پرداخت از لینک ارسال‌شده استفاده کنید."
                    )
                  ) : (
                    "برای این رزرو پرداختی لازم نیست."
                  )
                }
              />
            </DetailSection>
          </>
        ) : (
          <KoochCard padding="sm" variant="elevated">
            <p className="text-sm font-semibold text-muted-foreground">
              رزرو پیدا نشد.
            </p>
          </KoochCard>
        )}
      </div>
    </main>
  );
}
