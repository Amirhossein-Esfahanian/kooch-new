"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochTable, KoochTableBody, KoochTableCell, KoochTableEmpty, KoochTableHead, KoochTableHeader, KoochTableRow } from "@/components/KoochTable";
import { formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { apiRequest } from "@/lib/owner-api";

type Balance = { currency: string; balance: number; withdrawableBalance: number; nonWithdrawableBalance: number };
type WithdrawalStatus = "Pending" | "Approved" | "Paid" | "Rejected" | "Cancelled";
type Withdrawal = { id: number; currency: string; amount: number; status: WithdrawalStatus; requestedAtUtc: string };
type Page<T> = { items: T[]; totalCount: number; page: number; pageSize: number; totalPages: number };
type RequestForm = { amount: number };
const pageSize = 10;
const statusLabels: Record<WithdrawalStatus, string> = {
  Pending: "در انتظار بررسی",
  Approved: "تأییدشده؛ در انتظار پرداخت",
  Paid: "پرداخت‌شده",
  Rejected: "ردشده",
  Cancelled: "لغوشده",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "درخواست انجام نشد؛ دوباره تلاش کنید.";

export default function AccountWalletPage() {
  const router = useRouter();
  const session = useAuthSession();
  const hasAccountWorkspace = session.workspaces.includes("account");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState("");
  const [history, setHistory] = useState<Page<Withdrawal> | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [supportVisible, setSupportVisible] = useState(false);
  const submittingRef = useRef(false);

  const requestSchema = useMemo(() => z.object({
    amount: z.number({ error: "مبلغ درخواست را وارد کنید." })
      .positive("مبلغ باید بیشتر از صفر باشد.")
      .max(balance?.withdrawableBalance ?? 0, "مبلغ از موجودی قابل برداشت بیشتر است."),
  }), [balance?.withdrawableBalance]);
  const form = useForm<RequestForm>({
    resolver: zodResolver(requestSchema),
    defaultValues: { amount: undefined },
  });

  useEffect(() => {
    if (session.loading) return;
    if (!session.authenticated) {
      router.replace(`/login?returnTo=${encodeURIComponent("/account/wallet")}`);
    } else if (!hasAccountWorkspace) {
      router.replace(resolveSessionDestination(session));
    }
  }, [hasAccountWorkspace, router, session]);

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError("");
    try {
      setBalance(await apiRequest<Balance>("/account/wallet?currency=IRR"));
    } catch (error) {
      setBalance(null);
      setBalanceError(errorText(error));
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session.loading || !session.authenticated || !hasAccountWorkspace) return;
    void loadBalance();
  }, [hasAccountWorkspace, loadBalance, refresh, session.authenticated, session.loading]);

  useEffect(() => {
    if (session.loading || !session.authenticated || !hasAccountWorkspace) return;
    let active = true;
    setHistoryLoading(true);
    setHistoryError("");
    void apiRequest<Page<Withdrawal>>(`/account/wallet/withdrawals?page=${page}&pageSize=${pageSize}`)
      .then(result => { if (active) setHistory(result); })
      .catch(error => { if (active) { setHistory(null); setHistoryError(errorText(error)); } })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [hasAccountWorkspace, page, refresh, session.authenticated, session.loading]);

  const openRequest = () => {
    form.reset({ amount: undefined });
    setSubmitError("");
    setDialogOpen(true);
  };

  const submitRequest = form.handleSubmit(async ({ amount }) => {
    if (submittingRef.current || !balance) return;
    submittingRef.current = true;
    setSubmitError("");
    try {
      await apiRequest<Withdrawal>("/account/wallet/withdrawals", {
        method: "POST",
        body: JSON.stringify({ currency: balance.currency, amount }),
      });
      setDialogOpen(false);
      setSupportVisible(true);
      toast.success("درخواست برداشت شما ثبت شد.");
      setPage(1);
      setRefresh(value => value + 1);
    } catch (error) {
      setSubmitError(errorText(error));
      // Availability may have changed since the form opened; the server is authoritative.
      void loadBalance();
    } finally {
      submittingRef.current = false;
    }
  });

  if (session.loading || !session.authenticated || !hasAccountWorkspace) {
    return <div role="status" className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground">در حال آماده‌سازی کیف پول...</div>;
  }

  const money = (amount: number, currency: string) => <>{formatCurrency(amount, { showCurrency: false })} <bdi dir="ltr">{currency}</bdi></>;
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8" dir="rtl">
    <div className="mx-auto grid max-w-6xl gap-5">
      <KoochPageHeader eyebrow="حساب کاربری" title="کیف پول من"
        description="موجودی‌های قابل استفاده و درخواست‌های برداشت خود را پیگیری کنید."
        actions={<Link className="text-sm font-semibold text-primary hover:underline" href="/account">بازگشت به حساب کاربری</Link>} />

      {supportVisible && <KoochAlert variant="success" role="status">
        درخواست برداشت شما ثبت شد. برای تکمیل فرایند و هماهنگی اطلاعات پرداخت، لطفاً با پشتیبانی تماس بگیرید یا تیکت ثبت کنید.
      </KoochAlert>}

      {balanceError && <KoochAlert variant="destructive" role="alert">{balanceError} <KoochButton size="sm" variant="outline" onClick={() => void loadBalance()}>تلاش دوباره</KoochButton></KoochAlert>}
      {balanceLoading && !balance ? <KoochCard role="status" className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری موجودی...</KoochCard> : balance && <section aria-label="خلاصه کیف پول" className="grid gap-4">
        <KoochCard className="grid gap-4 sm:flex sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <h2 className="text-sm font-semibold text-muted-foreground">موجودی قابل استفاده</h2>
            <p className="text-2xl font-bold tabular-nums text-foreground">{money(balance.balance, balance.currency)}</p>
          </div>
          {balance.withdrawableBalance > 0 && <KoochButton disabled={balanceLoading} onClick={openRequest}>درخواست برداشت</KoochButton>}
        </KoochCard>
        <div className="grid gap-4 sm:grid-cols-2">
          <KoochCard className="grid gap-1" padding="sm"><h3 className="text-sm font-semibold text-muted-foreground">قابل برداشت</h3><p className="text-lg font-bold tabular-nums">{money(balance.withdrawableBalance, balance.currency)}</p></KoochCard>
          <KoochCard className="grid gap-1" padding="sm"><h3 className="text-sm font-semibold text-muted-foreground">اعتبار غیرقابل برداشت</h3><p className="text-lg font-bold tabular-nums">{money(balance.nonWithdrawableBalance, balance.currency)}</p></KoochCard>
        </div>
      </section>}

      <section aria-label="تاریخچه درخواست‌های برداشت" className="grid min-w-0 gap-3">
        <h2 className="text-lg font-semibold">درخواست‌های برداشت</h2>
        {historyError && <KoochAlert variant="destructive" role="alert">{historyError} <KoochButton size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>تلاش دوباره</KoochButton></KoochAlert>}
        <KoochTable>
          <KoochTableHeader><KoochTableRow><KoochTableHead>مبلغ</KoochTableHead><KoochTableHead>واحد پول</KoochTableHead><KoochTableHead>وضعیت</KoochTableHead><KoochTableHead>زمان درخواست</KoochTableHead></KoochTableRow></KoochTableHeader>
          <KoochTableBody>
            {historyLoading ? <KoochTableEmpty colSpan={4}>در حال بارگذاری درخواست‌ها...</KoochTableEmpty> : historyError ? <KoochTableEmpty colSpan={4}>تاریخچه در دسترس نیست.</KoochTableEmpty> : !history?.items.length ? <KoochTableEmpty colSpan={4}>هنوز درخواست برداشتی ثبت نکرده‌اید.</KoochTableEmpty> : history.items.map(item =>
              <KoochTableRow key={item.id}><KoochTableCell className="tabular-nums">{formatCurrency(item.amount, { showCurrency: false })}</KoochTableCell><KoochTableCell><bdi dir="ltr">{item.currency}</bdi></KoochTableCell><KoochTableCell><KoochBadge variant="muted">{statusLabels[item.status]}</KoochBadge></KoochTableCell><KoochTableCell><time dateTime={item.requestedAtUtc}>{formatDateTime(item.requestedAtUtc)}</time></KoochTableCell></KoochTableRow>)}
          </KoochTableBody>
        </KoochTable>
        {(history?.totalPages ?? 0) > 1 && <nav aria-label="صفحه‌بندی درخواست‌های برداشت" className="flex flex-wrap items-center justify-end gap-2">
          <KoochButton size="sm" variant="outline" disabled={historyLoading || page <= 1} onClick={() => setPage(value => value - 1)}>قبلی</KoochButton>
          <span className="text-sm text-muted-foreground">صفحه {formatNumber(page)} از {formatNumber(history?.totalPages ?? 0)}</span>
          <KoochButton size="sm" variant="outline" disabled={historyLoading || page >= (history?.totalPages ?? 0)} onClick={() => setPage(value => value + 1)}>بعدی</KoochButton>
        </nav>}
      </section>
    </div>

    <KoochDialog open={dialogOpen} onOpenChange={open => { if (!form.formState.isSubmitting) setDialogOpen(open); }} title="درخواست برداشت" size="sm" closeDisabled={form.formState.isSubmitting}
      footer={<div className="flex justify-end gap-2"><KoochButton variant="outline" disabled={form.formState.isSubmitting} onClick={() => setDialogOpen(false)}>انصراف</KoochButton><KoochButton form="wallet-withdrawal-form" type="submit" loading={form.formState.isSubmitting} disabled={!balance || balanceLoading}>ثبت درخواست</KoochButton></div>}>
      <form id="wallet-withdrawal-form" onSubmit={submitRequest} className="grid gap-4">
        <p className="text-sm text-muted-foreground">موجودی قابل برداشت: <strong className="text-foreground">{balance ? money(balance.withdrawableBalance, balance.currency) : "نامشخص"}</strong></p>
        <KoochField label="مبلغ درخواستی" required error={form.formState.errors.amount?.message}>
          <KoochInput type="number" inputMode="decimal" min="0" step="0.01" {...form.register("amount", { valueAsNumber: true })} />
        </KoochField>
        <p className="text-xs text-muted-foreground">واحد پول: <bdi dir="ltr">{balance?.currency}</bdi></p>
        {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
      </form>
    </KoochDialog>
  </main>;
}
