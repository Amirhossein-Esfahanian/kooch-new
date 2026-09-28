"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { useOwnerProperty } from "@/components/owner/OwnerPropertyProvider";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochInput, KoochSelect } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  KoochTable, KoochTableBody, KoochTableCell, KoochTableEmpty,
  KoochTableFilterDialog, KoochTableHead, KoochTableHeader, KoochTableRow,
} from "@/components/KoochTable";
import { formatDate, formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { apiRequest } from "@/lib/owner-api";
import { canViewOwnerMenuItem } from "@/lib/property-menu-permissions";

type SettlementStatus = "Pending" | "Due" | "Overdue" | "Paid" | "Cancelled";
type SortBy = "CreatedAt" | "TotalAmount" | "ItemCount" | "DueDate";
type SortDirection = "Asc" | "Desc";
type Filters = { search: string; status: SettlementStatus | ""; sortBy: SortBy; sortDirection: SortDirection };
type Summary = {
  settlementNumber: string;
  status: SettlementStatus;
  totalAmount: number;
  currency: string;
  itemCount: number;
  createdAtUtc: string;
  oldestPayableDueDate: string | null;
  paidAtUtc: string | null;
  canViewReceipt: boolean;
};
type Detail = Summary & {
  payment: { paymentMethod: "BankTransfer" | "CardToCard" | "Other"; referenceNumber: string; paidAtUtc: string } | null;
  items: Array<{ reservationNumber: string | null; payableDueDate: string | null; amount: number }>;
};
type Page<T> = { items: T[]; totalCount: number; page: number; pageSize: number; totalPages: number };

const pageSize = 20;
const defaultFilters: Filters = { search: "", status: "", sortBy: "CreatedAt", sortDirection: "Desc" };
const statusLabels: Record<SettlementStatus, string> = {
  Pending: "در انتظار سررسید", Due: "سررسید", Overdue: "معوق",
  Paid: "پرداخت‌شده", Cancelled: "لغوشده",
};
const paymentMethodLabels = {
  BankTransfer: "انتقال بانکی", CardToCard: "کارت به کارت", Other: "سایر",
};

function money(amount: number, currency: string) {
  return formatCurrency(amount, { currencyLabel: currency });
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "دریافت سوابق تسویه انجام نشد.";
}

function StatusBadge({ status }: { status: SettlementStatus }) {
  return <KoochBadge variant="muted" className={`whitespace-nowrap ${status === "Overdue" ? "text-destructive" : status === "Paid" ? "text-primary" : ""}`}>
    {statusLabels[status]}
  </KoochBadge>;
}

function SettlementHistory() {
  const propertyId = Number(useParams<{ id: string }>().id);
  const { propertyName, effectivePermissions } = useOwnerProperty();
  const allowed = canViewOwnerMenuItem(effectivePermissions, "Financial");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Summary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequest = useRef(0);

  useEffect(() => {
    detailRequest.current++;
    setDetailOpen(false);
    setDetail(null);
  }, [allowed, propertyId]);

  useEffect(() => {
    if (!allowed || !Number.isInteger(propertyId) || propertyId <= 0) return;
    let active = true;
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters.search) query.set("search", filters.search);
    if (filters.status) query.set("status", filters.status);
    if (filters.sortBy !== defaultFilters.sortBy || filters.sortDirection !== defaultFilters.sortDirection) {
      query.set("sortBy", filters.sortBy);
      query.set("sortDirection", filters.sortDirection);
    }
    setLoading(true);
    setError("");
    void apiRequest<Page<Summary>>(`/owner/properties/${propertyId}/settlements?${query}`)
      .then(response => { if (active) setResult(response); })
      .catch(caught => { if (active) setError(errorText(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, filters, page, propertyId, retry]);

  async function openDetail(settlementNumber: string) {
    if (!allowed) return;
    const request = ++detailRequest.current;
    setDetailOpen(true);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await apiRequest<Detail>(`/owner/properties/${propertyId}/settlements/${encodeURIComponent(settlementNumber)}`);
      if (request === detailRequest.current) setDetail(response);
    } catch (caught) {
      if (request === detailRequest.current) setDetailError(errorText(caught));
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  const activeCount = Number(Boolean(filters.search)) + Number(Boolean(filters.status)) +
    Number(filters.sortBy !== defaultFilters.sortBy || filters.sortDirection !== defaultFilters.sortDirection);
  const receiptHref = (number: string) => `/owner/properties/${propertyId}/settlements/${encodeURIComponent(number)}/receipt`;

  return <main className="mx-auto grid w-full max-w-[1480px] min-w-0 gap-4 p-4 lg:p-6" dir="rtl">
    <KoochPageHeader eyebrow="اقامتگاه" title="سوابق تسویه"
      description={`تاریخچه تسویه‌های ${propertyName ?? "اقامتگاه"}`}
      breadcrumb={<><Link href={`/owner/properties/${propertyId}`}>اقامتگاه</Link><span aria-current="page">تسویه‌ها</span></>} />
    {!allowed ? <KoochCard padding="sm"><p role="alert" className="text-sm text-muted-foreground">دسترسی مشاهده تسویه‌های این اقامتگاه را ندارید.</p></KoochCard> : <KoochCard padding="sm" className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold">تسویه‌ها {result ? `(${formatNumber(result.totalCount)})` : ""}</h2>
        <KoochTableFilterDialog triggerLabel="فیلتر و مرتب‌سازی تسویه‌ها" title="فیلتر و مرتب‌سازی تسویه‌ها"
          activeCount={activeCount} onOpenChange={open => { if (open) setDraft(filters); }}
          onApply={() => { setFilters({ ...draft, search: draft.search.trim() }); setPage(1); }}
          onReset={() => setDraft(defaultFilters)}>
          <KoochField label="شماره تسویه یا رزرو">
            <KoochInput value={draft.search} dir="ltr" placeholder="S-XXXXXX یا R-XXXXXX"
              onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} />
          </KoochField>
          <KoochField label="وضعیت">
            <KoochSelect value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value as Filters["status"] }))}>
              <option value="">همه وضعیت‌ها</option>
              {(Object.keys(statusLabels) as SettlementStatus[]).map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </KoochSelect>
          </KoochField>
          <div className="grid gap-3 sm:grid-cols-2">
            <KoochField label="مرتب‌سازی بر اساس">
              <KoochSelect value={draft.sortBy} onChange={event => setDraft(current => ({ ...current, sortBy: event.target.value as SortBy }))}>
                <option value="CreatedAt">زمان ایجاد</option><option value="TotalAmount">مبلغ</option>
                <option value="ItemCount">تعداد رزروها</option><option value="DueDate">تاریخ سررسید</option>
              </KoochSelect>
            </KoochField>
            <KoochField label="ترتیب">
              <KoochSelect value={draft.sortDirection} onChange={event => setDraft(current => ({ ...current, sortDirection: event.target.value as SortDirection }))}>
                <option value="Asc">صعودی</option><option value="Desc">نزولی</option>
              </KoochSelect>
            </KoochField>
          </div>
        </KoochTableFilterDialog>
      </div>
      <KoochTable aria-label="سوابق تسویه" className="[&_th]:px-3 [&_td]:px-3">
        <KoochTableHeader><KoochTableRow>{["شماره تسویه", "وضعیت", "مبلغ", "تعداد رزروها", "سررسید", "تاریخ پرداخت", "عملیات"].map(label => <KoochTableHead key={label}>{label}</KoochTableHead>)}</KoochTableRow></KoochTableHeader>
        <KoochTableBody>
          {loading ? <KoochTableEmpty colSpan={7}>در حال بارگذاری…</KoochTableEmpty>
            : error ? <KoochTableEmpty colSpan={7}><span role="alert">{error}</span><KoochButton variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>تلاش مجدد</KoochButton></KoochTableEmpty>
            : !result?.items.length ? <KoochTableEmpty colSpan={7}>{activeCount ? "نتیجه‌ای با این فیلترها یافت نشد." : "تسویه‌ای ثبت نشده است."}</KoochTableEmpty>
            : result.items.map(item => <KoochTableRow key={item.settlementNumber}>
              <KoochTableCell><bdi dir="ltr">{item.settlementNumber}</bdi></KoochTableCell>
              <KoochTableCell><StatusBadge status={item.status} /></KoochTableCell>
              <KoochTableCell className="whitespace-nowrap tabular-nums">{money(item.totalAmount, item.currency)}</KoochTableCell>
              <KoochTableCell>{formatNumber(item.itemCount)}</KoochTableCell>
              <KoochTableCell className="whitespace-nowrap">{formatDate(item.oldestPayableDueDate)}</KoochTableCell>
              <KoochTableCell className="whitespace-nowrap">{formatDate(item.paidAtUtc)}</KoochTableCell>
              <KoochTableCell><div className="flex flex-wrap gap-2">
                <KoochButton size="sm" variant="outline" onClick={() => void openDetail(item.settlementNumber)}>جزئیات</KoochButton>
                {item.canViewReceipt && <Link href={receiptHref(item.settlementNumber)} className="inline-flex min-h-9 items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">مشاهده رسید</Link>}
              </div></KoochTableCell>
            </KoochTableRow>)}
        </KoochTableBody>
      </KoochTable>
      {result && result.totalPages > 1 && <nav aria-label="صفحات تسویه‌ها" className="flex flex-wrap items-center justify-end gap-2">
        <KoochButton size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>قبلی</KoochButton>
        <span className="text-sm text-muted-foreground">صفحه {formatNumber(page)} از {formatNumber(result.totalPages)}</span>
        <KoochButton size="sm" variant="outline" disabled={loading || page >= result.totalPages} onClick={() => setPage(value => value + 1)}>بعدی</KoochButton>
      </nav>}
    </KoochCard>}
    <KoochDialog open={allowed && detailOpen} onOpenChange={open => { setDetailOpen(open); if (!open) detailRequest.current++; }}
      title="جزئیات تسویه" size="lg" className="!h-auto !max-h-[90vh] !max-w-[800px]" bodyClassName="!overflow-hidden">
      {detailLoading ? <p role="status">در حال بارگذاری…</p> : detailError ? <p role="alert">{detailError}</p> : detail && <div className="grid gap-3" dir="rtl">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>تسویه <bdi dir="ltr">{detail.settlementNumber}</bdi></span><StatusBadge status={detail.status} /></div>
        <p className="font-bold">مبلغ کل: {money(detail.totalAmount, detail.currency)}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">زمان ایجاد</dt><dd>{formatDateTime(detail.createdAtUtc)}</dd></div>
          <div><dt className="text-muted-foreground">قدیمی‌ترین سررسید</dt><dd>{formatDate(detail.oldestPayableDueDate)}</dd></div>
          {detail.paidAtUtc && <div><dt className="text-muted-foreground">زمان پرداخت</dt><dd>{formatDateTime(detail.paidAtUtc)}</dd></div>}
          {detail.payment && <>
            <div><dt className="text-muted-foreground">روش پرداخت</dt><dd>{paymentMethodLabels[detail.payment.paymentMethod]}</dd></div>
            <div><dt className="text-muted-foreground">شماره پیگیری / مرجع</dt><dd><bdi dir="ltr" className="break-all">{detail.payment.referenceNumber}</bdi></dd></div>
          </>}
        </dl>
        <div className="max-h-[min(52vh,30rem)] overflow-y-auto overscroll-contain">
          <KoochTable aria-label="اقلام تسویه"><KoochTableHeader><KoochTableRow>{["شماره رزرو", "سررسید اصلی", "مبلغ"].map(label => <KoochTableHead key={label}>{label}</KoochTableHead>)}</KoochTableRow></KoochTableHeader>
            <KoochTableBody>{detail.items.map((item, index) => <KoochTableRow key={`${item.reservationNumber ?? "legacy"}-${index}`}>
              <KoochTableCell>{item.reservationNumber ? <bdi dir="ltr">{item.reservationNumber}</bdi> : <span className="text-muted-foreground">شماره رزرو در سوابق موجود نیست</span>}</KoochTableCell>
              <KoochTableCell>{formatDate(item.payableDueDate)}</KoochTableCell>
              <KoochTableCell className="whitespace-nowrap">{money(item.amount, detail.currency)}</KoochTableCell>
            </KoochTableRow>)}</KoochTableBody></KoochTable>
        </div>
        {detail.canViewReceipt && <Link href={receiptHref(detail.settlementNumber)} className="justify-self-start text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">مشاهده رسید</Link>}
      </div>}
    </KoochDialog>
  </main>;
}

export default function OwnerSettlementsPage() {
  const { id } = useParams<{ id: string }>();
  return <OwnerLayout><SettlementHistory key={id} /></OwnerLayout>;
}
