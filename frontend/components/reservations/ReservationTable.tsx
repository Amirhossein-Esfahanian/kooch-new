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
  onEdit?: (reservation: ReservationTableItem) => void;
  onView: (reservation: ReservationTableItem) => void;
  onPageChange: (page: number) => void;
  currentPage: number;
  totalPages: number;
  context: ReservationTableContext;
  emptyMessage?: string;
}

const statusLabels: Record<string, string> = {
  Pending: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø±",
  Confirmed: "ØªØ§ÛŒÛŒØ¯ Ø´Ø¯Ù‡",
  Rejected: "Ø±Ø¯ Ø´Ø¯Ù‡",
  Cancelled: "Ù„ØºÙˆ Ø´Ø¯Ù‡",
  Paid: "Ù¾Ø±Ø¯Ø§Ø®Øª Ø´Ø¯Ù‡",
  Completed: "ØªÚ©Ù…ÛŒÙ„ Ø´Ø¯Ù‡",
  OnHold: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± Ù†Ú¯Ù‡Ø¯Ø§Ø±ÛŒ",
  Expired: "Ù…Ù†Ù‚Ø¶ÛŒ Ø´Ø¯Ù‡",
  PendingApproval: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± ØªØ§ÛŒÛŒØ¯",
  ApprovedAwaitingPayment: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± Ù¾Ø±Ø¯Ø§Ø®Øª",
  PaymentExpired: "Ù…Ù‡Ù„Øª Ù¾Ø±Ø¯Ø§Ø®Øª Ú¯Ø°Ø´ØªÙ‡",
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
  onEdit,
  onSendPaymentLink,
  onView,
  onPageChange,
  currentPage,
  totalPages,
  context,
  emptyMessage = "Ø±Ø²Ø±ÙˆÛŒ Ø¨Ø±Ø§ÛŒ Ù†Ù…Ø§ÛŒØ´ ÙˆØ¬ÙˆØ¯ Ù†Ø¯Ø§Ø±Ø¯.",
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
            <KoochTableHead>Ø´Ù…Ø§Ø±Ù‡ Ø±Ø²Ø±Ùˆ</KoochTableHead>
            <KoochTableHead>Ù…Ù‡Ù…Ø§Ù†</KoochTableHead>
            {showProperty && <KoochTableHead>Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡</KoochTableHead>}
            <KoochTableHead>Ø§ØªØ§Ù‚</KoochTableHead>
            <KoochTableHead>ÙˆØ±ÙˆØ¯</KoochTableHead>
            <KoochTableHead>Ø®Ø±ÙˆØ¬</KoochTableHead>
            <KoochTableHead>ÙˆØ¶Ø¹ÛŒØª</KoochTableHead>
            <KoochTableHead>Ù…Ø¨Ù„Øº Ú©Ù„</KoochTableHead>
            <KoochTableHead>Ø¨Ø§Ù‚ÛŒâ€ŒÙ…Ø§Ù†Ø¯Ù‡</KoochTableHead>
            <KoochTableHead>Ø¹Ù…Ù„ÛŒØ§Øª</KoochTableHead>
          </KoochTableRow>
        </KoochTableHeader>

        <KoochTableBody>
          {loading ? (
            <KoochTableEmpty colSpan={colSpan}>
              Ø¯Ø± Ø­Ø§Ù„ Ø¨Ø§Ø±Ú¯Ø°Ø§Ø±ÛŒ...
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
                        Ø¬Ø²Ø¦ÛŒØ§Øª
                      </KoochButton>
                      {context === "admin" && onEdit && (
                        <KoochButton
                          onClick={() => onEdit(reservation)}
                          size="sm"
                          variant="outline"
                        >
                          ویرایش
                        </KoochButton>
                      )}
                      {onSendPaymentLink && canSendPaymentLink && (
                        <KoochConfirmDialog
                          cancelText="Ø§Ù†ØµØ±Ø§Ù"
                          confirmText="Ø§Ø±Ø³Ø§Ù„ Ù„ÛŒÙ†Ú© Ù¾Ø±Ø¯Ø§Ø®Øª"
                          description="Ù„ÛŒÙ†Ú© Ù¾Ø±Ø¯Ø§Ø®Øª Ø¬Ø¯ÛŒØ¯ Ø³Ø§Ø®ØªÙ‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯ØŒ Ù„ÛŒÙ†Ú©â€ŒÙ‡Ø§ÛŒ ÙØ¹Ø§Ù„ Ù‚Ø¨Ù„ÛŒ Ø¨Ø§Ø·Ù„ Ù…ÛŒâ€ŒØ´ÙˆÙ†Ø¯ Ùˆ Ø§Ø·Ù„Ø§Ø¹â€ŒØ±Ø³Ø§Ù†ÛŒ Ù¾ÛŒØ§Ù…Ú© Ùˆ Ø§ÛŒÙ…ÛŒÙ„ ÙÙ‚Ø· Ø¯Ø± Ù„Ø§Ú¯ Ø«Ø¨Øª Ø®ÙˆØ§Ù‡Ø¯ Ø´Ø¯."
                          onConfirm={() => onSendPaymentLink(reservation)}
                          title="Ø§Ø±Ø³Ø§Ù„ Ù„ÛŒÙ†Ú© Ù¾Ø±Ø¯Ø§Ø®Øª"
                          trigger={
                            <KoochButton size="sm" variant="outline">
                              Ø§Ø±Ø³Ø§Ù„ Ù„ÛŒÙ†Ú© Ù¾Ø±Ø¯Ø§Ø®Øª
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
            ØµÙØ­Ù‡ {new Intl.NumberFormat("fa-IR").format(currentPage)} Ø§Ø²{" "}
            {new Intl.NumberFormat("fa-IR").format(totalPages)}
          </span>
          <div className="flex items-center gap-2">
            <KoochButton
              disabled={!hasPrevious || loading}
              onClick={() => onPageChange(currentPage - 1)}
              size="sm"
              variant="outline"
            >
              Ù‚Ø¨Ù„ÛŒ
            </KoochButton>
            <KoochButton
              disabled={!hasNext || loading}
              onClick={() => onPageChange(currentPage + 1)}
              size="sm"
              variant="outline"
            >
              Ø¨Ø¹Ø¯ÛŒ
            </KoochButton>
          </div>
        </div>
      )}
    </div>
  );
}

