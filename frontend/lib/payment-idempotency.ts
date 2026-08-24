const paymentKeyPrefix = "kooch_booking_session_payment_";
const failedAttemptPrefix = "kooch_booking_session_failed_payment_";

interface PaymentAttempt {
  idempotencyKey: string;
  providerKey: string | null;
}

function createIdentifier() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readPaymentAttempt(sessionCode: string): PaymentAttempt | null {
  const storageKey = `${paymentKeyPrefix}${sessionCode}`;
  const stored = sessionStorage.getItem(storageKey);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<PaymentAttempt>;
    if (typeof parsed.idempotencyKey === "string") {
      return {
        idempotencyKey: parsed.idempotencyKey,
        providerKey:
          typeof parsed.providerKey === "string" ? parsed.providerKey : null,
      };
    }
  } catch {
    // Legacy entries stored only the idempotency key as a raw string.
  }

  return { idempotencyKey: stored, providerKey: null };
}

function writePaymentAttempt(
  sessionCode: string,
  attempt: PaymentAttempt,
) {
  sessionStorage.setItem(
    `${paymentKeyPrefix}${sessionCode}`,
    JSON.stringify(attempt),
  );
}

function getOrCreatePaymentAttempt(sessionCode: string): PaymentAttempt {
  const existing = readPaymentAttempt(sessionCode);
  if (existing) return existing;

  const created = { idempotencyKey: createIdentifier(), providerKey: null };
  writePaymentAttempt(sessionCode, created);
  return created;
}

function prepareCurrentAttempt(
  sessionCode: string,
  failedPaymentId: number | null,
) {
  if (failedPaymentId !== null) {
    const failedAttemptKey = `${failedAttemptPrefix}${sessionCode}`;
    if (sessionStorage.getItem(failedAttemptKey) !== String(failedPaymentId)) {
      writePaymentAttempt(sessionCode, {
        idempotencyKey: createIdentifier(),
        providerKey: null,
      });
      sessionStorage.setItem(failedAttemptKey, String(failedPaymentId));
    }
  }

  return getOrCreatePaymentAttempt(sessionCode);
}

export function getOrCreatePaymentIdempotencyKey(sessionCode: string) {
  return getOrCreatePaymentAttempt(sessionCode).idempotencyKey;
}

export function getPaymentIdempotencyKeyForCurrentAttempt(
  sessionCode: string,
  failedPaymentId: number | null,
) {
  return prepareCurrentAttempt(sessionCode, failedPaymentId).idempotencyKey;
}

export function getBoundPaymentProviderForCurrentAttempt(
  sessionCode: string,
  failedPaymentId: number | null,
) {
  if (
    failedPaymentId !== null &&
    sessionStorage.getItem(`${failedAttemptPrefix}${sessionCode}`) !==
      String(failedPaymentId)
  ) {
    return null;
  }

  return readPaymentAttempt(sessionCode)?.providerKey ?? null;
}

export function bindPaymentProviderForCurrentAttempt(
  sessionCode: string,
  failedPaymentId: number | null,
  providerKey: string,
): PaymentAttempt & { providerKey: string } {
  const attempt = prepareCurrentAttempt(sessionCode, failedPaymentId);
  if (attempt.providerKey) {
    return { ...attempt, providerKey: attempt.providerKey };
  }

  const boundAttempt = { ...attempt, providerKey };
  writePaymentAttempt(sessionCode, boundAttempt);
  return boundAttempt;
}
