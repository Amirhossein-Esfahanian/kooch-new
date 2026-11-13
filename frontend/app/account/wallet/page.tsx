"use client";

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
import { KoochTable, KoochTableBody, KoochTableCell, KoochTableHead, KoochTableHeader, KoochTableRow } from "@/components/KoochTable";
import { AccountSkeleton } from "@/components/account/AccountSkeleton";
import { formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { apiRequest } from "@/lib/owner-api";
import styles from "./page.module.css";

type Balance = { currency: string; balance: number; withdrawableBalance: number; nonWithdrawableBalance: number };
type WithdrawalStatus = "Pending" | "Approved" | "Paid" | "Rejected" | "Cancelled";
type Withdrawal = { id: number; currency: string; amount: number; status: WithdrawalStatus; requestedAtUtc: string };
type WalletTransaction = { id: number; amount: number; direction: "Credit" | "Debit"; currency: string; createdAtUtc: string };
type Page<T> = { items: T[]; totalCount: number; page: number; pageSize: number; totalPages: number };
type RequestForm = { amount: number };
const pageSize = 10;
const transactionPageSize = 20;
const statusLabels: Record<WithdrawalStatus, string> = {
  Pending: "در انتظار بررسی",
  Approved: "تأییدشده؛ در انتظار پرداخت",
  Paid: "پرداخت‌شده",
  Rejected: "ردشده",
  Cancelled: "لغوشده",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "درخواست انجام نشد؛ دوباره تلاش کنید.";
const currencyLabel = (currency: string) => currency === "IRR" ? "ریال" : currency;

function WalletSkeleton({ kind }: { kind: "balance" | "transactions" | "withdrawals" }) {
  const label = kind === "balance" ? "در حال بارگذاری موجودی..." : kind === "transactions" ? "در حال بارگذاری تراکنش‌ها..." : "در حال بارگذاری درخواست‌ها...";
  return <div className={styles.skeleton} role="status" aria-busy="true">
    <span className="sr-only">{label}</span>
    {kind === "balance" ? <div className={styles.balanceCard} aria-hidden="true">
      <div className={styles.primaryBalance}><div className={styles.skeletonGroup}><AccountSkeleton className={styles.skeletonLabel} /><AccountSkeleton className={styles.skeletonAmount} /></div></div>
      <div className={styles.secondaryBalances}>{[0, 1].map(index => <div className={styles.skeletonGroup} key={index}><AccountSkeleton className={styles.skeletonLabel} /><AccountSkeleton className={styles.skeletonValue} /></div>)}</div>
    </div> : <div className={styles.skeletonRows} aria-hidden="true">
      {[0, 1, 2].map(index => <div className={kind === "transactions" ? styles.transactionSkeletonRow : styles.withdrawalSkeletonRow} key={index}>
        {Array.from({ length: kind === "transactions" ? 3 : 4 }, (_, field) => <AccountSkeleton key={field} />)}
      </div>)}
    </div>}
  </div>;
}

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
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [transactionPage, setTransactionPage] = useState(0);
  const [transactionTotalPages, setTransactionTotalPages] = useState(0);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [moreTransactionsLoading, setMoreTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const [transactionRefresh, setTransactionRefresh] = useState(0);
  const transactionRequestEpoch = useRef(0);
  const loadingMoreRef = useRef<number | null>(null);
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

  useEffect(() => {
    if (session.loading || !session.authenticated || !hasAccountWorkspace || !balance?.currency) return;
    const epoch = ++transactionRequestEpoch.current;
    loadingMoreRef.current = null;
    setMoreTransactionsLoading(false);
    setTransactions([]);
    setTransactionPage(0);
    setTransactionTotalPages(0);
    setTransactionsLoading(true);
    setTransactionsError("");
    void apiRequest<Page<WalletTransaction>>(`/account/wallet/transactions?currency=${encodeURIComponent(balance.currency)}&page=1&pageSize=${transactionPageSize}`)
      .then(result => {
        if (epoch !== transactionRequestEpoch.current) return;
        setTransactions(result.items);
        setTransactionPage(result.page);
        setTransactionTotalPages(result.totalPages);
      })
      .catch(error => {
        if (epoch === transactionRequestEpoch.current) setTransactionsError(errorText(error));
      })
      .finally(() => {
        if (epoch === transactionRequestEpoch.current) setTransactionsLoading(false);
      });
    return () => { transactionRequestEpoch.current += 1; };
  }, [balance?.currency, hasAccountWorkspace, session.authenticated, session.loading, transactionRefresh]);

  const loadMoreTransactions = async () => {
    if (loadingMoreRef.current !== null || transactionsLoading || !balance?.currency || transactionPage >= transactionTotalPages) return;
    const epoch = transactionRequestEpoch.current;
    loadingMoreRef.current = epoch;
    const nextPage = transactionPage + 1;
    setMoreTransactionsLoading(true);
    setTransactionsError("");
    try {
      const result = await apiRequest<Page<WalletTransaction>>(`/account/wallet/transactions?currency=${encodeURIComponent(balance.currency)}&page=${nextPage}&pageSize=${transactionPageSize}`);
      if (epoch !== transactionRequestEpoch.current) return;
      setTransactions(current => {
        const existingIds = new Set(current.map(item => item.id));
        return [...current, ...result.items.filter(item => !existingIds.has(item.id))];
      });
      setTransactionPage(result.page);
      setTransactionTotalPages(result.totalPages);
    } catch (error) {
      if (epoch === transactionRequestEpoch.current) setTransactionsError(errorText(error));
    } finally {
      if (loadingMoreRef.current === epoch) {
        loadingMoreRef.current = null;
        setMoreTransactionsLoading(false);
      }
    }
  };

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

  const money = (amount: number, currency: string) => <>{formatCurrency(amount, { showCurrency: false })} <bdi dir={currency === "IRR" ? "rtl" : "ltr"}>{currencyLabel(currency)}</bdi></>;
  return <main className={styles.page} dir="rtl">
      <header className={styles.header}><h1>کیف پول من</h1>
        <p>موجودی‌های قابل استفاده و درخواست‌های برداشت خود را پیگیری کنید.</p>
      </header>

      {supportVisible && <KoochAlert variant="success" role="status">
        درخواست برداشت شما ثبت شد. برای تکمیل فرایند و هماهنگی اطلاعات پرداخت، لطفاً با پشتیبانی تماس بگیرید یا تیکت ثبت کنید.
      </KoochAlert>}

      {balanceError && <KoochAlert variant="destructive" role="alert">{balanceError} <KoochButton size="sm" variant="outline" onClick={() => void loadBalance()}>تلاش دوباره</KoochButton></KoochAlert>}
      {balanceLoading && !balance ? <WalletSkeleton kind="balance" /> : balance && <KoochCard aria-label="خلاصه کیف پول" className={styles.balanceCard}>
        <div className={styles.primaryBalance}>
          <div>
            <h2>موجودی قابل استفاده</h2>
            <p className={styles.mainAmount}>{money(balance.balance, balance.currency)}</p>
          </div>
          {balance.withdrawableBalance > 0 && <KoochButton disabled={balanceLoading} onClick={openRequest}>درخواست برداشت</KoochButton>}
        </div>
        <div className={styles.secondaryBalances}>
          <div><h3>قابل برداشت</h3><p>{money(balance.withdrawableBalance, balance.currency)}</p></div>
          <div><h3>اعتبار غیرقابل برداشت</h3><p>{money(balance.nonWithdrawableBalance, balance.currency)}</p></div>
        </div>
      </KoochCard>}

      <section aria-label="تراکنش‌های کیف پول" className={styles.section}>
        <h2>تراکنش‌های کیف پول</h2>
        {transactionsError && <KoochAlert variant="destructive" role="alert">
          {transactionsError}{" "}
          {!transactionPage && <KoochButton size="sm" variant="outline" onClick={() => setTransactionRefresh(value => value + 1)}>تلاش دوباره</KoochButton>}
        </KoochAlert>}
        {!balance && balanceError ? <p className={styles.unavailable}>برای نمایش تراکنش‌ها، دریافت موجودی را دوباره امتحان کنید.</p>
          : transactionsLoading ? <WalletSkeleton kind="transactions" />
          : !transactionPage && transactionsError ? <p className={styles.unavailable}>تراکنش‌ها در دسترس نیستند.</p>
          : !transactions.length ? <div className={styles.empty}><p>هنوز تراکنشی در کیف پول شما ثبت نشده است.</p><p>افزایش و کاهش موجودی پس از ثبت در این بخش نمایش داده می‌شود.</p></div>
          : <KoochTable className="!min-w-0">
          <KoochTableHeader><KoochTableRow><KoochTableHead>نوع</KoochTableHead><KoochTableHead>مبلغ</KoochTableHead><KoochTableHead>زمان</KoochTableHead></KoochTableRow></KoochTableHeader>
          <KoochTableBody>
            {transactions.map(item => <KoochTableRow key={item.id}>
                <KoochTableCell><KoochBadge variant={item.direction === "Credit" ? "success" : "destructive"}>{item.direction === "Credit" ? "افزایش موجودی" : "کاهش موجودی"}</KoochBadge></KoochTableCell>
                <KoochTableCell className="tabular-nums">{money(item.amount, item.currency)}</KoochTableCell>
                <KoochTableCell><time dateTime={item.createdAtUtc}>{formatDateTime(item.createdAtUtc)}</time></KoochTableCell>
              </KoochTableRow>)}
          </KoochTableBody>
        </KoochTable>}
        {transactionPage > 0 && transactionPage < transactionTotalPages && <div className="flex justify-center">
          <KoochButton size="sm" variant="outline" loading={moreTransactionsLoading} disabled={moreTransactionsLoading} onClick={() => void loadMoreTransactions()}>نمایش بیشتر</KoochButton>
        </div>}
      </section>

      <section aria-label="تاریخچه درخواست‌های برداشت" className={styles.section}>
        <h2>درخواست‌های برداشت</h2>
        {historyError && <KoochAlert variant="destructive" role="alert">{historyError} <KoochButton size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>تلاش دوباره</KoochButton></KoochAlert>}
        {historyLoading ? <WalletSkeleton kind="withdrawals" /> : historyError ? <p className={styles.unavailable}>تاریخچه در دسترس نیست.</p>
          : !history?.items.length ? <div className={styles.empty}><p>هنوز درخواست برداشتی ثبت نکرده‌اید.</p><p>وضعیت درخواست‌های برداشت شما در این بخش نمایش داده می‌شود.</p></div>
          : <KoochTable className="!min-w-0">
          <KoochTableHeader><KoochTableRow><KoochTableHead>مبلغ</KoochTableHead><KoochTableHead>واحد پول</KoochTableHead><KoochTableHead>وضعیت</KoochTableHead><KoochTableHead>زمان درخواست</KoochTableHead></KoochTableRow></KoochTableHeader>
          <KoochTableBody>
            {history.items.map(item =>
              <KoochTableRow key={item.id}><KoochTableCell className="tabular-nums">{formatCurrency(item.amount, { showCurrency: false })}</KoochTableCell><KoochTableCell><bdi dir={item.currency === "IRR" ? "rtl" : "ltr"}>{currencyLabel(item.currency)}</bdi></KoochTableCell><KoochTableCell><KoochBadge variant="muted">{statusLabels[item.status]}</KoochBadge></KoochTableCell><KoochTableCell><time dateTime={item.requestedAtUtc}>{formatDateTime(item.requestedAtUtc)}</time></KoochTableCell></KoochTableRow>)}
          </KoochTableBody>
        </KoochTable>}
        {(history?.totalPages ?? 0) > 1 && <nav aria-label="صفحه‌بندی درخواست‌های برداشت" className="flex flex-wrap items-center justify-end gap-2">
          <KoochButton size="sm" variant="outline" disabled={historyLoading || page <= 1} onClick={() => setPage(value => value - 1)}>قبلی</KoochButton>
          <span className="text-sm text-muted-foreground">صفحه {formatNumber(page)} از {formatNumber(history?.totalPages ?? 0)}</span>
          <KoochButton size="sm" variant="outline" disabled={historyLoading || page >= (history?.totalPages ?? 0)} onClick={() => setPage(value => value + 1)}>بعدی</KoochButton>
        </nav>}
      </section>

    <KoochDialog open={dialogOpen} onOpenChange={open => { if (!form.formState.isSubmitting) setDialogOpen(open); }} title="درخواست برداشت" size="sm" closeDisabled={form.formState.isSubmitting}
      footer={<div className="flex justify-end gap-2"><KoochButton variant="outline" disabled={form.formState.isSubmitting} onClick={() => setDialogOpen(false)}>انصراف</KoochButton><KoochButton form="wallet-withdrawal-form" type="submit" loading={form.formState.isSubmitting} disabled={!balance || balanceLoading}>ثبت درخواست</KoochButton></div>}>
      <form id="wallet-withdrawal-form" onSubmit={submitRequest} className="grid gap-4">
        <p className="text-sm text-muted-foreground">موجودی قابل برداشت: <strong className="text-foreground">{balance ? money(balance.withdrawableBalance, balance.currency) : "نامشخص"}</strong></p>
        <KoochField label="مبلغ درخواستی" required error={form.formState.errors.amount?.message}>
          <KoochInput type="number" inputMode="decimal" min="0" step="0.01" {...form.register("amount", { valueAsNumber: true })} />
        </KoochField>
        <p className="text-xs text-muted-foreground">واحد پول: <bdi dir={balance?.currency === "IRR" ? "rtl" : "ltr"}>{balance ? currencyLabel(balance.currency) : ""}</bdi></p>
        {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
      </form>
    </KoochDialog>
  </main>;
}
