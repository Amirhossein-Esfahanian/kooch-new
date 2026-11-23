"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import { formatDateTime, statusLabels } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { toPersianDigits } from "@/lib/persian-digits";
import { reservationFinancialHref } from "./admin-reservation-navigation";

export type ManualPaymentReviewItem = {
  paymentId: number; reservationId: number; reservationNumber: string; orderCode: string | null;
  propertyId: number; propertyName: string; guestName: string; amount: number; currency: string; method: string;
  createdAtUtc: string; paymentExpiresAtUtc: string | null; reviewProtectionExpiresAtUtc: string | null;
  reservationStatus: string; reviewState: "Protected" | "ExpiringSoon" | "ProtectionExpired" | "FinancialFollowUp";
};
export type ManualPaymentReviewPage = {
  items: ManualPaymentReviewItem[]; totalCount: number; page: number; pageSize: number; totalPages: number;
};
const title = "پرداخت‌های در انتظار بررسی";
const states = {
  Protected: { label: "در انتظار بررسی؛ حفاظت فعال", variant: "default" },
  ExpiringSoon: { label: "نزدیک پایان حفاظت", variant: "default" },
  ProtectionExpired: { label: "حفاظت پایان یافته؛ نیازمند پیگیری مالی", variant: "destructive" },
  FinancialFollowUp: { label: "بدون حفاظت؛ نیازمند پیگیری مالی", variant: "muted" },
} as const;
const methods: Record<string, string> = { CardToCard: "کارت‌به‌کارت", BankTransfer: "واریز بانکی", Paya: "پایا",
  Satna: "ساتنا", AccountTransfer: "انتقال حساب", Other: "سایر" };

export function ManualPaymentReviewQueue({ propertyId, refreshKey = 0, returnTo, summaryOnly = false }: {
  propertyId?: number; refreshKey?: number; returnTo?: string; summaryOnly?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<ManualPaymentReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    const params = new URLSearchParams({ page: String(page), pageSize: summaryOnly ? "1" : "20" });
    if (propertyId !== undefined) params.set("propertyId", String(propertyId));
    apiRequest<ManualPaymentReviewPage>(`/admin/manual-payments/pending?${params}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, result.totalPages);
        if (page > lastPage) { setPage(lastPage); return; }
        setData(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof ApiRequestError && reason.status === 403
          ? "به صف بررسی پرداخت‌ها دسترسی ندارید." : "دریافت پرداخت‌های در انتظار بررسی انجام نشد.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, propertyId, refreshKey, retry, summaryOnly]);
  useEffect(() => {
    const refresh = () => setRetry(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  return <section aria-label={title} id={summaryOnly ? undefined : "manual-payment-review"}>
    <KoochCard padding="sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-foreground">{title}{data && ` · ${toPersianDigits(data.totalCount)}`}</h2>
        {summaryOnly ? <Link href="/admin/reservations#manual-payment-review" className="rounded text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">مشاهده صف بررسی</Link>
          : <KoochButton size="sm" variant="outline" loading={loading} onClick={() => setRetry(value => value + 1)}>دریافت دوباره صف</KoochButton>}
      </div>
      {loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">در حال دریافت صف بررسی...</p>
        : error ? <KoochAlert className="mt-3" title="صف بررسی در دسترس نیست" variant="destructive">
          <p>{error}</p><KoochButton size="sm" className="mt-2" variant="outline" onClick={() => setRetry(value => value + 1)}>تلاش دوباره</KoochButton>
        </KoochAlert> : data && !summaryOnly ? <>
          <p className="mt-2 text-xs text-muted-foreground">موارد نیازمند پیگیری مالی، سپس نزدیک‌ترین پایان حفاظت. نمایش در این صف به معنی تأیید پرداخت یا تمدید مهلت نیست.</p>
          {data.items.length === 0 ? <p role="status" className="mt-3 text-sm text-muted-foreground">رسیدی در انتظار بررسی نیست.</p>
            : <ul className="mt-3 divide-y divide-border">{data.items.map(item => <li key={item.paymentId} className="grid min-w-0 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid min-w-0 gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground" dir="ltr">{item.reservationNumber}</span>
                  {item.orderCode && <span className="text-xs text-muted-foreground">سفارش <bdi>{item.orderCode}</bdi></span>}
                  <KoochBadge variant={states[item.reviewState].variant}>{states[item.reviewState].label}</KoochBadge>
                </div>
                <p className="break-words text-sm text-foreground">{item.guestName || "نام مهمان ثبت نشده"} · {item.propertyName}</p>
                <p className="text-sm font-semibold text-foreground">{formatCurrency(item.amount, { currencyLabel: item.currency === "IRR" ? "ریال" : item.currency })} · {methods[item.method] ?? item.method}</p>
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-4">{[
                  ["زمان ثبت رسید", item.createdAtUtc ? formatDateTime(item.createdAtUtc) : "نامشخص"],
                  ["مهلت اصلی پرداخت", item.paymentExpiresAtUtc ? formatDateTime(item.paymentExpiresAtUtc) : "نامشخص"],
                  ["پایان حفاظت بررسی", item.reviewProtectionExpiresAtUtc ? formatDateTime(item.reviewProtectionExpiresAtUtc) : "فاقد حفاظت معتبر"],
                  ["وضعیت رزرو", statusLabels[item.reservationStatus] ?? (item.reservationStatus === "CapacityLost" ? "ظرفیت از دست رفته" : item.reservationStatus)],
                ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-foreground">{value}</dd></div>)}</dl>
              </div>
              <Link className="inline-flex min-h-11 items-center justify-center self-center rounded-lg border border-border px-3 text-sm font-semibold text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={reservationFinancialHref(item.reservationId, returnTo)}>بررسی رسید {item.reservationNumber}</Link>
            </li>)}</ul>}
          <nav aria-label="صفحه‌بندی صف بررسی" className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
            <span>صفحه {toPersianDigits(data.page)} · {toPersianDigits(data.totalCount)} رسید</span>
            <div className="flex gap-2"><KoochButton size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>قبلی</KoochButton>
              <KoochButton size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>بعدی</KoochButton></div>
          </nav>
        </> : null}
    </KoochCard>
  </section>;
}
