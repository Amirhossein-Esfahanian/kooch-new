"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { KoochBadge } from "@/components/KoochBadge";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  type AccountCancellationReason,
  type AccountCancellationRequest,
  type AccountReservation,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  isPaymentEligible,
  statusLabels,
  statusVariant,
  usePaymentCountdown,
} from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { apiRequest, ApiRequestError } from "@/lib/owner-api";

const cancellationReasons = [
  ["GuestRequest", "درخواست مهمان"],
  ["NonPayment", "عدم پرداخت"],
  ["NoAvailability", "نبود ظرفیت"],
  ["PropertyRuleConflict", "تعارض با قوانین اقامتگاه"],
  ["DuplicateReservation", "رزرو تکراری"],
  ["InvalidGuestInformation", "اطلاعات نامعتبر مهمان"],
  ["PropertyMaintenanceOrForceMajeure", "تعمیرات اقامتگاه / شرایط اضطراری"],
  ["AdministrativeCorrection", "اصلاح اداری"],
  ["Other", "سایر"],
  ["PaymentExpired", "پایان مهلت پرداخت"],
] as const satisfies readonly (readonly [AccountCancellationReason, string])[];

const cancellationReasonLabels = Object.fromEntries(cancellationReasons);
const cancellationRequestSchema = z.object({
  reason: z.string().min(1, "دلیل درخواست را انتخاب کنید.").refine(
    (value) => cancellationReasons.some(([reason]) => reason === value),
    "دلیل درخواست معتبر نیست.",
  ),
  message: z.string().max(2000, "پیام نمی‌تواند بیش از ۲۰۰۰ نویسه باشد."),
});

type CancellationRequestForm = z.infer<typeof cancellationRequestSchema>;

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
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </KoochCard>
  );
}

export default function AccountReservationDetailsPage() {
  const currencyLabel = useSiteCurrencyLabel();
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading: sessionLoading, workspaces } = session;
  const searchParams = useSearchParams();
  const reservationNumber = decodeURIComponent(
    useParams<{ reservationNumber: string }>().reservationNumber,
  );
  const [reservation, setReservation] = useState<AccountReservation | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancellationRequest, setCancellationRequest] = useState<AccountCancellationRequest | null>(null);
  const [requestLoading, setRequestLoading] = useState(true);
  const [requestError, setRequestError] = useState("");
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submittingRef = useRef(false);
  const requestForm = useForm<CancellationRequestForm>({
    resolver: zodResolver(cancellationRequestSchema),
    defaultValues: { reason: "", message: "" },
  });
  const expiryRefreshStartedRef = useRef(false);
  const remainingSeconds = usePaymentCountdown(reservation);
  const paymentToken = searchParams.get("token");
  const paymentHref = paymentToken
    ? `/account/reservations/${encodeURIComponent(
        reservationNumber,
      )}/payment?token=${encodeURIComponent(paymentToken)}`
    : null;

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
        caught instanceof Error ? caught.message : "خطا در دریافت جزئیات رزرو.",
      );
    } finally {
      setLoading(false);
    }
  }, [reservationNumber]);

  const loadCancellationRequest = useCallback(async () => {
    setRequestLoading(true);
    setRequestError("");
    try {
      const response = await apiRequest<AccountCancellationRequest>(
        `/account/reservations/${encodeURIComponent(reservationNumber)}/cancellation-request`,
      );
      setCancellationRequest(response);
      return response;
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 404) {
        setCancellationRequest(null);
        return null;
      }
      setRequestError(caught instanceof Error ? caught.message : "خطا در دریافت وضعیت درخواست لغو.");
      return null;
    } finally {
      setRequestLoading(false);
    }
  }, [reservationNumber]);

  function openRequestDialog() {
    requestForm.reset({ reason: "", message: "" });
    setSubmitError("");
    setRequestDialogOpen(true);
  }

  const submitCancellationRequest = requestForm.handleSubmit(async (values) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError("");
    try {
      await apiRequest<AccountCancellationRequest>(
        `/account/reservations/${encodeURIComponent(reservationNumber)}/cancellation-request`,
        { method: "POST", body: JSON.stringify({
          reason: values.reason,
          message: values.message.trim() || null,
        }) },
      );
      setRequestDialogOpen(false);
      await Promise.all([loadReservation(), loadCancellationRequest()]);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 409) {
        const latest = await loadCancellationRequest();
        if (latest?.status === "Pending") {
          setRequestDialogOpen(false);
          return;
        }
      }
      setSubmitError(caught instanceof Error ? caught.message : "ثبت درخواست لغو انجام نشد.");
    } finally {
      submittingRef.current = false;
    }
  });

  useEffect(() => {
    if (sessionLoading) return;

    if (!authenticated) {
      router.replace("/login");
      return;
    }

    if (!workspaces.includes("account")) {
      router.replace(resolveSessionDestination(session));
      return;
    }

    void loadReservation();
    void loadCancellationRequest();
  }, [
    authenticated,
    loadReservation,
    loadCancellationRequest,
    router,
    session,
    sessionLoading,
    workspaces,
  ]);

  useEffect(() => {
    expiryRefreshStartedRef.current = false;
  }, [reservation?.paymentExpiresAtUtc, reservation?.reservationId]);

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
    <main
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8"
      dir="rtl"
    >
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
            <KoochCard
              className="grid gap-4 md:grid-cols-[1fr_auto]"
              padding="md"
              variant="elevated"
            >
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
                <p className="text-lg font-bold text-foreground">
                  {reservation.propertyName}
                </p>
                <p className="text-sm font-semibold text-muted-foreground">
                  {reservation.roomName || reservation.roomTypeName}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <KoochButton variant="outline" onClick={() => router.push(`/account/reservations/${encodeURIComponent(reservation.reservationNumber)}/voucher`)}>
                  مشاهده ووچر
                </KoochButton>
                {eligible ? (
                  paymentHref ? (
                    <Link
                      className="inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)]"
                      href={paymentHref}
                    >
                      ادامه پرداخت
                    </Link>
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

            <KoochCard className="grid gap-3" padding="sm" variant="muted">
              <h2 className="text-sm font-bold text-foreground">درخواست لغو رزرو</h2>
              {requestLoading ? (
                <p className="text-sm text-muted-foreground">در حال دریافت وضعیت درخواست...</p>
              ) : requestError ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-destructive" role="alert">{requestError}</p>
                  <KoochButton onClick={() => void loadCancellationRequest()} size="sm" variant="outline">
                    تلاش دوباره
                  </KoochButton>
                </div>
              ) : cancellationRequest ? (
                <div className="grid gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <KoochBadge variant={cancellationRequest.status === "Pending" ? "warning" : "muted"}>
                      {cancellationRequest.status === "Pending"
                        ? "درخواست لغو در حال بررسی است"
                        : cancellationRequest.status === "Rejected"
                          ? "درخواست لغو رد شد"
                          : "درخواست لغو انجام شد"}
                    </KoochBadge>
                    <span className="text-muted-foreground">
                      وضعیت رزرو: {statusLabels[reservation.status] ?? reservation.status}
                    </span>
                  </div>
                  {cancellationRequest.status === "Pending" && (
                    <p className="text-muted-foreground">درخواست لغو ثبت شده است، اما رزرو هنوز لغو نشده است.</p>
                  )}
                  <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">دلیل درخواست</dt>
                      <dd className="text-foreground">{cancellationReasonLabels[cancellationRequest.reason] ?? cancellationRequest.reason}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">زمان درخواست</dt>
                      <dd className="text-foreground">{formatDateTime(cancellationRequest.requestedAtUtc)}</dd></div>
                    {cancellationRequest.message && (
                      <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">پیام شما</dt>
                        <dd className="whitespace-pre-wrap text-foreground">{cancellationRequest.message}</dd></div>
                    )}
                    {cancellationRequest.resolvedAtUtc && (
                      <div><dt className="text-xs text-muted-foreground">زمان بررسی</dt>
                        <dd className="text-foreground">{formatDateTime(cancellationRequest.resolvedAtUtc)}</dd></div>
                    )}
                  </dl>
                  {cancellationRequest.status === "Rejected" && reservation.status !== "Cancelled" && (
                    <KoochButton className="justify-self-start" onClick={openRequestDialog} size="sm" variant="outline">
                      درخواست لغو رزرو
                    </KoochButton>
                  )}
                </div>
              ) : reservation.status !== "Cancelled" ? (
                <KoochButton className="justify-self-start" onClick={openRequestDialog} size="sm" variant="outline">
                  درخواست لغو رزرو
                </KoochButton>
              ) : (
                <p className="text-sm text-muted-foreground">این رزرو لغو شده است.</p>
              )}
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
              <DetailItem
                label="اتاق"
                value={reservation.roomName || reservation.roomTypeName}
              />
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
              <DetailItem
                label="کودک"
                value={formatNumber(reservation.children)}
              />
            </DetailSection>

            <DetailSection title="مالی">
              <DetailItem
                label="مبلغ کل"
                value={formatCurrency(
                  reservation.finalAmount ?? reservation.totalPrice,
                  { currencyLabel },
                )}
              />
              <DetailItem
                label="پرداخت‌شده"
                value={formatCurrency(reservation.paidAmount, {
                  currencyLabel,
                })}
              />
              <DetailItem
                label="باقی‌مانده"
                value={formatCurrency(reservation.remainingAmount, {
                  currencyLabel,
                })}
              />
              <DetailItem label="واحد پول" value={currencyLabel} />
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
                  eligible
                    ? paymentToken
                      ? "درگاه پرداخت هنوز فعال نشده است."
                      : "برای پرداخت از لینک ارسال‌شده استفاده کنید."
                    : "برای این رزرو پرداختی لازم نیست."
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

      <KoochDialog
        closeDisabled={requestForm.formState.isSubmitting}
        description="ثبت این درخواست به معنی لغو شدن رزرو نیست. درخواست شما توسط پشتیبانی بررسی خواهد شد."
        footer={<>
          <KoochButton disabled={requestForm.formState.isSubmitting} onClick={() => setRequestDialogOpen(false)} variant="outline">
            انصراف
          </KoochButton>
          <KoochButton form="guest-cancellation-request-form" loading={requestForm.formState.isSubmitting} type="submit">
            ثبت درخواست
          </KoochButton>
        </>}
        onOpenChange={(nextOpen) => {
          if (!requestForm.formState.isSubmitting) setRequestDialogOpen(nextOpen);
        }}
        open={requestDialogOpen}
        size="sm"
        title="درخواست لغو رزرو"
      >
        <form className="grid gap-4" id="guest-cancellation-request-form" onSubmit={submitCancellationRequest}>
          <Controller control={requestForm.control} name="reason" render={({ field }) => (
            <KoochField error={requestForm.formState.errors.reason?.message} label="دلیل درخواست" required>
              <KoochSelect name={field.name} onBlur={field.onBlur} onChange={field.onChange} value={field.value}>
                <option value="">انتخاب دلیل</option>
                {cancellationReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </KoochSelect>
            </KoochField>
          )} />
          <Controller control={requestForm.control} name="message" render={({ field }) => (
            <KoochField error={requestForm.formState.errors.message?.message} label="پیام (اختیاری)">
              <KoochTextarea maxLength={2000} name={field.name} onBlur={field.onBlur}
                onChange={field.onChange} rows={3} value={field.value} />
            </KoochField>
          )} />
          {submitError && <p className="text-sm text-destructive" role="alert">{submitError}</p>}
        </form>
      </KoochDialog>
    </main>
  );
}
