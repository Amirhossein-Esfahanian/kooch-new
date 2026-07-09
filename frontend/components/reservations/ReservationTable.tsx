"use client";

import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";

export type ReservationTableContext = "admin" | "owner";

export type ReservationTableStatus =
  | "Pending"
  | "Confirmed"
  | "Rejected"
  | "Cancelled"
  | "Paid"
  | "Completed"
  | "OnHold"
  | "Expired"
  | "PendingApproval"
  | "ApprovedAwaitingPayment"
  | "PaymentExpired"
  | string;

export interface ReservationTableItem {
  id?: number;
  reservationId?: number;
  reservationNumber: string;
  propertyId?: number;
  propertyName?: string | null;
  roomTypeId?: number;
  roomTypeName?: string | null;
  roomId?: number | null;
  roomName?: string | null;
  guestId?: number | null;
  guestName?: string | null;
  guestFullName?: string | null;
  guestMobile?: string | null;
  guestEmail?: string | null;
  email?: string | null;
  checkInDate: string;
  checkOutDate: string;
  nightsCount?: number | null;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  roomCount?: number | null;
  status: ReservationTableStatus;
  baseAmount?: number | null;
  basePrice?: number | null;
  childAmount?: number | null;
  childCharge?: number | null;
  extraGuestAmount?: number | null;
  extraGuestCharge?: number | null;
  discountAmount?: number | null;
  promotionDiscount?: number | null;
  totalPrice?: number | null;
  finalAmount?: number | null;
  paidAmount?: number | null;
  payableAmount?: number | null;
  remainingAmount?: number | null;
  currency?: string | null;
  paymentExpiresAtUtc?: string | null;
}

interface ReservationTableProps {
  reservations: ReservationTableItem[];
  loading: boolean;
  onView: (reservation: ReservationTableItem) => void;
  onApprove: (reservation: ReservationTableItem) => void;
  onCancel?: (reservation: ReservationTableItem) => void;
  onPageChange: (page: number) => void;
  currentPage: number;
  totalPages: number;
  context: ReservationTableContext;
  emptyMessage?: string;
}

const statusLabels: Record<string, string> = {
  Pending: "در انتظار",
  Confirmed: "تایید شده",
  Rejected: "رد شده",
  Cancelled: "لغو شده",
  Paid: "پرداخت شده",
  Completed: "تکمیل شده",
  OnHold: "در انتظار نگهداری",
  Expired: "منقضی شده",
  PendingApproval: "در انتظار تایید",
  ApprovedAwaitingPayment: "در انتظار پرداخت",
  PaymentExpired: "مهلت پرداخت گذشته",
};

function statusVariant(status: ReservationTableStatus) {
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

function canApprove(status: ReservationTableStatus) {
  return status === "PendingApproval" || status === "OnHold";
}

function canCancel(status: ReservationTableStatus) {
  return status === "PendingApproval" || status === "OnHold";
}

function formatDate(value: string) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatMoney(value?: number | null, currency?: string | null) {
  if (value === null || value === undefined) return "-";

  const formatted = new Intl.NumberFormat("fa-IR").format(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

function rowKey(reservation: ReservationTableItem) {
  return reservation.reservationId ?? reservation.id ?? reservation.reservationNumber;
}

export function ReservationTable({
  reservations,
  loading,
  onView,
  onApprove,
  onCancel,
  onPageChange,
  currentPage,
  totalPages,
  context,
  emptyMessage = "رزروی برای نمایش وجود ندارد.",
}: ReservationTableProps) {
  const showProperty = context === "admin";
  const colSpan = showProperty ? 10 : 9;
  const hasPrevious = currentPage > 1;
  const hasNext = totalPages > currentPage;

  return (
    <div className="grid gap-4">
      <KoochTable>
        <KoochTableHeader>
          <KoochTableRow>
            <KoochTableHead>شماره رزرو</KoochTableHead>
            <KoochTableHead>مهمان</KoochTableHead>
            {showProperty && <KoochTableHead>اقامتگاه</KoochTableHead>}
            <KoochTableHead>اتاق</KoochTableHead>
            <KoochTableHead>ورود</KoochTableHead>
            <KoochTableHead>خروج</KoochTableHead>
            <KoochTableHead>وضعیت</KoochTableHead>
            <KoochTableHead>مبلغ کل</KoochTableHead>
            <KoochTableHead>باقی‌مانده</KoochTableHead>
            <KoochTableHead>عملیات</KoochTableHead>
          </KoochTableRow>
        </KoochTableHeader>

        <KoochTableBody>
          {loading ? (
            <KoochTableEmpty colSpan={colSpan}>در حال بارگذاری...</KoochTableEmpty>
          ) : reservations.length === 0 ? (
            <KoochTableEmpty colSpan={colSpan}>{emptyMessage}</KoochTableEmpty>
          ) : (
            reservations.map((reservation) => {
              const guestName =
                reservation.guestName ?? reservation.guestFullName ?? "-";
              const roomName =
                reservation.roomTypeName ?? reservation.roomName ?? "-";
              const totalPrice =
                reservation.totalPrice ?? reservation.finalAmount ?? null;

              return (
                <KoochTableRow key={rowKey(reservation)}>
                  <KoochTableCell className="font-black">
                    {reservation.reservationNumber || "-"}
                  </KoochTableCell>
                  <KoochTableCell>
                    <div className="grid gap-1">
                      <span className="font-semibold">{guestName}</span>
                      <span className="text-xs text-muted-foreground">
                        {reservation.guestMobile ?? "-"}
                      </span>
                    </div>
                  </KoochTableCell>
                  {showProperty && (
                    <KoochTableCell>{reservation.propertyName ?? "-"}</KoochTableCell>
                  )}
                  <KoochTableCell>{roomName}</KoochTableCell>
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
                    {reservation.paymentExpiresAtUtc && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDate(reservation.paymentExpiresAtUtc)}
                      </div>
                    )}
                  </KoochTableCell>
                  <KoochTableCell className="whitespace-nowrap font-semibold">
                    {formatMoney(totalPrice, reservation.currency)}
                  </KoochTableCell>
                  <KoochTableCell className="whitespace-nowrap">
                    {formatMoney(reservation.remainingAmount, reservation.currency)}
                  </KoochTableCell>
                  <KoochTableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <KoochButton
                        onClick={() => onView(reservation)}
                        size="sm"
                        variant="outline"
                      >
                        مشاهده جزئیات
                      </KoochButton>
                      {canApprove(reservation.status) && (
                        <KoochConfirmDialog
                          cancelText="انصراف"
                          confirmText="ارسال لینک پرداخت"
                          description="با ارسال لینک پرداخت، رزرو برای مدت ۱۰ دقیقه آماده پرداخت می‌شود و اطلاع‌رسانی برای مهمان ثبت خواهد شد."
                          onConfirm={() => onApprove(reservation)}
                          title="ارسال لینک پرداخت"
                          trigger={
                            <KoochButton size="sm">
                              ارسال لینک پرداخت
                            </KoochButton>
                          }
                          variant="warning"
                        />
                      )}
                      {onCancel && canCancel(reservation.status) && (
                        <KoochConfirmDialog
                          cancelText="انصراف"
                          confirmText="لغو رزرو"
                          description="این رزرو لغو می‌شود و اطلاع‌رسانی لغو برای مهمان ثبت خواهد شد."
                          onConfirm={() => onCancel(reservation)}
                          title="لغو رزرو"
                          trigger={
                            <KoochButton size="sm" variant="destructive">
                              لغو
                            </KoochButton>
                          }
                          variant="destructive"
                        />
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
              disabled={!hasPrevious || loading}
              onClick={() => onPageChange(currentPage - 1)}
              size="sm"
              variant="outline"
            >
              قبلی
            </KoochButton>
            <KoochButton
              disabled={!hasNext || loading}
              onClick={() => onPageChange(currentPage + 1)}
              size="sm"
              variant="outline"
            >
              بعدی
            </KoochButton>
          </div>
        </div>
      )}
    </div>
  );
}
