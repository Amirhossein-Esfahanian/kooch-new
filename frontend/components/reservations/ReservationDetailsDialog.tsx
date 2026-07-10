"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog, KoochDialogButton } from "@/components/KoochDialog";
import type {
  ReservationTableItem,
  ReservationTableStatus,
} from "@/components/reservations/ReservationTable";

interface ReservationDetailsDialogProps {
  loading?: boolean;
  onSendPaymentLink?: (reservation: ReservationTableItem) => void | Promise<void>;
  onStatusChange?: (
    reservation: ReservationTableItem,
    status: ReservationTableStatus,
  ) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reservation: ReservationTableItem | null;
}

const statusLabels: Record<string, string> = {
  Pending: "در انتظار",
  Confirmed: "تایید شده",
  Rejected: "رد شده",
  Cancelled: "لغو شده",
  Paid: "پرداخت شده",
  Completed: "تکمیل شده",
  OnHold: "در انتظار بررسی",
  Expired: "منقضی شده",
  PendingApproval: "در انتظار تایید",
  ApprovedAwaitingPayment: "در انتظار پرداخت",
  PaymentExpired: "مهلت پرداخت گذشته",
};

const sourceLabels: Record<string, string> = {
  Website: "وب‌سایت",
  OwnerManual: "ثبت مالک",
  PhoneReferral: "ارجاع تلفنی",
  AdminCreated: "ثبت ادمین",
  ExternalChannel: "کانال بیرونی",
};

const statusActionText: Record<
  string,
  { label: string; description: string; variant?: "warning" | "destructive" }
> = {
  ApprovedAwaitingPayment: {
    label: "آماده پرداخت",
    description:
      "رزرو به وضعیت آماده پرداخت منتقل می‌شود و اطلاع‌رسانی برای مهمان ثبت خواهد شد.",
    variant: "warning",
  },
  Confirmed: {
    label: "تایید رزرو",
    description: "رزرو تایید می‌شود. پرداخت یا کاهش موجودی انجام نمی‌شود.",
    variant: "warning",
  },
  Cancelled: {
    label: "لغو رزرو",
    description: "رزرو لغو می‌شود و اطلاع‌رسانی لغو ثبت خواهد شد.",
    variant: "destructive",
  },
  Completed: {
    label: "تکمیل / خروج",
    description: "رزرو تکمیل‌شده علامت می‌خورد.",
    variant: "warning",
  },
  PaymentExpired: {
    label: "اتمام مهلت پرداخت",
    description: "رزرو به وضعیت اتمام مهلت پرداخت منتقل می‌شود.",
    variant: "destructive",
  },
};

function statusVariant(status?: ReservationTableStatus) {
  if (status === "Confirmed" || status === "Paid" || status === "Completed") {
    return "success" as const;
  }

  if (
    status === "Pending" ||
    status === "OnHold" ||
    status === "PendingApproval" ||
    status === "ApprovedAwaitingPayment"
  ) {
    return "warning" as const;
  }

  if (
    status === "Cancelled" ||
    status === "Rejected" ||
    status === "Expired" ||
    status === "PaymentExpired"
  ) {
    return "destructive" as const;
  }

  return "muted" as const;
}

function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatMoney(value?: number | null, currency?: string | null) {
  if (value === null || value === undefined) return "-";

  const formatted = new Intl.NumberFormat("fa-IR").format(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

function formatSource(value?: string | null) {
  if (!value) return "-";
  return sourceLabels[value] ?? value;
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return "-";

  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  const formatter = new Intl.NumberFormat("fa-IR", {
    minimumIntegerDigits: 2,
  });

  return `${formatter.format(minutes)}:${formatter.format(remainingSeconds)}`;
}

function isUnpaidReservation(reservation: ReservationTableItem) {
  if (typeof reservation.remainingAmount === "number") {
    return reservation.remainingAmount > 0;
  }

  const totalAmount = reservation.totalPrice ?? reservation.finalAmount;
  if (
    typeof totalAmount === "number" &&
    typeof reservation.paidAmount === "number"
  ) {
    return reservation.paidAmount < totalAmount;
  }

  return reservation.status !== "Paid";
}

function DetailItem({
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

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <KoochCard className="grid gap-3" padding="sm" variant="elevated">
      <h3 className="text-sm font-black text-foreground">{title}</h3>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </KoochCard>
  );
}

export function ReservationDetailsDialog({
  loading = false,
  onSendPaymentLink,
  onStatusChange,
  onOpenChange,
  open,
  reservation,
}: ReservationDetailsDialogProps) {
  const status = reservation?.status;
  const guestName = reservation?.guestName ?? reservation?.guestFullName ?? "-";
  const guestEmail = reservation?.guestEmail ?? reservation?.email ?? "-";
  const identityNumber =
    reservation?.guestNationalCode ?? reservation?.guestPassportNumber ?? "-";
  const roomName = reservation?.roomTypeName ?? reservation?.roomName ?? "-";
  const totalAmount = reservation?.totalPrice ?? reservation?.finalAmount;
  const baseAmount = reservation?.baseAmount ?? reservation?.basePrice;
  const childAmount = reservation?.childAmount ?? reservation?.childCharge;
  const extraGuestAmount =
    reservation?.extraGuestAmount ?? reservation?.extraGuestCharge;
  const promotionDiscount =
    reservation?.discountAmount ?? reservation?.promotionDiscount;
  const couponDiscount = reservation?.couponDiscountAmount ?? 0;
  const paidAmount =
    reservation?.paidAmount ??
    (typeof totalAmount === "number" &&
    typeof reservation?.remainingAmount === "number"
      ? Math.max(totalAmount - reservation.remainingAmount, 0)
      : null);
  const statusActions = reservation?.allowedStatusTransitions ?? [];
  const [remainingPaymentSeconds, setRemainingPaymentSeconds] = useState<
    number | null
  >(null);
  const expiryRefreshStartedRef = useRef(false);
  const shouldShowPaymentCountdown =
    reservation?.status === "ApprovedAwaitingPayment";
  const canSendPaymentLink =
    reservation !== null &&
    reservation.status === "ApprovedAwaitingPayment" &&
    !reservation.isPaymentExpired &&
    isUnpaidReservation(reservation);

  useEffect(() => {
    expiryRefreshStartedRef.current = false;
    setRemainingPaymentSeconds(
      shouldShowPaymentCountdown
        ? reservation?.remainingPaymentSeconds ?? null
        : null,
    );
  }, [
    reservation?.remainingPaymentSeconds,
    reservation?.reservationId,
    reservation?.id,
    shouldShowPaymentCountdown,
  ]);

  useEffect(() => {
    if (!shouldShowPaymentCountdown || remainingPaymentSeconds === null) {
      return;
    }

    if (remainingPaymentSeconds <= 0) {
      if (reservation && onStatusChange && !expiryRefreshStartedRef.current) {
        expiryRefreshStartedRef.current = true;
        void onStatusChange(reservation, "PaymentExpired");
      }
      return;
    }

    const timer = window.setTimeout(() => {
      setRemainingPaymentSeconds((current) =>
        current === null ? null : Math.max(0, current - 1),
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [
    onStatusChange,
    remainingPaymentSeconds,
    reservation,
    shouldShowPaymentCountdown,
  ]);

  return (
    <KoochDialog
      description={reservation?.reservationNumber ?? undefined}
      footer={
        <>
          {reservation &&
            onSendPaymentLink &&
            canSendPaymentLink && (
              <KoochConfirmDialog
                cancelText="انصراف"
                confirmText="ارسال لینک پرداخت"
                description="لینک پرداخت جدید ساخته می‌شود، لینک‌های فعال قبلی باطل می‌شوند و اطلاع‌رسانی پیامک و ایمیل فقط در لاگ ثبت خواهد شد."
                onConfirm={() => onSendPaymentLink(reservation)}
                title="ارسال لینک پرداخت"
                trigger={
                  <KoochButton variant="outline">
                    ارسال لینک پرداخت
                  </KoochButton>
                }
                variant="warning"
              />
            )}
          {reservation &&
            onStatusChange &&
            statusActions.map((nextStatus) => {
              const text = statusActionText[nextStatus] ?? {
                label: statusLabels[nextStatus] ?? nextStatus,
                description: "وضعیت رزرو تغییر می‌کند.",
                variant: "warning" as const,
              };

              return (
                <KoochConfirmDialog
                  cancelText="انصراف"
                  confirmText={text.label}
                  description={text.description}
                  key={nextStatus}
                  onConfirm={() => onStatusChange(reservation, nextStatus)}
                  title={text.label}
                  trigger={
                    <KoochButton
                      variant={
                        text.variant === "destructive"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {text.label}
                    </KoochButton>
                  }
                  variant={text.variant}
                />
              );
            })}
          <KoochDialogButton onClick={() => onOpenChange(false)}>
            بستن
          </KoochDialogButton>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="xl"
      title="جزئیات رزرو"
    >
      {loading && !reservation ? (
        <p className="text-sm font-semibold text-muted-foreground">
          در حال بارگذاری...
        </p>
      ) : reservation ? (
        <div className="grid gap-4">
          {loading && (
            <p className="text-xs font-semibold text-muted-foreground">
              در حال به‌روزرسانی جزئیات...
            </p>
          )}

          <DetailSection title="رزرو">
            <DetailItem
              label="شماره رزرو"
              value={reservation.reservationNumber || "-"}
            />
            <DetailItem
              label="وضعیت"
              value={
                status ? (
                  <KoochBadge variant={statusVariant(status)}>
                    {statusLabels[status] ?? status}
                  </KoochBadge>
                ) : (
                  "-"
                )
              }
            />
            <DetailItem label="منبع" value={formatSource(reservation.source)} />
            <DetailItem
              label="تاریخ ایجاد"
              value={formatDateTime(reservation.createdAtUtc)}
            />
            <DetailItem
              label="ایجادکننده"
              value={reservation.createdBy ?? "-"}
            />
          </DetailSection>

          <DetailSection title="مهمان">
            <DetailItem label="نام کامل" value={guestName} />
            <DetailItem label="موبایل" value={reservation.guestMobile ?? "-"} />
            <DetailItem label="ایمیل" value={guestEmail} />
            <DetailItem
              label="کد ملی / شماره پاسپورت"
              value={identityNumber}
            />
            <DetailItem
              label="ملیت"
              value={reservation.guestNationality ?? "-"}
            />
          </DetailSection>

          <DetailSection title="اقامت">
            <DetailItem
              label="اقامتگاه"
              value={reservation.propertyName ?? "-"}
            />
            <DetailItem label="نوع اتاق" value={roomName} />
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
            <DetailItem label="بزرگسال" value={formatNumber(reservation.adults)} />
            <DetailItem label="کودک" value={formatNumber(reservation.children)} />
            <DetailItem label="نوزاد" value={formatNumber(reservation.infants)} />
            <DetailItem
              label="تعداد اتاق"
              value={formatNumber(reservation.roomCount)}
            />
          </DetailSection>

          <DetailSection title="مالی">
            <DetailItem
              label="قیمت پایه"
              value={formatMoney(baseAmount, reservation.currency)}
            />
            <DetailItem
              label="هزینه کودک"
              value={formatMoney(childAmount, reservation.currency)}
            />
            <DetailItem
              label="هزینه نفر اضافه"
              value={formatMoney(extraGuestAmount, reservation.currency)}
            />
            <DetailItem
              label="تخفیف پروموشن"
              value={formatMoney(promotionDiscount, reservation.currency)}
            />
            <DetailItem
              label="تخفیف کوپن"
              value={formatMoney(couponDiscount, reservation.currency)}
            />
            <DetailItem
              label="مبلغ کل"
              value={formatMoney(totalAmount, reservation.currency)}
            />
            <DetailItem
              label="مبلغ پرداخت‌شده"
              value={formatMoney(paidAmount, reservation.currency)}
            />
            <DetailItem
              label="باقی‌مانده"
              value={formatMoney(reservation.remainingAmount, reservation.currency)}
            />
            <DetailItem label="واحد پول" value={reservation.currency ?? "-"} />
          </DetailSection>

          <DetailSection title="اطلاعات درخواست">
            <DetailItem
              label="تاریخ تایید"
              value={formatDateTime(reservation.approvedAtUtc)}
            />
            <DetailItem
              label="تاییدکننده"
              value={reservation.approvedBy ?? "-"}
            />
            <DetailItem
              label="مهلت پرداخت"
              value={formatDateTime(reservation.paymentExpiresAtUtc)}
            />
            {shouldShowPaymentCountdown && (
              <DetailItem
                label="زمان باقی‌مانده"
                value={
                  <KoochBadge
                    variant={
                      reservation.isPaymentExpired ||
                      remainingPaymentSeconds === 0
                        ? "destructive"
                        : "warning"
                    }
                  >
                    {reservation.isPaymentExpired || remainingPaymentSeconds === 0
                      ? "مهلت پرداخت تمام شده است."
                      : formatDuration(remainingPaymentSeconds)}
                  </KoochBadge>
                }
              />
            )}
          </DetailSection>
        </div>
      ) : (
        <p className="text-sm font-semibold text-muted-foreground">
          رزروی برای نمایش انتخاب نشده است.
        </p>
      )}
    </KoochDialog>
  );
}
