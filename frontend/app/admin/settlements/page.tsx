"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochField, KoochInput, KoochSelect, KoochSearchableSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochTable, KoochTableBody, KoochTableCell, KoochTableEmpty,
  KoochTableHead, KoochTableHeader, KoochTableRow, KoochTableFilterDialog } from "@/components/KoochTable";
import { apiRequest } from "@/lib/owner-api";
import { formatDate, formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";

type PayableStatus = "Future" | "Due" | "Overdue";
type SettlementStatus = "Pending" | "Due" | "Overdue" | "Paid" | "Cancelled";
type Payable = { id: number; propertyId: number; propertyName: string; reservationNumber: string | null;
  amount: number; currency: string; payableDueDate: string; status: PayableStatus };
type Settlement = { id: number; settlementNumber: string; propertyId: number; propertyName: string; totalAmount: number; currency: string;
  itemCount: number; status: SettlementStatus; createdAtUtc: string; paidAtUtc: string | null; isEarlySettlement: boolean };
type Detail = Omit<Settlement, "itemCount"> & { cancelledAtUtc: string | null; cancellationReason: string | null;
  items: Array<{ financialEntryId: number;
  reservationNumber: string | null; amount: number; payableDueDate: string }> };
type Page<T> = { items: T[]; totalCount: number; page: number; pageSize: number; totalPages: number };
type SortDirection = "Asc" | "Desc";
type PayableFilters = { status: PayableStatus | ""; search: string; sortBy: "PayableDueDate" | "Amount"; sortDirection: SortDirection };
type SettlementFilters = { status: SettlementStatus | ""; sortBy: "CreatedAt" | "TotalAmount" | "ItemCount"; sortDirection: SortDirection };
const defaultPayableFilters: PayableFilters = { status: "", search: "", sortBy: "PayableDueDate", sortDirection: "Asc" };
const defaultSettlementFilters: SettlementFilters = { status: "", sortBy: "CreatedAt", sortDirection: "Desc" };
const labels = { Future: "آینده", Pending: "در انتظار سررسید", Due: "سررسید", Overdue: "معوق", Paid: "پرداخت‌شده", Cancelled: "لغوشده" };
const isUnpaidActive = (status: SettlementStatus) => status === "Pending" || status === "Due" || status === "Overdue";
const errorText = (error: unknown) => error instanceof Error ? error.message : "عملیات انجام نشد؛ دوباره تلاش کنید.";

function StatusBadge({ status }: { status: PayableStatus | SettlementStatus }) {
  return <KoochBadge variant="muted" className={`whitespace-nowrap ${status === "Overdue" ? "text-destructive" : status === "Paid" ? "text-primary" : ""}`}>{labels[status]}</KoochBadge>;
}

function Timestamp({ value }: { value: string | null }) {
  if (!value) return <span>—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>{formatDateTime(value)}</span>;
  return <time dateTime={value} className="inline-flex flex-col gap-0.5 tabular-nums">
    <span>{formatDate(value)}</span>
    <span className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(date)}</span>
  </time>;
}

function Pagination({ page, totalPages, loading, onChange, name }: {
  page: number; totalPages: number; loading: boolean; onChange: (page: number) => void; name: string;
}) {
  if (totalPages < 2) return null;
  return <nav aria-label={name} className="flex flex-wrap items-center justify-end gap-2">
    <KoochButton size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>قبلی</KoochButton>
    <span className="text-sm text-muted-foreground">صفحه {formatNumber(page)} از {formatNumber(totalPages)}</span>
    <KoochButton size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => onChange(page + 1)}>بعدی</KoochButton>
  </nav>;
}

function SettlementManagement() {
  const currencyLabel = useSiteCurrencyLabel();
  const money = (amount: number) => formatCurrency(amount, { currencyLabel });
  const amountOnly = (amount: number) => formatCurrency(amount, { showCurrency: false });
  const [propertyId, setPropertyId] = useState("");
  const [propertySearch, setPropertySearch] = useState("");
  const [properties, setProperties] = useState<Array<{ id: number; name: string }>>([]);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [payablePage, setPayablePage] = useState(1);
  const [settlementPage, setSettlementPage] = useState(1);
  const [payableFilters, setPayableFilters] = useState(defaultPayableFilters);
  const [payableDraft, setPayableDraft] = useState(defaultPayableFilters);
  const [settlementFilters, setSettlementFilters] = useState(defaultSettlementFilters);
  const [settlementDraft, setSettlementDraft] = useState(defaultSettlementFilters);
  const [payables, setPayables] = useState<Page<Payable> | null>(null);
  const [settlements, setSettlements] = useState<Page<Settlement> | null>(null);
  const [payableLoading, setPayableLoading] = useState(true);
  const [settlementLoading, setSettlementLoading] = useState(true);
  const [payableError, setPayableError] = useState("");
  const [settlementError, setSettlementError] = useState("");
  const [early, setEarly] = useState(false);
  const [selected, setSelected] = useState<Payable[]>([]);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequest = useRef(0);
  const [confirmPaid, setConfirmPaid] = useState<Settlement | Detail | null>(null);
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<Settlement | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonError, setCancelReasonError] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const cancellingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setPropertyLoading(true);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ search: propertySearch, page: "1", pageSize: "20" });
      void apiRequest<Page<{ id: number; name: string }>>(`/admin/settlements/properties?${query}`)
        .then(result => { if (active) setProperties(result.items); })
        .catch(error => { if (active) toast.error(errorText(error)); })
        .finally(() => { if (active) setPropertyLoading(false); });
    }, propertySearch ? 300 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [propertySearch]);

  useEffect(() => {
    let active = true;
    setPayableLoading(true);
    setPayableError("");
    const query = new URLSearchParams({ page: String(payablePage), pageSize: "20" });
    if (propertyId) query.set("propertyId", propertyId);
    if (payableFilters.status) query.set("status", payableFilters.status);
    if (payableFilters.search) query.set("search", payableFilters.search);
    if (payableFilters.sortBy !== defaultPayableFilters.sortBy || payableFilters.sortDirection !== defaultPayableFilters.sortDirection) {
      query.set("sortBy", payableFilters.sortBy); query.set("sortDirection", payableFilters.sortDirection);
    }
    void apiRequest<Page<Payable>>(`/admin/settlements/payables?${query}`)
      .then(result => { if (active) setPayables(result); })
      .catch(error => { if (active) setPayableError(errorText(error)); })
      .finally(() => { if (active) setPayableLoading(false); });
    return () => { active = false; };
  }, [propertyId, payablePage, payableFilters, refresh]);

  useEffect(() => {
    let active = true;
    setSettlementLoading(true);
    setSettlementError("");
    const query = new URLSearchParams({ page: String(settlementPage), pageSize: "20" });
    if (propertyId) query.set("propertyId", propertyId);
    if (settlementFilters.status) query.set("status", settlementFilters.status);
    if (settlementFilters.sortBy !== defaultSettlementFilters.sortBy || settlementFilters.sortDirection !== defaultSettlementFilters.sortDirection) {
      query.set("sortBy", settlementFilters.sortBy); query.set("sortDirection", settlementFilters.sortDirection);
    }
    void apiRequest<Page<Settlement>>(`/admin/settlements?${query}`)
      .then(result => { if (active) setSettlements(result); })
      .catch(error => { if (active) setSettlementError(errorText(error)); })
      .finally(() => { if (active) setSettlementLoading(false); });
    return () => { active = false; };
  }, [propertyId, settlementPage, settlementFilters, refresh]);

  function changeProperty(value: string) {
    setPropertyId(value); setPayablePage(1); setSettlementPage(1); setSelected([]);
  }

  const selection = selected[0];
  const incompatible = (item: Payable) => Boolean(selection && (selection.propertyId !== item.propertyId ||
    selection.currency.toUpperCase() !== item.currency.toUpperCase()));

  function select(item: Payable, checked: boolean) {
    if (creatingRef.current || (!early && item.status === "Future") || incompatible(item)) return;
    setSelected(current => checked ? [...current.filter(value => value.id !== item.id), item]
      : current.filter(value => value.id !== item.id));
  }

  async function create() {
    if (creatingRef.current || !selection) return;
    creatingRef.current = true; setCreating(true);
    try {
      await apiRequest<Detail>("/admin/settlements", { method: "POST", body: JSON.stringify({
        propertyId: selection.propertyId, payableEntryIds: selected.map(item => item.id), allowEarlySettlement: early,
      }) });
      setSelected([]); setRefresh(value => value + 1);
      toast.success("تسویه ایجاد شد");
    } catch (error) { toast.error(errorText(error)); }
    finally { creatingRef.current = false; setCreating(false); }
  }

  async function openDetail(id: number) {
    const request = ++detailRequest.current;
    setDetailOpen(true); setDetail(null); setDetailError(""); setDetailLoading(true);
    try {
      const response = await apiRequest<Detail>(`/admin/settlements/${id}`);
      if (request === detailRequest.current) setDetail(response);
    } catch (error) { if (request === detailRequest.current) setDetailError(errorText(error)); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }

  async function markPaid() {
    if (!confirmPaid || payingRef.current) return;
    payingRef.current = true; setPaying(true);
    try {
      const response = await apiRequest<Detail>(`/admin/settlements/${confirmPaid.id}/paid`, { method: "POST" });
      setDetail(current => current?.id === response.id ? response : current);
      setConfirmPaid(null); setRefresh(value => value + 1);
      toast.success("پرداخت تسویه ثبت شد");
    } catch (error) { toast.error(errorText(error)); }
    finally { payingRef.current = false; setPaying(false); }
  }

  async function cancelSettlement() {
    if (!cancelTarget || cancellingRef.current) return;
    if (!cancelReason.trim()) { setCancelReasonError("دلیل لغو تسویه را وارد کنید."); return; }
    cancellingRef.current = true; setCancelling(true); setCancelError("");
    try {
      const response = await apiRequest<Detail>(`/admin/settlements/${cancelTarget.id}/cancel`, {
        method: "POST", body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      setDetail(current => current?.id === response.id ? response : current);
      setCancelTarget(null); setRefresh(value => value + 1);
      toast.success("تسویه لغو شد و اقلام آن آزاد شدند.");
    } catch (error) { setCancelError(errorText(error)); toast.error(errorText(error)); }
    finally { cancellingRef.current = false; setCancelling(false); }
  }

  const payableFilterCount = Number(Boolean(payableFilters.status)) + Number(Boolean(payableFilters.search)) +
    Number(payableFilters.sortBy !== defaultPayableFilters.sortBy || payableFilters.sortDirection !== defaultPayableFilters.sortDirection);
  const settlementFilterCount = Number(Boolean(settlementFilters.status)) +
    Number(settlementFilters.sortBy !== defaultSettlementFilters.sortBy || settlementFilters.sortDirection !== defaultSettlementFilters.sortDirection);

  return <main className="mx-auto grid w-full max-w-[1480px] min-w-0 gap-4 p-4 lg:p-6" dir="rtl">
    <KoochPageHeader eyebrow="" title="تسویه با اقامتگاه‌ها"
      description="بررسی تعهدات مالی اقامتگاه و ثبت پرداخت تسویه‌ها"
      breadcrumb={<><Link href="/admin">پنل مدیریت</Link><span aria-current="page">تسویه‌ها</span></>} />
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <div className="w-full sm:max-w-sm">
        <KoochField label="اقامتگاه">
          <KoochSearchableSelect aria-label="اقامتگاه" value={propertyId} onChange={changeProperty}
            onSearchChange={setPropertySearch} placeholder="همه اقامتگاه‌ها" disabled={creating}
            options={properties.map(property => ({ value: String(property.id), label: property.name }))} />
        </KoochField>
      </div>
      {propertyId && <KoochButton variant="outline" size="sm" disabled={creating} onClick={() => changeProperty("")}>پاک کردن فیلتر</KoochButton>}
      {propertyLoading && <span role="status" className="text-xs text-muted-foreground">بارگذاری اقامتگاه‌ها…</span>}
    </div>

    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
    <KoochCard padding="sm" className="grid min-w-0 gap-3" aria-labelledby="unsettled-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="unsettled-heading" className="text-base font-bold">تعهدات تسویه‌نشده</h2>
        <KoochTableFilterDialog triggerLabel="فیلتر و مرتب‌سازی تعهدات" title="فیلتر و مرتب‌سازی تعهدات"
          disabled={creating} activeCount={payableFilterCount}
          onOpenChange={open => { if (open) setPayableDraft(payableFilters); }}
          onApply={() => { setPayableFilters({ ...payableDraft, search: payableDraft.search.trim() }); setPayablePage(1); }}
          onReset={() => setPayableDraft(defaultPayableFilters)}>
          <KoochField label="وضعیت">
            <KoochSelect value={payableDraft.status} onChange={event => setPayableDraft(current => ({ ...current, status: event.target.value as PayableFilters["status"] }))}>
              <option value="">همه وضعیت‌ها</option>
              {(["Due", "Overdue", "Future"] as const).map(status => <option key={status} value={status}>{labels[status]}</option>)}
            </KoochSelect>
          </KoochField>
          <KoochField label="شماره رزرو">
            <KoochInput value={payableDraft.search} dir="ltr" placeholder="R-XXXXXX"
              onChange={event => setPayableDraft(current => ({ ...current, search: event.target.value }))} />
          </KoochField>
          <div className="grid gap-3 sm:grid-cols-2">
            <KoochField label="مرتب‌سازی بر اساس">
              <KoochSelect value={payableDraft.sortBy} onChange={event => setPayableDraft(current => ({ ...current, sortBy: event.target.value as PayableFilters["sortBy"] }))}>
                <option value="PayableDueDate">تاریخ سررسید</option><option value="Amount">مبلغ</option>
              </KoochSelect>
            </KoochField>
            <KoochField label="ترتیب">
              <KoochSelect value={payableDraft.sortDirection} onChange={event => setPayableDraft(current => ({ ...current, sortDirection: event.target.value as SortDirection }))}>
                <option value="Asc">{payableDraft.sortBy === "Amount" ? "کمترین مبلغ نخست" : "نزدیک‌ترین سررسید نخست"}</option>
                <option value="Desc">{payableDraft.sortBy === "Amount" ? "بیشترین مبلغ نخست" : "دیرترین سررسید نخست"}</option>
              </KoochSelect>
            </KoochField>
          </div>
        </KoochTableFilterDialog>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={early} disabled={creating} className="h-4 w-4 accent-[var(--theme-primary)]"
          onChange={event => { setEarly(event.target.checked); if (!event.target.checked) setSelected(current => current.filter(item => item.status !== "Future")); }} />
        اجازه تسویه زودهنگام اقلام آینده
      </label>
      <p className="text-xs leading-5 text-muted-foreground">در حالت عادی فقط اقلام سررسید و معوق انتخاب می‌شوند. هر تسویه مربوط به یک اقامتگاه و یک واحد پول است.</p>
      <KoochTable aria-label="تعهدات تسویه‌نشده" className="!min-w-0 [&_th]:px-3 [&_td]:px-3">
        <KoochTableHeader><KoochTableRow>{["انتخاب", "شماره رزرو", "اقامتگاه", "مبلغ", "تاریخ سررسید", "وضعیت"].map(label => <KoochTableHead key={label}>{label}</KoochTableHead>)}</KoochTableRow></KoochTableHeader>
        <KoochTableBody>
          {payableLoading ? <KoochTableEmpty colSpan={6}>در حال بارگذاری…</KoochTableEmpty>
            : payableError ? <KoochTableEmpty colSpan={6}><span role="alert">{payableError}</span><KoochButton variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>تلاش مجدد</KoochButton></KoochTableEmpty>
            : !payables?.items.length ? <KoochTableEmpty colSpan={6}>{payableFilterCount > 0 ? "نتیجه‌ای با این فیلترها یافت نشد." : early ? "تعهد تسویه‌نشده‌ای یافت نشد." : "در حال حاضر تعهد سررسیدشده یا معوقی برای تسویه وجود ندارد."}</KoochTableEmpty>
            : payables.items.map(item => <KoochTableRow key={item.id}>
              <KoochTableCell><input type="checkbox" aria-label={`انتخاب ${item.reservationNumber ?? item.id}`}
                className="h-4 w-4 accent-[var(--theme-primary)]" checked={selected.some(value => value.id === item.id)}
                disabled={creating || (!early && item.status === "Future") || incompatible(item)} onChange={event => select(item, event.target.checked)} /></KoochTableCell>
              <KoochTableCell><bdi dir="ltr">{item.reservationNumber ?? "—"}</bdi></KoochTableCell>
              <KoochTableCell>{item.propertyName}</KoochTableCell>
              <KoochTableCell className="whitespace-nowrap tabular-nums">{amountOnly(item.amount)}</KoochTableCell>
              <KoochTableCell className="whitespace-nowrap">{formatDate(item.payableDueDate)}</KoochTableCell>
              <KoochTableCell><StatusBadge status={item.status} /></KoochTableCell>
            </KoochTableRow>)}
        </KoochTableBody>
      </KoochTable>
      <p className="text-xs text-muted-foreground">واحد مبالغ: {currencyLabel}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{formatNumber(selected.length)} قلم انتخاب‌شده{selection ? ` • ${selection.propertyName}` : ""}</span>
          {selection && <span className="font-semibold tabular-nums">مجموع: {money(selected.reduce((total, item) => total + item.amount, 0))}</span>}
        </div>
        <KoochButton disabled={!selected.length || payableLoading || Boolean(payableError)} loading={creating} onClick={() => void create()}>ایجاد تسویه</KoochButton>
      </div>
      <Pagination name="صفحات تعهدات" page={payablePage} totalPages={payables?.totalPages ?? 0} loading={payableLoading} onChange={setPayablePage} />
    </KoochCard>

    <KoochCard padding="sm" className="grid min-w-0 gap-3" aria-labelledby="settlements-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="settlements-heading" className="text-base font-bold">تسویه‌ها</h2>
        <KoochTableFilterDialog triggerLabel="فیلتر و مرتب‌سازی تسویه‌ها" title="فیلتر و مرتب‌سازی تسویه‌ها"
          activeCount={settlementFilterCount}
          onOpenChange={open => { if (open) setSettlementDraft(settlementFilters); }}
          onApply={() => { setSettlementFilters({ ...settlementDraft }); setSettlementPage(1); }}
          onReset={() => setSettlementDraft(defaultSettlementFilters)}>
          <KoochField label="وضعیت">
            <KoochSelect value={settlementDraft.status} onChange={event => setSettlementDraft(current => ({ ...current, status: event.target.value as SettlementFilters["status"] }))}>
              <option value="">همه وضعیت‌ها</option>
              {(["Pending", "Due", "Overdue", "Paid", "Cancelled"] as const).map(status => <option key={status} value={status}>{labels[status]}</option>)}
            </KoochSelect>
          </KoochField>
          <div className="grid gap-3 sm:grid-cols-2">
            <KoochField label="مرتب‌سازی بر اساس">
              <KoochSelect value={settlementDraft.sortBy} onChange={event => setSettlementDraft(current => ({ ...current, sortBy: event.target.value as SettlementFilters["sortBy"] }))}>
                <option value="CreatedAt">زمان ایجاد</option><option value="TotalAmount">مبلغ کل</option><option value="ItemCount">تعداد اقلام</option>
              </KoochSelect>
            </KoochField>
            <KoochField label="ترتیب">
              <KoochSelect value={settlementDraft.sortDirection} onChange={event => setSettlementDraft(current => ({ ...current, sortDirection: event.target.value as SortDirection }))}>
                <option value="Asc">{settlementDraft.sortBy === "CreatedAt" ? "قدیمی‌ترین نخست" : settlementDraft.sortBy === "TotalAmount" ? "کمترین مبلغ نخست" : "کمترین تعداد نخست"}</option>
                <option value="Desc">{settlementDraft.sortBy === "CreatedAt" ? "جدیدترین نخست" : settlementDraft.sortBy === "TotalAmount" ? "بیشترین مبلغ نخست" : "بیشترین تعداد نخست"}</option>
              </KoochSelect>
            </KoochField>
          </div>
        </KoochTableFilterDialog>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">اقلام و زمان ایجاد یا پرداخت هر تسویه در جزئیات آن قابل مشاهده است.</p>
      <KoochTable aria-label="تسویه‌ها" className="!min-w-0 [&_th]:px-3 [&_td]:px-3">
        <KoochTableHeader><KoochTableRow>{["شماره تسویه", "اقامتگاه", "مبلغ کل", "تعداد اقلام", "وضعیت", "عملیات"].map(label => <KoochTableHead key={label}>{label}</KoochTableHead>)}</KoochTableRow></KoochTableHeader>
        <KoochTableBody>
          {settlementLoading ? <KoochTableEmpty colSpan={6}>در حال بارگذاری…</KoochTableEmpty>
            : settlementError ? <KoochTableEmpty colSpan={6}><span role="alert">{settlementError}</span><KoochButton size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>تلاش مجدد</KoochButton></KoochTableEmpty>
            : !settlements?.items.length ? <KoochTableEmpty colSpan={6}>{settlementFilterCount > 0 ? "نتیجه‌ای با این فیلترها یافت نشد." : "تسویه‌ای ثبت نشده است."}</KoochTableEmpty>
            : settlements.items.map(item => <KoochTableRow key={item.id}>
              <KoochTableCell><bdi dir="ltr">{item.settlementNumber}</bdi></KoochTableCell><KoochTableCell>{item.propertyName}</KoochTableCell>
              <KoochTableCell className="whitespace-nowrap tabular-nums">{amountOnly(item.totalAmount)}</KoochTableCell>
              <KoochTableCell>{formatNumber(item.itemCount)}</KoochTableCell><KoochTableCell><StatusBadge status={item.status} /></KoochTableCell>
              <KoochTableCell><div className="flex flex-wrap gap-2"><KoochButton size="sm" variant="outline" onClick={() => void openDetail(item.id)}>جزئیات</KoochButton>
                {isUnpaidActive(item.status) && <>
                  <KoochButton size="sm" variant="outline" disabled={paying && confirmPaid?.id === item.id} onClick={() => setConfirmPaid(item)}>ثبت تسویه</KoochButton>
                  <KoochButton size="sm" variant="outline" onClick={() => {
                    setCancelTarget(item); setCancelReason(""); setCancelReasonError(""); setCancelError("");
                  }}>لغو تسویه</KoochButton>
                </>}</div></KoochTableCell>
            </KoochTableRow>)}
        </KoochTableBody>
      </KoochTable>
      <p className="text-xs text-muted-foreground">واحد مبالغ: {currencyLabel}</p>
      <Pagination name="صفحات تسویه‌ها" page={settlementPage} totalPages={settlements?.totalPages ?? 0} loading={settlementLoading} onChange={setSettlementPage} />
    </KoochCard>
    </div>
    <KoochDialog open={detailOpen} onOpenChange={open => { setDetailOpen(open); if (!open) detailRequest.current++; }} title="جزئیات تسویه" size="lg"
      className="!h-auto !max-h-[90vh] !max-w-[800px]" bodyClassName="!overflow-hidden">
      {detailLoading ? <p role="status">در حال بارگذاری…</p> : detailError ? <p role="alert">{detailError}</p> : detail && <div className="grid gap-3" dir="rtl">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold">{detail.propertyName}</span>
          <span className="text-muted-foreground">·</span>
          <span>تسویه <bdi dir="ltr">{detail.settlementNumber}</bdi></span>
          <StatusBadge status={detail.status} />
        </div>
        <p className="font-bold">مبلغ کل: {money(detail.totalAmount)}</p>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="mb-1 text-muted-foreground">زمان ایجاد</dt><dd><Timestamp value={detail.createdAtUtc} /></dd></div>
          {detail.paidAtUtc && <div><dt className="mb-1 text-muted-foreground">زمان پرداخت</dt><dd><Timestamp value={detail.paidAtUtc} /></dd></div>}
        </dl>
        {detail.cancelledAtUtc && <div className="grid gap-2 text-sm">
          <p className="text-muted-foreground">زمان لغو: <Timestamp value={detail.cancelledAtUtc} /></p>
          <p className="whitespace-pre-wrap break-words">دلیل لغو: {detail.cancellationReason}</p>
        </div>}
        {detail.isEarlySettlement && <p className="text-sm text-muted-foreground">تسویه زودهنگام با حفظ سررسید اصلی اقلام</p>}
        <div className="max-h-[min(52vh,30rem)] overflow-y-auto overscroll-contain">
          <KoochTable aria-label="اقلام تسویه"><KoochTableHeader><KoochTableRow>{["شماره رزرو", "سررسید اصلی", "مبلغ"].map(label => <KoochTableHead key={label}>{label}</KoochTableHead>)}</KoochTableRow></KoochTableHeader>
            <KoochTableBody>{detail.items.map(item => <KoochTableRow key={item.financialEntryId}><KoochTableCell><bdi dir="ltr">{item.reservationNumber ?? "—"}</bdi></KoochTableCell>
              <KoochTableCell>{formatDate(item.payableDueDate)}</KoochTableCell><KoochTableCell>{money(item.amount)}</KoochTableCell></KoochTableRow>)}</KoochTableBody></KoochTable>
        </div>
      </div>}
    </KoochDialog>
    <KoochDialog open={Boolean(cancelTarget)} onOpenChange={open => { if (!open && !cancellingRef.current) setCancelTarget(null); }}
      title="لغو تسویه" size="sm" closeDisabled={cancelling}
      description="با لغو این تسویه، اقلام آن برای ایجاد تسویه جدید آزاد می‌شوند و سابقه تسویه حفظ می‌شود."
      footer={<>
        <KoochButton variant="outline" disabled={cancelling} onClick={() => setCancelTarget(null)}>انصراف</KoochButton>
        <KoochButton type="submit" form="cancel-settlement-form" loading={cancelling}>تأیید لغو تسویه</KoochButton>
      </>}>
      <form id="cancel-settlement-form" noValidate className="grid gap-3" onSubmit={event => { event.preventDefault(); void cancelSettlement(); }}>
        <p className="text-sm">تسویه <bdi dir="ltr">{cancelTarget?.settlementNumber}</bdi> · {cancelTarget?.propertyName}</p>
        <KoochField label="دلیل لغو" required error={cancelReasonError}>
          <KoochTextarea value={cancelReason} required maxLength={2000} rows={4} disabled={cancelling}
            onChange={event => { setCancelReason(event.target.value); setCancelReasonError(""); }} />
        </KoochField>
        {cancelError && <p role="alert" className="text-sm text-destructive">{cancelError}</p>}
      </form>
    </KoochDialog>
    <KoochConfirmDialog open={Boolean(confirmPaid)} onOpenChange={open => { if (!open && !paying) setConfirmPaid(null); }}
      title="ثبت تسویه" description={confirmPaid ? `آیا پرداخت تسویه ${confirmPaid.settlementNumber} برای ${confirmPaid.propertyName} به مبلغ ${money(confirmPaid.totalAmount)} انجام شده است؟ این عمل فقط پرداخت انجام‌شده را ثبت می‌کند و انتقال بانکی انجام نمی‌دهد.` : ""}
      confirmText="تأیید و ثبت تسویه" cancelText="انصراف" loading={paying} variant="question" onConfirm={markPaid} />
  </main>;
}

export default function AdminSettlementsPage() {
  return <AdminLayout requiredPlatformPermission="ManagePayments"><SettlementManagement /></AdminLayout>;
}
