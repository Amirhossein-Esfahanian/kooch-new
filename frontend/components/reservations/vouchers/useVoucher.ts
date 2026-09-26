"use client";

import { useEffect, useState } from "react";
import { ApiRequestError } from "@/lib/owner-api";

type VoucherState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "missing" }
  | { status: "error"; message: string };

export function useVoucher<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ load: typeof load; state: VoucherState<T> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ load, state: { status: "loading" } });
    void load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ load, state: { status: "ready", data } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          load,
          state: error instanceof ApiRequestError && error.status === 404
            ? { status: "missing" }
            : {
                status: "error",
                message: error instanceof ApiRequestError && error.status === 403
                  ? "شما اجازه مشاهده این ووچر را ندارید."
                  : "دریافت ووچر انجام نشد. لطفاً دوباره تلاش کنید.",
              },
        });
      },
    );
    return () => controller.abort();
  }, [load, attempt]);

  return {
    state: result?.load === load ? result.state : { status: "loading" } as VoucherState<T>,
    retry: () => setAttempt((value) => value + 1),
  };
}
