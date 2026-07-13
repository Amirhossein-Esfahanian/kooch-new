"use client";

import { useEffect, useState } from "react";

function remainingSeconds(expiresAtUtc?: string | null) {
  if (!expiresAtUtc) return null;
  const expiresAt = new Date(expiresAtUtc).getTime();
  if (Number.isNaN(expiresAt)) return null;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

export function useReservationPaymentCountdown(
  enabled: boolean,
  paymentExpiresAtUtc?: string | null,
) {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    setSeconds(enabled ? remainingSeconds(paymentExpiresAtUtc) : null);
  }, [enabled, paymentExpiresAtUtc]);

  useEffect(() => {
    if (!enabled || !paymentExpiresAtUtc || seconds === null || seconds <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSeconds(remainingSeconds(paymentExpiresAtUtc));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [enabled, paymentExpiresAtUtc, seconds]);

  return seconds;
}
