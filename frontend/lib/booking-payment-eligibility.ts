import type { AccountBookingSession } from "@/lib/booking-sessions";

export interface BookingSessionPaymentEligibility {
  canPay: boolean;
  deadlineUtc: string | null;
  isContinuation: boolean;
}

export function getBookingSessionPaymentEligibility(
  session: AccountBookingSession,
  now = Date.now(),
): BookingSessionPaymentEligibility {
  const isContinuation = Boolean(
    session.summary.canContinueWithApprovedReservations &&
      session.summary.payableReservationCount > 0,
  );
  const deadlineUtc = isContinuation
    ? session.summary.continuationPaymentDeadlineUtc
    : session.summary.isPaymentReady
      ? session.commonPaymentDeadlineUtc ??
        session.summary.earliestPaymentDeadlineUtc
      : null;
  const deadline = deadlineUtc ? Date.parse(deadlineUtc) : Number.NaN;

  return {
    canPay: Boolean(deadlineUtc && Number.isFinite(deadline) && deadline > now),
    deadlineUtc,
    isContinuation,
  };
}
