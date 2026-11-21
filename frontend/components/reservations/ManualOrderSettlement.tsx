"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { ManualReceiptFields } from "./ManualReceiptFields";
import { apiRequest } from "@/lib/owner-api";
import { formatCurrency } from "@/lib/currency";
import { toPersianDigits } from "@/lib/persian-digits";

export type ManualOrderBalance = {
  sessionCode: string; currency: string; totalAmount: number; remainingAmount: number;
  canSettle: boolean; unavailableReason: string | null;
  reservationCount?: number;
  reservations?: { reservationId: number; reservationNumber: string | null; remainingAmount: number; allocationAmount: number }[];
};

export function ManualOrderSettlement({ bookingSessionId, onSettled, actionLabel = "ثبت تسویهٔ کل سفارش",
  open: controlledOpen, onOpenChange, hideTrigger = false, onBalance }: {
  bookingSessionId: number; onSettled: () => void | Promise<void>;
  actionLabel?: string; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean;
  onBalance?: (balance: ManualOrderBalance | null) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const [balance, setBalance] = useState<ManualOrderBalance | null>(null);
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
  const balanceCallback = useRef(onBalance);
  balanceCallback.current = onBalance;

  useEffect(() => {
    if (!open) return;
    key.current = null; completed.current = false;
    setMethod("BankTransfer"); setReference(""); setBalance(null);
    paymentDate.current = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    void load();
    return () => { readId.current++; };
  // load is scoped to the order; callbacks are read through a ref without refetching.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingSessionId]);

  async function load() {
    const requestId = ++readId.current;
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<ManualOrderBalance>(path);
      if (readId.current === requestId) { setBalance(result); balanceCallback.current?.(result); }
    }
    catch (caught) {
      if (readId.current === requestId) {
        setBalance(null); balanceCallback.current?.(null); setError(caught instanceof Error ? caught.message : "خطا در دریافت ماندهٔ سفارش");
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
    {!hideTrigger && <KoochButton type="button" variant="outline" onClick={() => setOpen(true)}>{actionLabel}</KoochButton>}
    <KoochDialog open={open} onOpenChange={value => { if (!inFlight.current) setOpen(value); }}
      title={actionLabel} size="sm" closeDisabled={submitting} footer={<>
        <KoochButton type="button" variant="outline" disabled={submitting} onClick={() => setOpen(false)}>انصراف</KoochButton>
        {balance?.canSettle && <KoochButton type="button" loading={submitting} disabled={loading || submitting}
          onClick={() => void settle()}>تأیید دریافت کل مانده و ثبت تسویه</KoochButton>}
      </>}>
      <div className="grid gap-3" dir="rtl" aria-busy={loading || submitting}>
        {balance?.canSettle && <p className="text-sm text-muted-foreground">فقط وجهی را ثبت کنید که قبلاً دریافت شده است؛ این اقدام از مهمان پول برداشت نمی‌کند. رسید کل سفارش با تخصیص به رزروها به‌صورت تأییدشده ثبت می‌شود و به صف بررسی رسید تک‌رزرو نمی‌رود.</p>}
        {loading && <p role="status">در حال دریافت ماندهٔ سفارش…</p>}
        {error && <KoochAlert variant="destructive" title="ثبت تسویه انجام نشد">{error}</KoochAlert>}
        {balance && <>
          <p>سفارش <bdi>{balance.sessionCode}</bdi></p>
          {balance.canSettle && <><p className="font-semibold">کل مانده: {toPersianDigits(formatCurrency(balance.remainingAmount, {
            currencyLabel: balance.currency === "IRR" ? "ریال" : balance.currency,
          }))}</p>
          {balance.reservations && balance.reservationCount === balance.reservations.length && balance.reservationCount > 0 ?
            <section aria-label="تخصیص دریافت به رزروها" className="grid gap-2">
              <h3 className="text-sm font-semibold">تخصیص دریافت به رزروها</h3>
              <ul className="grid gap-2 text-sm">{balance.reservations.filter(row => row.allocationAmount > 0).map(row =>
                <li key={row.reservationId} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2">
                  <Link className="text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" href={`/admin/reservations/${row.reservationId}`}>{row.reservationNumber || `شناسهٔ رزرو ${toPersianDigits(row.reservationId)}`}</Link>
                  <span>{toPersianDigits(formatCurrency(row.allocationAmount, { currencyLabel: balance.currency === "IRR" ? "ریال" : balance.currency }))}</span>
                </li>)}</ul>
            </section> : <p className="text-sm text-muted-foreground">ریز کامل تخصیص رزروهای سفارش در پاسخ سرور موجود نیست.</p>}
          <ManualReceiptFields method={method} reference={reference} disabled={submitting}
            onMethodChange={value => { setMethod(value); key.current = null; }}
            onReferenceChange={value => { setReference(value); key.current = null; }} />
          </>}
          {!balance.canSettle && <KoochAlert title="تسویه در دسترس نیست">{balance.unavailableReason || "علت عدم امکان تسویه در پاسخ سرور مشخص نشده است."}</KoochAlert>}
        </>}
        <KoochButton type="button" variant="ghost" disabled={loading || submitting} onClick={() => {
          key.current = null; void load();
        }}>دریافت دوبارهٔ مانده</KoochButton>
      </div>
    </KoochDialog>
  </>;
}
