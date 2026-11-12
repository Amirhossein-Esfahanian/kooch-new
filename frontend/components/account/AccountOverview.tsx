"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochCard } from "@/components/KoochCard";
import { AccountSkeleton } from "./AccountSkeleton";
import { formatDate, formatDateTime, formatNumber, statusLabels, statusVariant, isPaymentEligible, type AccountReservation, type PagedResult } from "@/lib/account-reservations";
import { formatLocalIsoDate, parseLocalIsoDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/currency";
import { getEligibleReviewStays } from "@/lib/guest-reviews";
import { apiRequest } from "@/lib/owner-api";
import styles from "./AccountOverview.module.css";

type Upcoming = { count: number; next: AccountReservation | null };
type Wallet = { balance: number; currency: string };
type Resource<T> = { status: "loading"; data: null } | { status: "error"; data: null } | { status: "ready"; data: T };
const validCount = (count: number) => Number.isSafeInteger(count) && count >= 0;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && formatLocalIsoDate(parseLocalIsoDate(date)) === date;
const stayHref = (stay: AccountReservation) => `/account/reservations/${encodeURIComponent(stay.reservationNumber)}`;
const stayDate = (date: string) => formatDate(`${date}T12:00:00`);

async function loadUpcoming(signal: AbortSignal): Promise<Upcoming> {
  const today = formatLocalIsoDate(new Date());
  // These disjoint status queries return authoritative totals and the nearest owned
  // reservation rows, including those linked to sessions, without joining order data.
  const pages = await Promise.all(["Confirmed", "Paid"].map(async status => {
    const query = new URLSearchParams({ status, checkInFrom: today, sort: "checkinasc", page: "1", pageSize: "1" });
    const page = await apiRequest<PagedResult<AccountReservation>>(`/account/reservations?${query}`, { signal, cache: "no-store" });
    if (!page || !validCount(page.totalCount) || !Array.isArray(page.items) || (page.totalCount > 0 && !page.items.length)
      || page.items.some(stay => stay.status !== status || !stay.reservationNumber || !validDate(stay.checkInDate)
        || !validDate(stay.checkOutDate) || stay.checkInDate < today || stay.checkOutDate <= stay.checkInDate)) throw new Error("Invalid stay summary");
    return page;
  }));
  const candidates = pages.flatMap(page => page.items).sort((a, b) => a.checkInDate.localeCompare(b.checkInDate) || a.reservationId - b.reservationId);
  return { count: pages.reduce((count, page) => count + page.totalCount, 0), next: candidates[0] ?? null };
}
async function loadReviews(signal: AbortSignal) {
  const page = await getEligibleReviewStays(1, signal);
  if (!page || !validCount(page.totalCount) || !Array.isArray(page.items)) throw new Error("Invalid review summary");
  return page;
}
async function loadWallet(signal: AbortSignal) {
  const wallet = await apiRequest<Wallet>("/account/wallet?currency=IRR", { signal, cache: "no-store" });
  if (!wallet || !Number.isFinite(wallet.balance) || !wallet.currency?.trim()) throw new Error("Invalid wallet summary");
  return wallet;
}
async function loadUnpaid(signal: AbortSignal) {
  const now = new Date();
  const query = new URLSearchParams({ status: "ApprovedAwaitingPayment", checkInFrom: formatLocalIsoDate(now),
    paymentDeadlineFrom: now.toISOString(), sort: "checkinasc", page: "1", pageSize: "3" });
  const page = await apiRequest<PagedResult<AccountReservation>>(`/account/reservations?${query}`, { signal, cache: "no-store" });
  if (!page || !Array.isArray(page.items)) throw new Error("Invalid payment summary");
  return page.items.filter(stay => stay.status === "ApprovedAwaitingPayment" && stay.reservationNumber && isPaymentEligible(stay)
    && stay.paymentExpiresAtUtc && Date.parse(stay.paymentExpiresAtUtc) > now.getTime());
}
function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<Resource<T>>({ status: "loading", data: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", data: null });
    load(controller.signal).then(data => { if (!controller.signal.aborted) setState({ status: "ready", data }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", data: null }); });
    return () => controller.abort();
  }, [load, version]);
  return { ...state, retry: () => setVersion(value => value + 1) };
}
function Unavailable({ retry }: { retry: () => void }) {
  return <div className={styles.unavailable}><p role="alert">دریافت این بخش انجام نشد؛ اطلاعات در دسترس نیست.</p><KoochButton type="button" variant="ghost" size="sm" onClick={retry}>تلاش دوباره</KoochButton></div>;
}
function Loading({ label }: { label: string }) {
  return <div className={styles.loading} role="status" aria-busy="true"><span className="sr-only">{label}</span><AccountSkeleton variant="block" /></div>;
}
export function AccountOverview({ displayName }: { displayName: string }) {
  const upcoming = useResource(loadUpcoming);
  const reviews = useResource(loadReviews);
  const wallet = useResource(loadWallet);
  const unpaid = useResource(loadUnpaid);
  const reviewActions = reviews.data?.items.filter((stay, index, items) => stay.reviewId === null
    && items.findIndex(other => other.reservationId === stay.reservationId) === index).slice(0, 3) ?? [];
  const paymentActions = unpaid.data?.filter((stay, index, items) => items.findIndex(other => other.reservationId === stay.reservationId) === index) ?? [];
  return <main className={styles.overview} dir="rtl" aria-label="حساب کاربری">
    <header className={styles.welcome}>
      <div><h1>{displayName ? `سلام، ${displayName}` : "خوش آمدید"}</h1><p>اقامت بعدی و کارهای باقی‌ماندهٔ سفرتان، در یک نگاه.</p></div>
      <Image className={styles.welcomeIcon} src="/svgs/account/dashboard.svg" alt="" width={32} height={32} />
    </header>
    <KoochCard className={styles.nextStay} aria-labelledby="next-stay-title">
      <div className={styles.sectionHeading}><h2 id="next-stay-title">اقامت بعدی شما</h2><Link className={styles.textLink} href="/account/reservations">همه رزروها</Link></div>
      {upcoming.status === "loading" ? <Loading label="در حال دریافت اقامت بعدی…" /> : upcoming.status === "error" ? <Unavailable retry={upcoming.retry} />
        : upcoming.data.next ? <div className={styles.stayContent}>
          <div className={styles.stayIdentity}><h3>{upcoming.data.next.propertyName}</h3><p>{upcoming.data.next.roomName || upcoming.data.next.roomTypeName}</p><KoochBadge variant={statusVariant(upcoming.data.next.status)}>{statusLabels[upcoming.data.next.status]}</KoochBadge></div>
          <dl className={styles.dates}><div><dt>ورود</dt><dd><time dateTime={upcoming.data.next.checkInDate}>{stayDate(upcoming.data.next.checkInDate)}</time></dd></div><div><dt>خروج</dt><dd><time dateTime={upcoming.data.next.checkOutDate}>{stayDate(upcoming.data.next.checkOutDate)}</time></dd></div></dl>
          <Link className={styles.primaryLink} href={stayHref(upcoming.data.next)}>مشاهده جزئیات اقامت</Link>
        </div> : <div className={styles.empty}><h3>سفر بعدی‌تان از همین‌جا شروع می‌شود</h3><p>اقامت قطعیِ پیش رویی ثبت نشده است. رزروهای در انتظار بررسی یا پرداخت را در «رزروهای من» ببینید.</p><Link className={styles.primaryLink} href="/properties">جستجوی اقامتگاه</Link></div>}
    </KoochCard>
    <section className={styles.summary} aria-label="خلاصه حساب">
      <KoochCard className={styles.metric} padding="sm"><div className={styles.metricHeading}><Image className={styles.icon} src="/svgs/account/reservations.svg" alt="" width={24} height={24} /><h2><Link href="/account/reservations" aria-label="مشاهده رزروهای من">رزروهای قطعی پیش رو</Link></h2></div>
        {upcoming.status === "loading" ? <Loading label="در حال دریافت تعداد اقامت‌ها…" /> : upcoming.status === "error" ? <p className={styles.muted}>در دسترس نیست</p> : <strong className={styles.metricValue}>{formatNumber(upcoming.data.count)}</strong>}</KoochCard>
      <KoochCard className={styles.metric} padding="sm"><div className={styles.metricHeading}><Image className={styles.icon} src="/svgs/account/reviews.svg" alt="" width={24} height={24} /><h2><Link href="/account/reviews" aria-label="مشاهده نظرات من">اقامت‌های قابل ثبت یا ویرایش نظر</Link></h2></div>
        {reviews.status === "loading" ? <Loading label="در حال دریافت تعداد نظرها…" /> : reviews.status === "error" ? <p className={styles.muted}>در دسترس نیست</p> : <strong className={styles.metricValue}>{formatNumber(reviews.data.totalCount)}</strong>}</KoochCard>
      <KoochCard className={styles.metric} padding="sm"><div className={styles.metricHeading}><Image className={styles.icon} src="/svgs/account/wallet.svg" alt="" width={24} height={24} /><h2><Link href="/account/wallet" aria-label="مشاهده کیف پول">موجودی کیف پول</Link></h2></div>
        {wallet.status === "loading" ? <Loading label="در حال دریافت موجودی…" /> : wallet.status === "error" ? <Unavailable retry={wallet.retry} /> : <p className={styles.walletValue}><strong>{formatCurrency(wallet.data.balance, { showCurrency: false })}</strong> <bdi dir="ltr">{wallet.data.currency}</bdi></p>}</KoochCard>
    </section>
    <KoochCard className={styles.attention} aria-labelledby="account-attention-title">
      <div className={styles.sectionHeading}><h2 id="account-attention-title">کارهای پیش رو</h2><span className={styles.muted}>پرداخت و تجربهٔ اقامت</span></div>
      {unpaid.status === "loading" ? <Loading label="در حال بررسی پرداخت‌ها…" /> : unpaid.status === "error" ? <Unavailable retry={unpaid.retry} /> : paymentActions.map(stay => <div key={`payment-${stay.reservationId}`} className={styles.actionRow}><div><h3>بررسی پرداخت {stay.propertyName}</h3><p>رزرو <bdi dir="ltr">{stay.reservationNumber}</bdi> · مهلت پرداخت: {formatDateTime(stay.paymentExpiresAtUtc)}</p></div><Link className={styles.textLink} href={stayHref(stay)}>بررسی و پرداخت رزرو</Link></div>)}
      {reviews.status === "loading" ? <Loading label="در حال بررسی نظرهای قابل ثبت…" /> : reviews.status === "error" ? <Unavailable retry={reviews.retry} /> : reviewActions.map(stay => <div key={`review-${stay.reservationId}`} className={styles.actionRow}><div><h3>تجربهٔ اقامت در {stay.propertyName}</h3><p>خروج: {stayDate(stay.checkOutDate)}{stay.reservationNumber && <> · رزرو <bdi dir="ltr">{stay.reservationNumber}</bdi></>}</p></div><Link className={styles.textLink} href={`/account/reviews?reservationId=${stay.reservationId}`}>ثبت نظر</Link></div>)}
      {reviews.status === "ready" && unpaid.status === "ready" && !reviewActions.length && !paymentActions.length && <p className={styles.muted}>در موارد بررسی‌شده، پرداخت باز یا نظر تازه‌ای برای ثبت ندارید.</p>}
      <div className={styles.attentionLinks}><Link className={styles.textLink} href="/account/reservations">بررسی همه رزروها</Link><Link className={styles.textLink} href="/account/reviews">همه نظرها و اقامت‌های قابل ارزیابی</Link></div>
    </KoochCard>
  </main>;
}
