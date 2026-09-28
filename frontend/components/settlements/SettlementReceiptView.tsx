"use client";

import { useCallback, useEffect, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { ApiRequestError } from "@/lib/owner-api";
import { getAdminSettlementReceipt, getPropertySettlementReceipt,
  type AdminSettlementReceipt, type PropertySettlementReceipt } from "@/lib/settlement-receipt";
import { SettlementReceiptDocument } from "./SettlementReceiptDocument";

type State = { status: "loading" } | { status: "ready"; receipt: PropertySettlementReceipt | AdminSettlementReceipt }
  | { status: "missing" } | { status: "forbidden" } | { status: "error" };

export function SettlementReceiptView({ settlementNumber, propertyId }: { settlementNumber: string; propertyId?: number }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback((signal: AbortSignal) => propertyId === undefined
    ? getAdminSettlementReceipt(settlementNumber, signal)
    : getPropertySettlementReceipt(propertyId, settlementNumber, signal), [propertyId, settlementNumber]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void load(controller.signal).then(receipt => {
      if (!controller.signal.aborted) setState({ status: "ready", receipt });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({ status: error instanceof ApiRequestError && error.status === 404 ? "missing"
        : error instanceof ApiRequestError && error.status === 403 ? "forbidden" : "error" });
    });
    return () => controller.abort();
  }, [load, attempt]);

  if (state.status === "loading") return <KoochCard role="status">در حال دریافت رسید...</KoochCard>;
  if (state.status === "missing") return <KoochAlert role="status">اطلاعات تاریخی لازم برای صدور رسید این تسویه در سوابق موجود نیست.</KoochAlert>;
  if (state.status === "forbidden") return <KoochAlert variant="destructive">شما اجازه مشاهده این رسید تسویه را ندارید.</KoochAlert>;
  if (state.status === "error") return <KoochAlert variant="destructive">
    <p>دریافت رسید انجام نشد. لطفاً دوباره تلاش کنید.</p>
    <KoochButton variant="outline" onClick={() => setAttempt(value => value + 1)}>تلاش دوباره</KoochButton>
  </KoochAlert>;
  return <SettlementReceiptDocument receipt={state.receipt} admin={propertyId === undefined} />;
}
