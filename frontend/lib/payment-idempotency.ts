const paymentKeyPrefix = "kooch_booking_session_payment_";
const failedAttemptPrefix = "kooch_booking_session_failed_payment_";

function createIdentifier() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreatePaymentIdempotencyKey(sessionCode: string) {
  const storageKey = `${paymentKeyPrefix}${sessionCode}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const created = createIdentifier();
  sessionStorage.setItem(storageKey, created);
  return created;
}

export function getPaymentIdempotencyKeyForCurrentAttempt(
  sessionCode: string,
  failedPaymentId: number | null,
) {
  if (failedPaymentId === null) {
    return getOrCreatePaymentIdempotencyKey(sessionCode);
  }

  const failedAttemptKey = `${failedAttemptPrefix}${sessionCode}`;
  if (sessionStorage.getItem(failedAttemptKey) !== String(failedPaymentId)) {
    sessionStorage.setItem(`${paymentKeyPrefix}${sessionCode}`, createIdentifier());
    sessionStorage.setItem(failedAttemptKey, String(failedPaymentId));
  }
  return getOrCreatePaymentIdempotencyKey(sessionCode);
}
