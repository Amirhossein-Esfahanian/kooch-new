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
import styles from "./ManualPaymentReviewQueue.module.css";

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
          {data.items.length === 0 ? <p role="status" className="mt-3 text-sm text-muted-foreground">رسیدی در انتظار بررسی نیست.</p>
            : <ul className={styles.list}>{data.items.map(item => <li key={item.paymentId} className={styles.row}>
              <div className={styles.main}>
                <div className={styles.identity}>
                  <bdi className="font-semibold text-foreground">{item.reservationNumber}</bdi>
                  <span className="break-words text-sm text-foreground">{item.guestName || "نام مهمان ثبت نشده"}</span>
                </div>
                <strong className={styles.amount}>{formatCurrency(item.amount, { currencyLabel: item.currency === "IRR" ? "ریال" : item.currency })}</strong>
                <div className={styles.urgency}>
                  <KoochBadge variant={states[item.reviewState].variant}>{states[item.reviewState].label}</KoochBadge>
                </div>
                <Link className={styles.review} aria-label={`بررسی پرداخت ${item.reservationNumber}`}
                  href={reservationFinancialHref(item.reservationId, returnTo)}>بررسی پرداخت</Link>
              </div>
              <details className={styles.details}>
                <summary>اطلاعات بیشتر<span className="sr-only"> برای رسید {item.reservationNumber}</span></summary>
                <dl className={styles.metadata}>{[
                  ["اقامتگاه", item.propertyName], ["روش پرداخت", methods[item.method] ?? item.method],
                  ...(item.orderCode ? [["سفارش", item.orderCode]] : []),
                  ["زمان ثبت رسید", item.createdAtUtc ? formatDateTime(item.createdAtUtc) : "نامشخص"],
                  ["مهلت اصلی پرداخت", item.paymentExpiresAtUtc ? formatDateTime(item.paymentExpiresAtUtc) : "نامشخص"],
                  ["پایان حفاظت بررسی", item.reviewProtectionExpiresAtUtc ? formatDateTime(item.reviewProtectionExpiresAtUtc) : "فاقد حفاظت معتبر"],
                  ["وضعیت رزرو", statusLabels[item.reservationStatus] ?? (item.reservationStatus === "CapacityLost" ? "ظرفیت از دست رفته" : item.reservationStatus)],
                ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
                <p className={styles.caption}>موارد نیازمند پیگیری مالی، سپس نزدیک‌ترین پایان حفاظت. نمایش در این صف به معنی تأیید پرداخت یا تمدید مهلت نیست.</p>
              </details>
            </li>)}</ul>}
          {data.totalPages > 1 && <nav aria-label="صفحه‌بندی صف بررسی" className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            <span>صفحه {toPersianDigits(data.page)} · {toPersianDigits(data.totalCount)} رسید</span>
            <div className="flex gap-2"><KoochButton size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>قبلی</KoochButton>
              <KoochButton size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>بعدی</KoochButton></div>
          </nav>}
        </> : null}
    </KoochCard>
  </section>;
}
