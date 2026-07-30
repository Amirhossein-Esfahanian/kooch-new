"use client";

import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { formatCurrency } from "@/lib/currency";
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
  | "CapacityLost"
  | string;

export type ReservationCancellationReason =
  | "GuestRequest"
  | "NonPayment"
  | "NoAvailability"
  | "PropertyRuleConflict"
  | "DuplicateReservation"
  | "InvalidGuestInformation"
  | "PropertyMaintenanceOrForceMajeure"
  | "AdministrativeCorrection"
  | "Other";

export interface ReservationCancellationPayload {
  reason: ReservationCancellationReason;
  explanation: string;
}

export type ReservationTimelineEventType =
  | "Created"
  | "Updated"
  | "Approved"
  | "PaymentLinkCreated"
  | "Paid"
  | "StatusChanged"
  | "Cancelled"
  | "PriceAdjusted";

export interface ReservationTimelineEvent {
  type: ReservationTimelineEventType;
  timestampUtc: string;
  actorUserId?: number | null;
  actor?: string | null;
  status?: ReservationTableStatus | null;
  cancellationReason?: ReservationCancellationReason | null;
  oldAmount?: number | null;
  newAmount?: number | null;
  note?: string | null;
}

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
  roomBaseCapacity?: number | null;
  baseCapacity?: number | null;
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
  roomCount?: number | null;
  status: ReservationTableStatus;
  source?: string | null;
  guestType?: "Iranian" | "Foreign" | string | null;
  notes?: string | null;
  createdAtUtc?: string | null;
  createdByUserId?: number | null;
  createdBy?: string | null;
  approvedAtUtc?: string | null;
  approvedByUserId?: number | null;
  approvedBy?: string | null;
  changedAtUtc?: string | null;
  changedByUserId?: number | null;
  paidAtUtc?: string | null;
  confirmedAtUtc?: string | null;
  cancelledAtUtc?: string | null;
  cancelledByUserId?: number | null;
  cancellationReason?: ReservationCancellationReason | null;
  cancellationNote?: string | null;
  expiredAtUtc?: string | null;
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
  serviceFeeAmount?: number | null;
  taxAmount?: number | null;
  calculatedPrice?: number | null;
  manualAdjustment?: number | null;
  totalPrice?: number | null;
  finalAmount?: number | null;
  paidAmount?: number | null;
  payableAmount?: number | null;
  remainingAmount?: number | null;
  currency?: string | null;
  paymentExpiresAtUtc?: string | null;
  isPaymentExpired?: boolean | null;
  remainingPaymentSeconds?: number | null;
  timeline?: ReservationTimelineEvent[];
}

interface ReservationTableProps {
  reservations: ReservationTableItem[];
  loading: boolean;
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
  CapacityLost: "ظرفیت از دست رفته",
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
    status === "PaymentExpired" ||
    status === "CapacityLost"
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

function rowKey(reservation: ReservationTableItem) {
  return (
    reservation.reservationId ?? reservation.id ?? reservation.reservationNumber
  );
}

export function ReservationTable({
  reservations,
  loading,
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
                reservation.finalAmount ?? reservation.totalPrice ?? null;
              return (
                <KoochTableRow key={rowKey(reservation)}>
                  <KoochTableCell className="font-semibold text-xs">
                    {reservation.reservationNumber || "-"}
                  </KoochTableCell>
                  <KoochTableCell>
                    <div className="grid gap-1">
                      <span className="font-semibold text-xs">{guestName}</span>
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
                  <KoochTableCell className="text-xs font-semibold">
                    {roomName}
                  </KoochTableCell>
                  <KoochTableCell className="whitespace-nowrap text-xs font-semibold">
                    {formatDate(reservation.checkInDate)}
                  </KoochTableCell>
                  <KoochTableCell className="whitespace-nowrap text-xs font-semibold">
                    {formatDate(reservation.checkOutDate)}
                  </KoochTableCell>
                  <KoochTableCell>
                    <KoochBadge variant={statusVariant(reservation.status)}>
                      {statusLabels[reservation.status] ?? reservation.status}
                    </KoochBadge>
                    {reservation.paymentExpiresAtUtc && (
                      <div className="mt-1 text-xs  text-muted-foreground">
                        {formatDate(reservation.paymentExpiresAtUtc)}
                      </div>
                    )}
                  </KoochTableCell>
                  <KoochTableCell className="whitespace-nowrap text-xs font-semibold">
                    {formatCurrency(totalPrice, { showCurrency: false })}
                  </KoochTableCell>
                  <KoochTableCell className="whitespace-nowrap text-xs font-semibold">
                    {formatCurrency(reservation.remainingAmount, {
                      showCurrency: false,
                    })}
                  </KoochTableCell>
                  <KoochTableCell>
                    <KoochButton
                      onClick={() => onView(reservation)}
                      size="sm"
                      variant="outline"
                    >
                      مشاهده رزرو
                    </KoochButton>
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
