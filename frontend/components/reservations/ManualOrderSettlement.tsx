"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { ManualReceiptFields } from "./ManualReceiptFields";
import { apiRequest } from "@/lib/owner-api";
import { formatCurrency } from "@/lib/currency";
import { toPersianDigits } from "@/lib/persian-digits";

type Balance = {
  sessionCode: string; currency: string; totalAmount: number; remainingAmount: number;
  canSettle: boolean; unavailableReason: string | null;
};

export function ManualOrderSettlement({ bookingSessionId, onSettled }: {
  bookingSessionId: number; onSettled: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("BankTransfer");
  const [reference, setReference] = useState("");
  const key = useRef<string | null>(null);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const readId = useRef(0);
  const paymentDate = useRef("");
  const path = `/admin/manual-payments/orders/${bookingSessionId}`;

  async function load() {
    const requestId = ++readId.current;
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<Balance>(path);
      if (readId.current === requestId) setBalance(result);
    }
    catch (caught) {
      if (readId.current === requestId) {
        setBalance(null); setError(caught instanceof Error ? caught.message : "خطا در دریافت ماندهٔ سفارش");
      }
    }
    finally { if (readId.current === requestId) setLoading(false); }
  }

  async function settle() {
    if (!balance?.canSettle || inFlight.current || completed.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      await apiRequest(`${path}/settle`, {
        method: "POST", body: JSON.stringify({
          idempotencyKey: key.current, confirmedAmount: balance.remainingAmount, currency: balance.currency,
          method, paymentDate: paymentDate.current, referenceNumber: reference.trim() || null,
        }),
      });
      completed.current = true;
      setOpen(false);
      toast.success("تسویهٔ کل سفارش ثبت شد.");
      // A refresh failure must not turn a committed receipt into a failed settlement.
      try { await onSettled(); } catch { toast.warning("تسویه ثبت شد؛ فهرست را دوباره دریافت کنید."); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "ثبت تسویه انجام نشد."); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  return <>
    <KoochButton type="button" variant="outline" onClick={() => {
      key.current = null; completed.current = false;
      setMethod("BankTransfer"); setReference("");
      paymentDate.current = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      setOpen(true); void load();
    }}>ثبت تسویهٔ کل سفارش</KoochButton>
    <KoochDialog open={open} onOpenChange={value => { if (!inFlight.current) setOpen(value); }}
      title="ثبت تسویهٔ کل سفارش" footer={<>
        <KoochButton type="button" variant="outline" disabled={submitting} onClick={() => setOpen(false)}>انصراف</KoochButton>
        <KoochButton type="button" loading={submitting} disabled={loading || submitting || !balance?.canSettle}
          onClick={() => void settle()}>تأیید دریافت کل مانده و ثبت تسویه</KoochButton>
      </>}>
      <div className="grid gap-3" dir="rtl" aria-busy={loading || submitting}>
        <p className="text-sm text-muted-foreground">فقط وجهی را ثبت کنید که قبلاً دریافت شده است؛ این اقدام از مهمان پول برداشت نمی‌کند.</p>
        {loading && <p role="status">در حال دریافت ماندهٔ سفارش…</p>}
        {error && <KoochAlert variant="destructive" title="ثبت تسویه انجام نشد">{error}</KoochAlert>}
        {balance && <>
          <p>سفارش <bdi>{balance.sessionCode}</bdi></p>
          <p className="font-semibold">کل مانده: {toPersianDigits(formatCurrency(balance.remainingAmount, {
            currencyLabel: balance.currency === "IRR" ? "ریال" : balance.currency,
          }))}</p>
          {!balance.canSettle && <KoochAlert title="تسویه در دسترس نیست">{balance.unavailableReason}</KoochAlert>}
          <ManualReceiptFields method={method} reference={reference} disabled={submitting}
            onMethodChange={value => { setMethod(value); key.current = null; }}
            onReferenceChange={value => { setReference(value); key.current = null; }} />
        </>}
        <KoochButton type="button" variant="ghost" disabled={loading || submitting} onClick={() => {
          key.current = null; void load();
        }}>دریافت دوبارهٔ مانده</KoochButton>
      </div>
    </KoochDialog>
  </>;
}
