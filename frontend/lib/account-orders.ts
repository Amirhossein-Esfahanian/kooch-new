"use client";

import { useReservationPaymentCountdown } from "@/lib/reservation-countdown";

export const orderStatusLabels: Record<string, string> = {
  AwaitingApproval: "در انتظار تأیید",
  ReadyForPayment: "آماده پرداخت",
  PaymentSuccessful: "پرداخت موفق",
  PaymentFailed: "پرداخت ناموفق",
  Expired: "منقضی",
  Rejected: "ردشده",
  Mixed: "نتیجه ترکیبی",
};

export const paymentStatusLabels: Record<string, string> = {
  Pending: "در انتظار پرداخت",
  Successful: "پرداخت موفق",
  Failed: "پرداخت ناموفق",
  Refunded: "بازپرداخت‌شده",
};

export function orderStatusVariant(status: string) {
  if (status === "PaymentSuccessful") return "success" as const;
  if (status === "AwaitingApproval" || status === "ReadyForPayment") {
    return "warning" as const;
  }
  if (status === "PaymentFailed" || status === "Expired" || status === "Rejected") {
    return "destructive" as const;
  }
  return "muted" as const;
}

export function isMockPaymentUiEnabled() {
  return process.env.NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED === "true";
}

export function useOrderPaymentCountdown(
  paymentDeadlineUtc: string | null,
  sourceKey: string,
) {
  return useReservationPaymentCountdown(
    Boolean(paymentDeadlineUtc),
    paymentDeadlineUtc,
    undefined,
    sourceKey,
  );
}
