"use client";

import type { ReactNode } from "react";
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
  onApprove?: (reservation: ReservationTableItem) => void | Promise<void>;
  onCancel?: (reservation: ReservationTableItem) => void | Promise<void>;
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

function canApprove(status?: ReservationTableStatus) {
  return status === "PendingApproval" || status === "OnHold";
}

function canCancel(status?: ReservationTableStatus) {
  return status === "PendingApproval" || status === "OnHold";
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

function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatMoney(value?: number | null, currency?: string | null) {
  if (value === null || value === undefined) return "-";

  const formatted = new Intl.NumberFormat("fa-IR").format(value);
  return currency ? `${formatted} ${currency}` : formatted;
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
  onApprove,
  onCancel,
  onOpenChange,
  open,
  reservation,
}: ReservationDetailsDialogProps) {
  const status = reservation?.status;
  const guestName = reservation?.guestName ?? reservation?.guestFullName ?? "-";
  const guestEmail = reservation?.guestEmail ?? reservation?.email ?? "-";
  const roomName = reservation?.roomTypeName ?? reservation?.roomName ?? "-";
  const totalAmount = reservation?.totalPrice ?? reservation?.finalAmount;
  const baseAmount = reservation?.baseAmount ?? reservation?.basePrice;
  const childAmount = reservation?.childAmount ?? reservation?.childCharge;
  const extraGuestAmount =
    reservation?.extraGuestAmount ?? reservation?.extraGuestCharge;
  const discountAmount =
    reservation?.discountAmount ?? reservation?.promotionDiscount;
  const paidAmount =
    reservation?.paidAmount ??
    (typeof totalAmount === "number" &&
    typeof reservation?.remainingAmount === "number"
      ? Math.max(totalAmount - reservation.remainingAmount, 0)
      : null);

  return (
    <KoochDialog
      description={reservation?.reservationNumber ?? undefined}
      footer={
        <>
          <KoochDialogButton onClick={() => onOpenChange(false)}>
            بستن
          </KoochDialogButton>
          {reservation && onApprove && canApprove(reservation.status) && (
            <KoochConfirmDialog
              cancelText="انصراف"
              confirmText="ارسال لینک پرداخت"
              description="با ارسال لینک پرداخت، رزرو برای مدت ۱۰ دقیقه آماده پرداخت می‌شود و اطلاع‌رسانی برای مهمان ثبت خواهد شد."
              onConfirm={() => onApprove(reservation)}
              title="ارسال لینک پرداخت"
              trigger={<KoochButton>ارسال لینک پرداخت</KoochButton>}
              variant="warning"
            />
          )}
          {reservation && onCancel && canCancel(reservation.status) && (
            <KoochConfirmDialog
              cancelText="انصراف"
              confirmText="لغو رزرو"
              description="این رزرو لغو می‌شود و اطلاع‌رسانی لغو برای مهمان ثبت خواهد شد."
              onConfirm={() => onCancel(reservation)}
              title="لغو رزرو"
              trigger={<KoochButton variant="destructive">لغو</KoochButton>}
              variant="destructive"
            />
          )}
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

          <DetailSection title="اطلاعات رزرو">
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
            <DetailItem label="اقامتگاه" value={reservation.propertyName ?? "-"} />
            <DetailItem label="اتاق" value={roomName} />
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
            {reservation.paymentExpiresAtUtc && (
              <DetailItem
                label="مهلت پرداخت"
                value={formatDate(reservation.paymentExpiresAtUtc)}
              />
            )}
          </DetailSection>

          <DetailSection title="اطلاعات مهمان">
            <DetailItem label="مهمان" value={guestName} />
            <DetailItem label="موبایل" value={reservation.guestMobile ?? "-"} />
            <DetailItem label="ایمیل" value={guestEmail} />
            <DetailItem label="بزرگسال" value={formatNumber(reservation.adults)} />
            <DetailItem label="کودک" value={formatNumber(reservation.children)} />
            <DetailItem label="نوزاد" value={formatNumber(reservation.infants)} />
            <DetailItem
              label="تعداد اتاق"
              value={formatNumber(reservation.roomCount)}
            />
          </DetailSection>

          <DetailSection title="مبالغ">
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
              value={formatMoney(discountAmount, reservation.currency)}
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
