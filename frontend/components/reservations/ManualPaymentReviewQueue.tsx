"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochTable, KoochTableHeader, KoochTableHead, KoochTableRow, KoochTableCell } from "@/components/KoochTable";
import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import { formatDateTime, statusLabels } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { toPersianDigits } from "@/lib/persian-digits";
import { paymentReviewListHref, reservationFinancialHref } from "./admin-reservation-navigation";
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
  Protected: { label: "حفاظت فعال", warning: false },
  ExpiringSoon: { label: "نزدیک پایان حفاظت", warning: true },
  ProtectionExpired: { label: "حفاظت پایان یافته؛ نیازمند پیگیری مالی", warning: true },
  FinancialFollowUp: { label: "بدون حفاظت؛ نیازمند پیگیری مالی", warning: true },
} as const;
const methods: Record<string, string> = { CardToCard: "کارت‌به‌کارت", BankTransfer: "واریز بانکی", Paya: "پایا",
  Satna: "ساتنا", AccountTransfer: "انتقال حساب", Other: "سایر" };

export function ManualPaymentReviewQueue({ propertyId, refreshKey = 0, returnTo, summaryOnly = false,
  page: controlledPage, onPageChange, onTotalCountChange, onOpenReview }: {
  propertyId?: number; refreshKey?: number; returnTo?: string; summaryOnly?: boolean;
  page?: number; onPageChange?: (page: number) => void;
  onTotalCountChange?: (count: number) => void; onOpenReview?: () => void;
}) {
  const [localPage, setLocalPage] = useState(1);
  const page = summaryOnly ? 1 : controlledPage ?? localPage;
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<ManualPaymentReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const detailsId = useId();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    const params = new URLSearchParams({ page: String(page), pageSize: summaryOnly ? "1" : "20" });
    if (propertyId !== undefined) params.set("propertyId", String(propertyId));
    apiRequest<ManualPaymentReviewPage>(`/admin/manual-payments/pending?${params}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, result.totalPages);
        onTotalCountChange?.(result.totalCount);
        if (page > lastPage) { setLocalPage(lastPage); onPageChange?.(lastPage); return; }
        setData(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof ApiRequestError && reason.status === 403
          ? "به صف بررسی پرداخت‌ها دسترسی ندارید." : "دریافت پرداخت‌های در انتظار بررسی انجام نشد.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, propertyId, refreshKey, retry, summaryOnly, onTotalCountChange, onPageChange]);
  useEffect(() => {
    const refresh = () => setRetry(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  if (summaryOnly) {
    if (loading) return <p role="status" className="text-sm text-muted-foreground">در حال دریافت تعداد پرداخت‌های در انتظار بررسی...</p>;
    if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>{error}</span><KoochButton size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>تلاش دوباره</KoochButton>
    </div>;
    if (!data?.totalCount) return null;
    return <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <p className="font-semibold text-foreground">{title} · {toPersianDigits(data.totalCount)}</p>
      {onOpenReview ? <KoochButton size="sm" variant="ghost" onClick={onOpenReview}>بررسی پرداخت‌ها</KoochButton>
        : <Link href={paymentReviewListHref} className="inline-flex min-h-11 items-center rounded font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">بررسی پرداخت‌ها</Link>}
    </div>;
  }

  function changePage(value: number) { setLocalPage(value); onPageChange?.(value); }
  function toggleDetails(paymentId: number) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(paymentId)) next.delete(paymentId);
      else next.add(paymentId);
      return next;
    });
  }

  return <section aria-label={title} id="manual-payment-review">
    <KoochCard padding="sm">
      <div className={styles.header}>
        <h2 className="text-sm font-bold text-foreground">{title}
          {data && !onTotalCountChange && <span className={styles.count}> · {toPersianDigits(data.totalCount)}</span>}
        </h2>
        <KoochButton size="sm" variant="outline" loading={loading} onClick={() => setRetry(value => value + 1)}>به‌روزرسانی</KoochButton>
      </div>
      {loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">در حال دریافت صف بررسی...</p>
        : error ? <KoochAlert className="mt-3" title="صف بررسی در دسترس نیست" variant="destructive">
          <p>{error}</p><KoochButton size="sm" className="mt-2" variant="outline" onClick={() => setRetry(value => value + 1)}>تلاش دوباره</KoochButton>
        </KoochAlert> : data ? <>
          {data.items.length === 0 ? <p role="status" className="mt-3 text-sm text-muted-foreground">رسیدی در انتظار بررسی نیست.</p>
            : <div className={styles.tableArea}><KoochTable className={styles.table} aria-label="رسیدهای در انتظار بررسی" role="table">
              <KoochTableHeader><KoochTableRow>
                {["رزرو / مهمان", "مبلغ", "وضعیت بررسی", "اقدام"].map(label => <KoochTableHead key={label}>{label}</KoochTableHead>)}
              </KoochTableRow></KoochTableHeader>
              {data.items.map(item => <tbody key={item.paymentId} className={styles.receipt} role="rowgroup">
                <KoochTableRow className={styles.row} role="row">
                  <KoochTableCell role="cell"><div className={styles.identity}>
                    <bdi className="font-semibold">{item.reservationNumber}</bdi>
                    <span>{item.guestName || "نام مهمان ثبت نشده"}</span>
                  </div></KoochTableCell>
                  <KoochTableCell className={styles.amount} role="cell"><strong>{formatCurrency(item.amount, { currencyLabel: item.currency === "IRR" ? "ریال" : item.currency })}</strong></KoochTableCell>
                  <KoochTableCell role="cell"><div className={styles.reviewStatus}>
                    <KoochBadge variant="muted">در انتظار بررسی</KoochBadge>
                    <span className={states[item.reviewState].warning ? styles.warning : styles.protection}>{states[item.reviewState].label}</span>
                  </div></KoochTableCell>
                  <KoochTableCell role="cell"><div className={styles.actions}>
                    <Link className={styles.review} aria-label={`بررسی پرداخت ${item.reservationNumber}`}
                      href={reservationFinancialHref(item.reservationId, returnTo)}>بررسی پرداخت</Link>
                    <KoochButton size="sm" variant="ghost" aria-expanded={expanded.has(item.paymentId)}
                      aria-controls={`${detailsId}-${item.paymentId}`} aria-label={`جزئیات رسید ${item.reservationNumber}`}
                      onClick={() => toggleDetails(item.paymentId)}>جزئیات</KoochButton>
                  </div></KoochTableCell>
                </KoochTableRow>
                <tr className={styles.detailRow} hidden={!expanded.has(item.paymentId)} role="row">
                  <KoochTableCell colSpan={4} role="cell"><div id={`${detailsId}-${item.paymentId}`}>
                    <dl className={styles.metadata}>{[
                      ["اقامتگاه", item.propertyName], ["روش پرداخت", methods[item.method] ?? item.method],
                      ...(item.orderCode ? [["سفارش", item.orderCode]] : []),
                      ["زمان ثبت رسید", item.createdAtUtc ? formatDateTime(item.createdAtUtc) : "نامشخص"],
                      ["مهلت اصلی پرداخت", item.paymentExpiresAtUtc ? formatDateTime(item.paymentExpiresAtUtc) : "نامشخص"],
                      ["پایان حفاظت بررسی", item.reviewProtectionExpiresAtUtc ? formatDateTime(item.reviewProtectionExpiresAtUtc) : "فاقد حفاظت معتبر"],
                      ["وضعیت رزرو", statusLabels[item.reservationStatus] ?? (item.reservationStatus === "CapacityLost" ? "ظرفیت از دست رفته" : item.reservationStatus)],
                    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
                  </div></KoochTableCell>
                </tr>
              </tbody>)}
            </KoochTable>
              <p className={styles.caption}>موارد نیازمند پیگیری مالی، سپس نزدیک‌ترین پایان حفاظت. نمایش در این صف به معنی تأیید پرداخت یا تمدید مهلت نیست.</p>
            </div>}
          {data.totalPages > 1 && <nav aria-label="صفحه‌بندی صف بررسی" className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            <span>صفحه {toPersianDigits(data.page)} · {toPersianDigits(data.totalCount)} رسید</span>
            <div className="flex gap-2"><KoochButton size="sm" variant="outline" disabled={page <= 1} onClick={() => changePage(page - 1)}>قبلی</KoochButton>
              <KoochButton size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => changePage(page + 1)}>بعدی</KoochButton></div>
          </nav>}
        </> : null}
    </KoochCard>
  </section>;
}
