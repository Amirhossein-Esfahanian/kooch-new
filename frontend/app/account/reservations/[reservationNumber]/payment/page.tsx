"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  statusLabels,
  statusVariant,
} from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";

interface PaymentPreparationResponse {
  isValid: boolean;
  invalidReason?: string | null;
  reservationId?: number | null;
  reservationNumber: string;
  propertyName: string;
  roomTypeName: string;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  nightsCount: number;
  status?: string | null;
  totalPrice: number;
  paidAmount: number;
  remainingAmount: number;
  currency: string;
  paymentExpiresAtUtc?: string | null;
  remainingPaymentSeconds?: number | null;
  placeholderMessage: string;
}

interface PaymentPlaceholderResponse {
  isValid: boolean;
  message: string;
  placeholderReference?: string | null;
}

function buildBackendPath(
  reservationNumber: string,
  token: string,
  suffix = "",
) {
  const params = new URLSearchParams({ token });
  return `/api/backend/account/reservations/${encodeURIComponent(
    reservationNumber,
  )}/payment${suffix}?${params.toString()}`;
}

export default function ReservationPaymentPage() {
  const currencyLabel = useSiteCurrencyLabel();
  const reservationNumber = decodeURIComponent(
    useParams<{ reservationNumber: string }>().reservationNumber,
  );
  const token = useSearchParams().get("token") ?? "";
  const [preparation, setPreparation] =
    useState<PaymentPreparationResponse | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");
  const isExpired =
    !preparation?.isValid ||
    preparation.remainingPaymentSeconds === 0 ||
    remainingSeconds === 0;

  const loadPreparation = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(buildBackendPath(reservationNumber, token));
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "خطا در بررسی لینک پرداخت.");
      }

      const data = (await response.json()) as PaymentPreparationResponse;
      setPreparation(data);
      setRemainingSeconds(data.remainingPaymentSeconds ?? null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "خطا در بررسی لینک پرداخت.",
      );
      setPreparation({
        isValid: false,
        invalidReason: "لینک پرداخت معتبر نیست.",
        reservationNumber,
        propertyName: "",
        roomTypeName: "",
        nightsCount: 0,
        totalPrice: 0,
        paidAmount: 0,
        remainingAmount: 0,
        currency: "IRR",
        placeholderMessage: "لینک پرداخت معتبر نیست.",
      });
    } finally {
      setLoading(false);
    }
  }, [reservationNumber, token]);

  useEffect(() => {
    void loadPreparation();
  }, [loadPreparation]);

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) return;

    const timer = window.setTimeout(() => {
      setRemainingSeconds((current) =>
        current === null ? null : Math.max(0, current - 1),
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [remainingSeconds]);

  useEffect(() => {
    if (remainingSeconds !== 0 || !preparation?.isValid) return;
    void loadPreparation();
  }, [loadPreparation, preparation?.isValid, remainingSeconds]);

  async function continuePayment() {
    if (!preparation?.isValid || isExpired) return;

    setContinuing(true);
    setError("");

    try {
      const response = await fetch(
        buildBackendPath(reservationNumber, token, "/continue"),
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "خطا در ادامه پرداخت.");
      }

      const data = (await response.json()) as PaymentPlaceholderResponse;
      if (data.isValid) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
        await loadPreparation();
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "خطا در ادامه پرداخت.";
      setError(message);
      toast.error(message);
    } finally {
      setContinuing(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8" dir="rtl">
      <div className="mx-auto grid max-w-4xl gap-5">
        <KoochPageHeader
          actions={
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
              href={`/account/reservations/${encodeURIComponent(reservationNumber)}`}
            >
              جزئیات رزرو
            </Link>
          }
          description={reservationNumber}
          eyebrow="پرداخت رزرو"
          title="آماده‌سازی پرداخت"
        />

        {error && (
          <KoochCard
            className="border-destructive/30 bg-destructive/10 text-destructive"
            padding="sm"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        {loading && !preparation ? (
          <KoochCard padding="md" variant="elevated">
            <p className="text-sm font-semibold text-muted-foreground">
              در حال بررسی لینک پرداخت...
            </p>
          </KoochCard>
        ) : preparation ? (
          <>
            <KoochCard
              className={
                isExpired
                  ? "border-destructive/30 bg-destructive/10"
                  : "border-primary/30 bg-primary/10"
              }
              padding="md"
              variant="elevated"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="grid gap-2">
                  <KoochBadge variant={isExpired ? "destructive" : "success"}>
                    {isExpired ? "لینک نامعتبر یا منقضی" : "آماده پرداخت"}
                  </KoochBadge>
                  <p className="text-lg font-black text-foreground">
                    {isExpired
                      ? preparation.invalidReason ?? "لینک پرداخت معتبر نیست."
                      : "رزرو برای پرداخت آماده است."}
                  </p>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {preparation.placeholderMessage}
                  </p>
                </div>

                {preparation.isValid && (
                  <KoochBadge
                    variant={isExpired ? "destructive" : "warning"}
                  >
                    {isExpired
                      ? "مهلت تمام شد"
                      : `زمان باقی‌مانده: ${formatDuration(remainingSeconds)}`}
                  </KoochBadge>
                )}
              </div>
            </KoochCard>

            <KoochCard className="grid gap-4" padding="md" variant="elevated">
              <div className="grid gap-1">
                <p className="text-xs font-bold text-muted-foreground">
                  شماره رزرو
                </p>
                <p className="text-xl font-black text-foreground">
                  {preparation.reservationNumber}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <SummaryItem label="اقامتگاه" value={preparation.propertyName || "-"} />
                <SummaryItem label="اتاق" value={preparation.roomTypeName || "-"} />
                <SummaryItem
                  label="ورود"
                  value={formatDate(preparation.checkInDate)}
                />
                <SummaryItem
                  label="خروج"
                  value={formatDate(preparation.checkOutDate)}
                />
                <SummaryItem
                  label="وضعیت"
                  value={
                    preparation.status ? (
                      <KoochBadge variant={statusVariant(preparation.status)}>
                        {statusLabels[preparation.status] ?? preparation.status}
                      </KoochBadge>
                    ) : (
                      "-"
                    )
                  }
                />
                <SummaryItem
                  label="مهلت پرداخت"
                  value={formatDateTime(preparation.paymentExpiresAtUtc)}
                />
                <SummaryItem
                  label="مبلغ کل"
                  value={formatCurrency(preparation.totalPrice, {
                    currencyLabel,
                  })}
                />
                <SummaryItem
                  label="باقی‌مانده"
                  value={formatCurrency(preparation.remainingAmount, {
                    currencyLabel,
                  })}
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                <KoochButton
                  disabled={isExpired || !preparation.isValid}
                  loading={continuing}
                  onClick={continuePayment}
                >
                  ادامه پرداخت
                </KoochButton>
              </div>
            </KoochCard>
          </>
        ) : null}
      </div>
    </main>
  );
}

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background px-3 py-2">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="min-h-6 text-sm font-bold text-foreground">{value}</dd>
    </div>
  );
}
