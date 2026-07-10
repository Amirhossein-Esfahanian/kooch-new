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
  guestNationalCode?: string | null;
  guestPassportNumber?: string | null;
  guestNationality?: string | null;
  checkInDate: string;
  checkOutDate: string;
  nightsCount?: number | null;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  roomCount?: number | null;
  status: ReservationTableStatus;
  source?: string | null;
  createdAtUtc?: string | null;
  createdByUserId?: number | null;
  createdBy?: string | null;
  approvedAtUtc?: string | null;
  approvedByUserId?: number | null;
  approvedBy?: string | null;
  changedAtUtc?: string | null;
  changedByUserId?: number | null;
  allowedStatusTransitions?: ReservationTableStatus[];
  baseAmount?: number | null;
  basePrice?: number | null;
  childAmount?: number | null;
  childCharge?: number | null;
  extraGuestAmount?: number | null;
  extraGuestCharge?: number | null;
  discountAmount?: number | null;
  promotionDiscount?: number | null;
  couponDiscountAmount?: number | null;
  totalPrice?: number | null;
  finalAmount?: number | null;
  paidAmount?: number | null;
  payableAmount?: number | null;
  remainingAmount?: number | null;
  currency?: string | null;
  paymentExpiresAtUtc?: string | null;
  isPaymentExpired?: boolean | null;
  remainingPaymentSeconds?: number | null;
}

interface ReservationTableProps {
  reservations: ReservationTableItem[];
  loading: boolean;
  onSendPaymentLink?: (
    reservation: ReservationTableItem,
  ) => void | Promise<void>;
  onView: (reservation: ReservationTableItem) => void;
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
  return (
    reservation.reservationId ?? reservation.id ?? reservation.reservationNumber
  );
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

export function ReservationTable({
  reservations,
  loading,
  onSendPaymentLink,
  onView,
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
            <KoochTableEmpty colSpan={colSpan}>
              در حال بارگذاری...
            </KoochTableEmpty>
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
              const canSendPaymentLink =
                reservation.status === "ApprovedAwaitingPayment" &&
                !reservation.isPaymentExpired &&
                isUnpaidReservation(reservation);
              return (
                <KoochTableRow key={rowKey(reservation)}>
                  <KoochTableCell className="font-semibold">
                    {reservation.reservationNumber || "-"}
                  </KoochTableCell>
                  <KoochTableCell>
                    <div className="grid gap-1">
                      <span className="font-normal">{guestName}</span>
                      <span className="text-xs text-muted-foreground">
                        {reservation.guestMobile ?? "-"}
                      </span>
                    </div>
                  </KoochTableCell>
                  {showProperty && (
                    <KoochTableCell>
                      {reservation.propertyName ?? "-"}
                    </KoochTableCell>
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
                  <KoochTableCell className="whitespace-nowrap ">
                    {formatMoney(totalPrice, reservation.currency)}
                  </KoochTableCell>
                  <KoochTableCell className="whitespace-nowrap">
                    {formatMoney(
                      reservation.remainingAmount,
                      reservation.currency,
                    )}
                  </KoochTableCell>
                  <KoochTableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <KoochButton
                        onClick={() => onView(reservation)}
                        size="sm"
                        variant="outline"
                      >
                        جزئیات
                      </KoochButton>
                      {onSendPaymentLink && canSendPaymentLink && (
                        <KoochConfirmDialog
                          cancelText="انصراف"
                          confirmText="ارسال لینک پرداخت"
                          description="لینک پرداخت جدید ساخته می‌شود، لینک‌های فعال قبلی باطل می‌شوند و اطلاع‌رسانی پیامک و ایمیل فقط در لاگ ثبت خواهد شد."
                          onConfirm={() => onSendPaymentLink(reservation)}
                          title="ارسال لینک پرداخت"
                          trigger={
                            <KoochButton size="sm" variant="outline">
                              ارسال لینک پرداخت
                            </KoochButton>
                          }
                          variant="warning"
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
