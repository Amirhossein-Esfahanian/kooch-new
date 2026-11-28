"use client";

import { useReservationPaymentCountdown } from "@/lib/reservation-countdown";

export type AccountReservationStatus =
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

export interface AccountReservation {
  id?: number;
  reservationId: number;
  reservationNumber: string;
  propertyName: string;
  roomName?: string | null;
  roomTypeName: string;
  checkInDate: string;
  checkOutDate: string;
  nightsCount: number;
  adults: number;
  children: number;
  roomCount: number;
  totalPrice: number;
  finalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  currency: string;
  currencyLabel?: string | null;
  status: AccountReservationStatus;
  createdAtUtc?: string | null;
  paymentExpiresAtUtc?: string | null;
  isPaymentExpired?: boolean | null;
  isPaymentEligible?: boolean | null;
  remainingPaymentSeconds?: number | null;
  guestPaymentSummary?: {
    confirmedPaidAmount: number;
    pendingReviewAmount: number;
    unpaidAmount: number;
    collectibleAmount: number;
    usesOrderPayment: boolean;
    canPayOrder: boolean;
    manualReceipts: GuestManualReceipt[];
  } | null;
  guestOrder?: {
    orderCode: string;
    includesAllReservations: boolean;
    reservations: { reservationNumber: string; roomTypeName: string; status: AccountReservationStatus }[];
  } | null;
}

export interface GuestManualReceipt {
  amount: number;
  currencyLabel: string;
  method: string;
  reference: string | null;
  registeredAtUtc: string;
  verificationStatus: "PendingVerification" | "Approved" | "Rejected";
  hasActiveReviewProtection: boolean;
  reviewProtectionExpiresAtUtc: string | null;
}

export function guestPaymentMessage(reservation: AccountReservation) {
  const receipts = reservation.guestPaymentSummary?.manualReceipts ?? [];
  const pending = receipts.some((receipt) => receipt.verificationStatus === "PendingVerification");
  if (reservation.status === "Cancelled") return "رزرو لغو شده است؛ مبالغ پرداخت‌شده سوابق مالی هستند و مانده قابل پرداخت نیست.";
  if (reservation.status === "Expired" || reservation.status === "PaymentExpired") {
    return pending
      ? "رزرو منقضی شده و رسید پرداخت هنوز در انتظار بررسی است. پیگیری مالی لازم است؛ بررسی رسید، رزرو را خودکار بازنمی‌گرداند."
      : "رزرو منقضی شده است و امکان پرداخت برای این رزرو فعال نیست.";
  }
  if (["Confirmed", "Paid", "Completed"].includes(reservation.status) &&
      (reservation.guestPaymentSummary?.unpaidAmount ?? reservation.remainingAmount) === 0)
    return "رزرو تأیید شده و مبلغ آن به‌طور کامل پرداخت شده است.";
  if (pending) return "رسید پرداخت در انتظار بررسی است و هنوز پرداخت تأییدشده محسوب نمی‌شود.";
  if (reservation.status === "PendingApproval") return "رزرو در انتظار تأیید اقامتگاه است؛ پرداخت هنوز فعال نیست.";
  if (reservation.status === "Pending") return "رزرو ثبت شده و در انتظار بررسی و آماده‌سازی است؛ پرداخت هنوز فعال نیست.";
  if (receipts.some((receipt) => receipt.verificationStatus === "Rejected"))
    return "رسید پرداخت رد شده است؛ مبلغ این رسید جزو پرداخت‌های تأییدشده نیست. وضعیت رزرو و امکان پرداخت را جداگانه بررسی کنید.";
  if (reservation.status === "ApprovedAwaitingPayment") return "رزرو در انتظار پرداخت است؛ پرداخت فقط تا مهلت مجاز و از مسیر فعال انجام می‌شود.";
  if (reservation.status === "Rejected") return "درخواست رزرو رد شده است؛ امکان پرداخت فعال نیست.";
  return "وضعیت رزرو و پرداخت‌های ثبت‌شده را در اطلاعات زیر بررسی کنید.";
}

export type AccountCancellationRequestStatus = "Pending" | "Resolved" | "Rejected";

export type AccountCancellationReason =
  | "GuestRequest"
  | "NonPayment"
  | "NoAvailability"
  | "PropertyRuleConflict"
  | "DuplicateReservation"
  | "InvalidGuestInformation"
  | "PropertyMaintenanceOrForceMajeure"
  | "AdministrativeCorrection"
  | "Other"
  | "PaymentExpired";

export interface AccountCancellationRequest {
  status: AccountCancellationRequestStatus;
  reason: AccountCancellationReason;
  message: string | null;
  requestedAtUtc: string;
  resolvedAtUtc: string | null;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const statusLabels: Record<string, string> = {
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

export function statusVariant(status: AccountReservationStatus) {
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

export function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(value?: string | null) {
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

export function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("fa-IR").format(value);
}

export function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return "-";

  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  const formatter = new Intl.NumberFormat("fa-IR", {
    minimumIntegerDigits: 2,
  });

  return `${formatter.format(minutes)}:${formatter.format(remainingSeconds)}`;
}

export function isPaymentEligible(reservation: AccountReservation) {
  if (typeof reservation.isPaymentEligible === "boolean") {
    return reservation.isPaymentEligible;
  }

  return (
    reservation.status === "ApprovedAwaitingPayment" &&
    !reservation.isPaymentExpired &&
    reservation.remainingAmount > 0
  );
}

export function usePaymentCountdown(reservation: AccountReservation | null) {
  return useReservationPaymentCountdown(
    reservation?.status === "ApprovedAwaitingPayment",
    reservation?.paymentExpiresAtUtc,
    reservation?.remainingPaymentSeconds,
    reservation?.reservationId,
  );
}
