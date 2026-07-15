"use client";

import { useEffect, useRef, useState } from "react";

type ServerClockSync = {
  key: string;
  monotonicAtSync: number;
  serverTimeAtSync: number;
};

function monotonicNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function useReservationPaymentCountdown(
  enabled: boolean,
  paymentExpiresAtUtc?: string | null,
  serverRemainingSeconds?: number | null,
  sourceKey?: string | number | null,
) {
  const [, forceRender] = useState(0);
  const serverClockRef = useRef<ServerClockSync | null>(null);
  const expiresAt = paymentExpiresAtUtc
    ? new Date(paymentExpiresAtUtc).getTime()
    : Number.NaN;
  const syncKey = `${sourceKey ?? "reservation"}:${paymentExpiresAtUtc ?? ""}:${serverRemainingSeconds ?? ""}`;

  useEffect(() => {
    if (
      Number.isNaN(expiresAt) ||
      serverRemainingSeconds === null ||
      serverRemainingSeconds === undefined ||
      serverClockRef.current?.key === syncKey
    ) {
      return;
    }

    serverClockRef.current = {
      key: syncKey,
      monotonicAtSync: monotonicNow(),
      serverTimeAtSync:
        expiresAt - Math.max(0, serverRemainingSeconds) * 1000,
    };
    forceRender((current) => current + 1);
  }, [expiresAt, serverRemainingSeconds, syncKey]);

  useEffect(() => {
    if (!enabled || Number.isNaN(expiresAt)) {
      return;
    }

    forceRender((current) => current + 1);
    const timer = window.setInterval(() => {
      forceRender((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [enabled, expiresAt, sourceKey]);

  if (!enabled || Number.isNaN(expiresAt)) {
    return null;
  }

  const serverClock = serverClockRef.current;
  if (serverClock?.key !== syncKey) {
    return serverRemainingSeconds === null ||
      serverRemainingSeconds === undefined
      ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      : Math.max(0, serverRemainingSeconds);
  }

  const authoritativeNow =
    serverClock.serverTimeAtSync +
    (monotonicNow() - serverClock.monotonicAtSync);

  return Math.max(0, Math.ceil((expiresAt - authoritativeNow) / 1000));
}
