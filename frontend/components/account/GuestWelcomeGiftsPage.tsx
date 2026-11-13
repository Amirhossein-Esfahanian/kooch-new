"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochBadge } from "@/components/KoochBadge";
import { AccountSkeleton } from "./AccountSkeleton";
import { ApiRequestError } from "@/lib/owner-api";
import { getWelcomeGifts, type WelcomeGift } from "@/lib/account-welcome-gifts";
import { formatDateTime, formatNumber, type PagedResult } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import styles from "./GuestWelcomeGiftsPage.module.css";

type HistoryState = { status: "loading" } | { status: "error"; unauthorized: boolean; unavailable: boolean }
  | { status: "ready"; data: PagedResult<WelcomeGift> };

function GiftHistorySkeleton() {
  return <div className={styles.list} role="status" aria-busy="true">
    <span className="sr-only">در حال دریافت تاریخچهٔ هدایا…</span>
    {[0, 1, 2].map(index => <div className={styles.skeletonCard} key={index} aria-hidden="true">
      <AccountSkeleton className={styles.skeletonTitle} />
      <div className={styles.details}>{[0, 1, 2].map(field => <div key={field}><AccountSkeleton /><AccountSkeleton className={styles.skeletonValue} /></div>)}</div>
    </div>)}
  </div>;
}

function GiftHistory() {
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getWelcomeGifts(page, controller.signal).then(data => {
      if (!controller.signal.aborted) { setNow(Date.now()); setState({ status: "ready", data }); }
    }).catch(error => {
      if (!controller.signal.aborted) setState({ status: "error", unauthorized: error instanceof ApiRequestError && error.status === 401,
        unavailable: error instanceof ApiRequestError && [404, 503].includes(error.status) });
    });
    return () => controller.abort();
  }, [page, version]);
  // Update only the expiry label when time passes; no additional API request.
  useEffect(() => {
    if (state.status !== "ready") return;
    const nextExpiry = Math.min(...state.data.items.map(gift => Date.parse(gift.expiresAtUtc)).filter(expiry => expiry > now));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextExpiry - now, 86400000));
    return () => window.clearTimeout(timer);
  }, [state, now]);

  if (state.status === "loading") return <GiftHistorySkeleton />;
  if (state.status === "error") return <KoochCard className={styles.stateCard}>
    <p role="alert">{state.unauthorized ? "نشست شما منقضی شده است. دوباره وارد شوید." : state.unavailable
      ? "سرویس تاریخچهٔ هدایا اکنون در دسترس نیست. لطفاً دوباره تلاش کنید." : "دریافت تاریخچهٔ هدایا انجام نشد. لطفاً دوباره تلاش کنید."}</p>
    <div className={styles.actions}>
      <KoochButton type="button" variant="outline" onClick={() => setVersion(value => value + 1)}>تلاش دوباره</KoochButton>
      {state.unauthorized && <Link className={styles.loginLink} href="/login?returnTo=%2Faccount%2Fwelcome-gifts">ورود دوباره</Link>}
    </div>
  </KoochCard>;
  return <>
    {state.data.items.length === 0 ? <KoochCard className={styles.stateCard}>
      <h2>{state.data.totalCount === 0 ? "هنوز هدیه‌ای برای شما ثبت نشده است" : "در این صفحه هدیه‌ای وجود ندارد"}</h2>
      <p>هدیه‌های اعطاشده به حساب شما، حتی پس از انقضا، در این تاریخچه نمایش داده می‌شوند.</p>
    </KoochCard> : <ul className={styles.list} aria-label="تاریخچهٔ هدایا">
      {state.data.items.map((gift, index) => <li key={`${page}-${index}`}>
        <KoochCard className={styles.giftCard} aria-labelledby={`gift-${page}-${index}`}>
          <div className={styles.cardHeader}><h2 id={`gift-${page}-${index}`}>{gift.title}</h2>
            {Date.parse(gift.expiresAtUtc) <= now && <KoochBadge variant="muted">منقضی‌شده</KoochBadge>}
          </div>
          <dl className={styles.details}>
            <div><dt>مبلغ اولیه هدیه</dt><dd className={styles.amount}>{formatCurrency(gift.grantedAmount, { showCurrency: false })} <bdi dir="ltr">{gift.currency}</bdi></dd></div>
            <div><dt>تاریخ اعطا</dt><dd><time dateTime={gift.grantedAtUtc}>{formatDateTime(gift.grantedAtUtc)}</time></dd></div>
            <div><dt>تاریخ انقضا</dt><dd><time dateTime={gift.expiresAtUtc}>{formatDateTime(gift.expiresAtUtc)}</time></dd></div>
          </dl>
        </KoochCard>
      </li>)}
    </ul>}
    {state.data.totalPages > 1 && <nav className={styles.pagination} aria-label="صفحه‌بندی هدایا">
      <span>صفحه {formatNumber(page)} از {formatNumber(state.data.totalPages)}</span>
      <div className={styles.actions}>
        <KoochButton type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>قبلی</KoochButton>
        <KoochButton type="button" size="sm" variant="outline" disabled={page >= state.data.totalPages} onClick={() => setPage(value => value + 1)}>بعدی</KoochButton>
      </div>
    </nav>}
  </>;
}

export function GuestWelcomeGiftsPage() {
  const session = useAuthSession();
  const router = useRouter();
  const allowed = session.authenticated && session.workspaces.includes("account");
  useEffect(() => {
    if (session.loading) return;
    if (!session.authenticated) router.replace("/login?returnTo=%2Faccount%2Fwelcome-gifts");
    else if (!allowed) router.replace(resolveSessionDestination(session));
  }, [session, allowed, router]);
  return <main className={styles.page} dir="rtl">
    <header className={styles.header}><h1>هدایای من</h1>
      <p>تاریخچهٔ هدیه‌های اعطاشده؛ مبلغ اولیه، موجودی باقی‌مانده یا تأیید قابلیت استفاده در رزرو نیست.</p>
    </header>
    {session.loading || !allowed ? <GiftHistorySkeleton /> : <GiftHistory key={session.user?.userId ?? "account"} />}
  </main>;
}
