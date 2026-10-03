"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochInput, KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochTable, KoochTableBody, KoochTableCell, KoochTableEmpty, KoochTableHead, KoochTableHeader, KoochTableRow } from "@/components/KoochTable";
import { formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { apiRequest } from "@/lib/owner-api";

type WithdrawalStatus = "Pending" | "Approved" | "Paid" | "Rejected" | "Cancelled";
type PayoutMethod = "BankTransfer" | "CardToCard" | "Other";
type Withdrawal = {
  id: number;
  guestName: string;
  currency: string;
  amount: number;
  status: WithdrawalStatus;
  requestedAtUtc: string;
  processedAtUtc: string | null;
  paidAtUtc: string | null;
  payoutMethod: PayoutMethod | null;
  payoutReferenceNumber: string | null;
  payoutNote: string | null;
};
type Page<T> = { items: T[]; totalCount: number; page: number; pageSize: number; totalPages: number };
type DialogStep = "detail" | "approve" | "reject" | "paidForm" | "paidConfirm";
const statusLabels: Record<WithdrawalStatus, string> = {
  Pending: "در انتظار بررسی", Approved: "تأییدشده", Paid: "پرداخت‌شده",
  Rejected: "ردشده", Cancelled: "لغوشده",
};
const methodLabels: Record<PayoutMethod, string> = {
  BankTransfer: "انتقال بانکی", CardToCard: "کارت به کارت", Other: "سایر",
};
const statuses: WithdrawalStatus[] = ["Pending", "Approved", "Paid", "Rejected", "Cancelled"];
const methods: PayoutMethod[] = ["BankTransfer", "CardToCard", "Other"];
const localDateTimeValue = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const errorText = (error: unknown) => error instanceof Error ? error.message : "عملیات انجام نشد؛ دوباره تلاش کنید.";

function WithdrawalManagement() {
  const [status, setStatus] = useState<WithdrawalStatus | "">("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<Page<Withdrawal> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Withdrawal | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [step, setStep] = useState<DialogStep>("detail");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const detailRequestRef = useRef(0);
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod | "">("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paidAtLocal, setPaidAtLocal] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) query.set("status", status);
    setListLoading(true);
    setListError("");
    void apiRequest<Page<Withdrawal>>(`/admin/wallet/withdrawals?${query}`).then(result => {
      if (active) setList(result);
    }).catch(error => {
      if (active) setListError(errorText(error));
    }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [page, status, refresh]);

  const loadDetail = useCallback(async (id: number) => {
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setDetailError("");
    setDetail(null);
    try {
      const result = await apiRequest<Withdrawal>(`/admin/wallet/withdrawals/${id}`);
      if (requestId === detailRequestRef.current) setDetail(result);
    } catch (error) {
      if (requestId === detailRequestRef.current) setDetailError(errorText(error));
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, []);

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetail(null);
    setStep("detail");
    void loadDetail(id);
  };

  const mutate = async (action: "approve" | "reject" | "paid", body?: object) => {
    if (busyRef.current || selectedId === null) return;
    busyRef.current = true;
    setBusy(true);
    setDetailError("");
    try {
      await apiRequest<Withdrawal>(`/admin/wallet/withdrawals/${selectedId}/${action}`, {
        method: "PUT",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      toast.success(action === "approve" ? "درخواست برداشت تأیید شد." : action === "reject" ? "درخواست برداشت رد شد." : "پرداخت برداشت ثبت شد.");
      setStep("detail");
      setRefresh(value => value + 1);
      await loadDetail(selectedId);
    } catch (error) {
      const message = errorText(error);
      setDetailError(message);
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openPaidForm = () => {
    setPayoutMethod("");
    setReferenceNumber("");
    setPaidAtLocal(localDateTimeValue(new Date()));
    setNote("");
    setFormError("");
    setStep("paidForm");
  };

  const reviewPaidForm = () => {
    if (!payoutMethod || !referenceNumber.trim() || referenceNumber.trim().length > 200 ||
        !paidAtLocal || Number.isNaN(new Date(paidAtLocal).getTime()) || note.trim().length > 2000) {
      setFormError("روش پرداخت، مرجع معتبر و زمان پرداخت را تکمیل کنید.");
      return;
    }
    setFormError("");
    setStep("paidConfirm");
  };

  const confirmPaid = () => {
    void mutate("paid", {
      payoutMethod,
      referenceNumber: referenceNumber.trim(),
      paidAtUtc: new Date(paidAtLocal).toISOString(),
      note: note.trim() || null,
    });
  };

  const dialogTitle = step === "approve" ? "تأیید درخواست برداشت" : step === "reject" ? "رد درخواست برداشت" :
    step === "paidForm" ? "ثبت پرداخت" : step === "paidConfirm" ? "تأیید نهایی پرداخت" : "جزئیات درخواست برداشت";
  const details = detail && <div className="grid gap-3 text-sm sm:grid-cols-2">
    <p>مهمان: <span className="font-semibold">{detail.guestName}</span></p>
    <p>مبلغ درخواستی: <span className="font-semibold tabular-nums">{formatCurrency(detail.amount, { showCurrency: false })} <bdi dir="ltr">{detail.currency}</bdi></span></p>
    <p>وضعیت: <KoochBadge variant="muted">{statusLabels[detail.status]}</KoochBadge></p>
    <p>زمان درخواست: <time dateTime={detail.requestedAtUtc}>{formatDateTime(detail.requestedAtUtc)}</time></p>
    {detail.processedAtUtc && <p>زمان بررسی: <time dateTime={detail.processedAtUtc}>{formatDateTime(detail.processedAtUtc)}</time></p>}
    {detail.paidAtUtc && <p>زمان پرداخت: <time dateTime={detail.paidAtUtc}>{formatDateTime(detail.paidAtUtc)}</time></p>}
    {detail.payoutMethod && <p>روش پرداخت: {methodLabels[detail.payoutMethod]}</p>}
    {detail.payoutReferenceNumber && <p>مرجع پرداخت: <bdi dir="ltr">{detail.payoutReferenceNumber}</bdi></p>}
    {detail.payoutNote && <p className="sm:col-span-2">یادداشت پرداخت: {detail.payoutNote}</p>}
  </div>;

  return <main className="mx-auto grid w-full max-w-[1480px] min-w-0 gap-4 p-4 lg:p-6" dir="rtl">
    <KoochPageHeader eyebrow="مدیریت مالی" title="درخواست‌های برداشت کیف پول" description="بررسی درخواست‌ها و ثبت پرداخت‌های انجام‌شده" />
    <KoochCard className="min-w-0 space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <KoochField label="وضعیت" className="w-full sm:w-56">
          <KoochSelect value={status} onChange={event => { setStatus(event.target.value as WithdrawalStatus | ""); setPage(1); }}>
            <option value="">همه</option>
            {statuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}
          </KoochSelect>
        </KoochField>
        <span className="text-sm text-muted-foreground">{formatNumber(list?.totalCount ?? 0)} درخواست</span>
      </div>
      {listError && <p role="alert" className="text-sm text-destructive">{listError} <KoochButton size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>تلاش دوباره</KoochButton></p>}
      <KoochTable>
        <KoochTableHeader><KoochTableRow>
          <KoochTableHead>مهمان</KoochTableHead><KoochTableHead>مبلغ</KoochTableHead><KoochTableHead>واحد پول</KoochTableHead>
          <KoochTableHead>وضعیت</KoochTableHead><KoochTableHead>زمان درخواست</KoochTableHead><KoochTableHead>زمان بررسی / پرداخت</KoochTableHead><KoochTableHead>عملیات</KoochTableHead>
        </KoochTableRow></KoochTableHeader>
        <KoochTableBody>
          {listLoading ? <KoochTableEmpty colSpan={7}>در حال بارگذاری درخواست‌ها…</KoochTableEmpty> :
            !list?.items.length ? <KoochTableEmpty colSpan={7}>درخواست برداشتی وجود ندارد.</KoochTableEmpty> :
            list.items.map(item => <KoochTableRow key={item.id} onClick={() => openDetail(item.id)} className="cursor-pointer">
              <KoochTableCell>{item.guestName}</KoochTableCell>
              <KoochTableCell className="tabular-nums">{formatCurrency(item.amount, { showCurrency: false })}</KoochTableCell>
              <KoochTableCell><bdi dir="ltr">{item.currency}</bdi></KoochTableCell>
              <KoochTableCell><KoochBadge variant="muted">{statusLabels[item.status]}</KoochBadge></KoochTableCell>
              <KoochTableCell><time dateTime={item.requestedAtUtc}>{formatDateTime(item.requestedAtUtc)}</time></KoochTableCell>
              <KoochTableCell>{item.paidAtUtc ? formatDateTime(item.paidAtUtc) : item.processedAtUtc ? formatDateTime(item.processedAtUtc) : "—"}</KoochTableCell>
              <KoochTableCell><KoochButton size="sm" variant="outline" onClick={event => { event.stopPropagation(); openDetail(item.id); }}>جزئیات</KoochButton></KoochTableCell>
            </KoochTableRow>)}
        </KoochTableBody>
      </KoochTable>
      {(list?.totalPages ?? 0) > 1 && <nav aria-label="صفحات درخواست‌های برداشت" className="flex flex-wrap items-center justify-end gap-2">
        <KoochButton size="sm" variant="outline" disabled={listLoading || page <= 1} onClick={() => setPage(value => value - 1)}>قبلی</KoochButton>
        <span className="text-sm text-muted-foreground">صفحه {formatNumber(page)} از {formatNumber(list?.totalPages ?? 0)}</span>
        <KoochButton size="sm" variant="outline" disabled={listLoading || page >= (list?.totalPages ?? 0)} onClick={() => setPage(value => value + 1)}>بعدی</KoochButton>
      </nav>}
    </KoochCard>

    <KoochDialog open={selectedId !== null} onOpenChange={open => { if (!open && !busy) { detailRequestRef.current += 1; setSelectedId(null); } }} title={dialogTitle} size="sm" closeDisabled={busy}
      footer={<div className="flex flex-wrap justify-end gap-2">
        {step !== "detail" && <KoochButton variant="outline" disabled={busy} onClick={() => setStep(step === "paidConfirm" ? "paidForm" : "detail")}>بازگشت</KoochButton>}
        {step === "detail" && detail?.status === "Pending" && <>
          <KoochButton variant="outline" onClick={() => setStep("reject")}>رد درخواست</KoochButton>
          <KoochButton onClick={() => setStep("approve")}>تأیید درخواست</KoochButton>
        </>}
        {step === "detail" && detail?.status === "Approved" && <KoochButton onClick={openPaidForm}>ثبت پرداخت</KoochButton>}
        {step === "approve" && <KoochButton loading={busy} onClick={() => void mutate("approve")}>تأیید درخواست</KoochButton>}
        {step === "reject" && <KoochButton variant="destructive" loading={busy} onClick={() => void mutate("reject")}>رد درخواست</KoochButton>}
        {step === "paidForm" && <KoochButton onClick={reviewPaidForm}>بررسی نهایی</KoochButton>}
        {step === "paidConfirm" && <KoochButton loading={busy} onClick={confirmPaid}>ثبت نهایی پرداخت</KoochButton>}
      </div>}>
      {detailLoading ? <p>در حال بارگذاری جزئیات…</p> : !detail ? <p role="alert">{detailError || "جزئیات در دسترس نیست."}</p> : <div className="space-y-4">
        {details}
        {step === "approve" && <p className="rounded-lg border border-border bg-muted p-3 text-sm">با تأیید این درخواست، وجه همچنان رزرو می‌ماند و هنوز پرداختی ثبت نمی‌شود.</p>}
        {step === "reject" && <p className="rounded-lg border border-border bg-muted p-3 text-sm">درخواست رد می‌شود و وجه رزروشده مطابق قوانین انقضای کیف پول آزاد می‌شود. هیچ برداشت یا پرداختی ثبت نمی‌شود.</p>}
        {step === "paidForm" && <div className="grid gap-3">
          <KoochField label="روش پرداخت" required error={formError && !payoutMethod ? "روش پرداخت را انتخاب کنید." : undefined}><KoochSelect value={payoutMethod} onChange={event => setPayoutMethod(event.target.value as PayoutMethod | "")}><option value="">انتخاب کنید</option>{methods.map(method => <option key={method} value={method}>{methodLabels[method]}</option>)}</KoochSelect></KoochField>
          <KoochField label="شماره/مرجع پرداخت" required error={formError && !referenceNumber.trim() ? "مرجع پرداخت را وارد کنید." : undefined}><KoochInput value={referenceNumber} maxLength={200} onChange={event => setReferenceNumber(event.target.value)} /></KoochField>
          <KoochField label="زمان واقعی پرداخت" required error={formError && (!paidAtLocal || Number.isNaN(new Date(paidAtLocal).getTime())) ? "زمان معتبر پرداخت را وارد کنید." : undefined}><KoochInput type="datetime-local" value={paidAtLocal} onChange={event => setPaidAtLocal(event.target.value)} /></KoochField>
          <KoochField label="یادداشت پرداخت" error={formError && note.trim().length > 2000 ? "یادداشت نباید بیش از ۲۰۰۰ نویسه باشد." : undefined}><KoochTextarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></KoochField>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        </div>}
        {step === "paidConfirm" && <div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-sm">
          <p>مبلغ پرداختی: {formatCurrency(detail.amount, { showCurrency: false })} <bdi dir="ltr">{detail.currency}</bdi></p>
          <p>روش پرداخت: {payoutMethod && methodLabels[payoutMethod]}</p>
          <p>شماره/مرجع پرداخت: <bdi dir="ltr">{referenceNumber.trim()}</bdi></p>
          <p>زمان پرداخت: {formatDateTime(new Date(paidAtLocal).toISOString())}</p>
          <p className="font-medium">با ثبت این مرحله، برداشت به‌عنوان پرداخت‌شده ثبت و مبلغ از کیف پول کسر می‌شود.</p>
        </div>}
        {detailError && <p role="alert" className="text-sm text-destructive">{detailError}</p>}
      </div>}
    </KoochDialog>
  </main>;
}

export default function AdminWalletWithdrawalsPage() {
  return <AdminLayout requiredPlatformPermission="ManagePayments"><WithdrawalManagement /></AdminLayout>;
}
