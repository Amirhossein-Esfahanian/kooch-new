"use client";

import { useEffect, useState } from "react";

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
  roomTypeName: string;
  checkInDate: string;
  checkOutDate: string;
  nightsCount: number;
  adults: number;
  children: number;
  infants: number;
  roomCount: number;
  totalPrice: number;
  finalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  currency: string;
  status: AccountReservationStatus;
  createdAtUtc?: string | null;
  paymentExpiresAtUtc?: string | null;
  isPaymentExpired?: boolean | null;
  remainingPaymentSeconds?: number | null;
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

export function formatMoney(value?: number | null, currency?: string | null) {
  if (value === null || value === undefined) return "-";
  const formatted = new Intl.NumberFormat("fa-IR").format(value);
  return currency ? `${formatted} ${currency}` : formatted;
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
  return (
    reservation.status === "ApprovedAwaitingPayment" &&
    !reservation.isPaymentExpired &&
    reservation.remainingAmount > 0
  );
}

export function usePaymentCountdown(reservation: AccountReservation | null) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    setRemainingSeconds(
      reservation?.status === "ApprovedAwaitingPayment"
        ? reservation.remainingPaymentSeconds ?? null
        : null,
    );
  }, [
    reservation?.remainingPaymentSeconds,
    reservation?.reservationId,
    reservation?.status,
  ]);

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) return;

    const timer = window.setTimeout(() => {
      setRemainingSeconds((current) =>
        current === null ? null : Math.max(0, current - 1),
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [remainingSeconds]);

  return remainingSeconds;
}
