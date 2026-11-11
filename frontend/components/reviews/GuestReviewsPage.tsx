"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { GuestReviewForm } from "@/components/reviews/GuestReviewForm";
import { ReviewScoreList } from "@/components/reviews/PublishedReviews";
import { getRatingQuality } from "@/lib/rating-quality";
import type { PagedResult } from "@/lib/account-reservations";
import { getEligibleReviewStays, getGuestReviews, reviewDate, reviewError, reviewLinkClass, reviewStatus,
  type EligibleReviewStay, type GuestReviewListItem } from "@/lib/guest-reviews";
import styles from "./GuestReviewsPage.module.css";

function useReviewPage<T>(fetchPage: (page: number, signal?: AbortSignal) => Promise<PagedResult<T>>, page: number, version: number) {
  const [data, setData] = useState<PagedResult<T> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    fetchPage(page, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(reviewError(failure)); });
    return () => controller.abort();
  }, [fetchPage, page, version]);
  return { data, error };
}

function Pagination({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label: string }) {
  if (pages <= 1) return null;
  return <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-3">
    <KoochButton variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>صفحه قبل</KoochButton>
    <span className="text-sm tabular-nums">صفحه {page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}</span>
    <KoochButton variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>صفحه بعد</KoochButton>
  </nav>;
}

function ReviewFailure({ message }: { message: string }) {
  return <div className="mt-3">
    <p role="alert" className="text-sm leading-7 text-destructive">{message}</p>
    {message.includes("نشست") && <Link href="/login?returnTo=%2Faccount%2Freviews" className={reviewLinkClass}>ورود دوباره</Link>}
  </div>;
}

function ReviewsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedPageValue = Number(params.get("eligiblePage") ?? "1");
  const requestedPage = Number.isInteger(requestedPageValue) && requestedPageValue >= 1 && requestedPageValue <= 100000 ? requestedPageValue : 1;
  const [eligiblePage, setEligiblePage] = useState(requestedPage);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<EligibleReviewStay | null>(null);
  const [message, setMessage] = useState("");
  const listHeading = useRef<HTMLHeadingElement>(null);
  const eligible = useReviewPage(getEligibleReviewStays, eligiblePage, version);
  const submitted = useReviewPage(getGuestReviews, reviewsPage, version);
  const requested = params.get("reservationId");
  const handled = useRef<string | null>(null);
  useEffect(() => { if (requested) setEligiblePage(requestedPage); }, [requested, requestedPage]);
  useEffect(() => {
    if (!requested || handled.current === requested || !eligible.data || eligible.data.page !== requestedPage) return;
    handled.current = requested;
    const stay = /^[1-9]\d{0,9}$/.test(requested)
      ? eligible.data.items.find(item => String(item.reservationId) === requested) : undefined;
    if (stay) setSelected(stay);
    else setMessage("اقامت انتخاب‌شده در فهرست مجاز این صفحه نیست. اقامت‌های قابل ثبت نظر را بررسی کنید.");
  }, [requested, requestedPage, eligible.data]);
  function closeForm() {
    setSelected(null); router.replace("/account/reviews", { scroll: false });
    listHeading.current?.focus();
  }
  function refresh() {
    closeForm(); setVersion(value => value + 1);
  }
  return <main dir="rtl" className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
    <div className="mx-auto grid max-w-5xl gap-6">
      <KoochPageHeader eyebrow="محیط مهمان" title="نظرات من" description="اقامت‌های قابل ارزیابی و وضعیت نظرهای ارسال‌شده خود را ببینید." />
      <div className={styles.content}>
      <div className={styles.toolbar}>
        <Link href="/account" className={`${reviewLinkClass} ${styles.backLink}`}>بازگشت به حساب کاربری</Link>
      </div>
      {message && <p className="rounded-lg border border-border bg-muted p-4 text-sm leading-7" role="status">{message}</p>}
      {selected && <GuestReviewForm key={selected.reservationId} stay={selected} onClose={closeForm} onSaved={() => {
        refresh(); setMessage("نظر شما ثبت شد و در انتظار تأیید است؛ هنوز منتشر نشده است.");
      }} />}
      <KoochCard padding="sm" aria-labelledby="eligible-heading">
        <div className={styles.sectionHeader}>
          <h2 id="eligible-heading" ref={listHeading} tabIndex={-1} className="text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">اقامت‌های قابل ثبت نظر</h2>
          <KoochButton variant="ghost" size="icon" className={styles.refresh} onClick={refresh} aria-label="دریافت دوباره فهرست" title="دریافت دوباره فهرست">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7.5a7 7 0 0 1 12-2L20 9M4 15l2.5 3.5a7 7 0 0 0 12-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </KoochButton>
        </div>
        {eligible.error ? <ReviewFailure message={eligible.error} /> : !eligible.data ? <p role="status" className="py-3 text-sm text-muted-foreground">در حال دریافت اقامت‌ها…</p> : <>
          {!eligible.data.items.length && <p className={styles.empty}>اکنون اقامت واجد شرایطی برای ثبت یا ویرایش نظر ندارید. پس از اقامت تکمیل‌شده، تا ۳۰ روز از خروج می‌توانید نظر بدهید.</p>}
          {eligible.data.items.length > 0 && <ul className={styles.stays} aria-label="اقامت‌های قابل ثبت نظر">
            {eligible.data.items.map(stay => <li key={stay.reservationId} className={styles.stayRow}>
              <div className={styles.stayInfo}><h3>{stay.propertyName}</h3><p className={styles.stayMeta}>خروج: <time dateTime={stay.checkOutDate}>{reviewDate(stay.checkOutDate)}</time> · مهلت: {reviewDate(stay.submissionDeadlineLocalDate)}</p>
                {stay.reservationNumber && <p className={styles.stayMeta}>رزرو: <bdi dir="ltr">{stay.reservationNumber}</bdi></p>}
              </div>
              <KoochButton variant="primary" size="sm" onClick={() => { setSelected(stay); setMessage(""); }} aria-label={`${stay.reviewId === null ? "ثبت نظر" : "ویرایش نظر"} برای ${stay.propertyName}${stay.reservationNumber ? `، رزرو ${stay.reservationNumber}` : `، خروج ${reviewDate(stay.checkOutDate)}`}`}>{stay.reviewId === null ? "ثبت نظر" : "ویرایش نظر"}</KoochButton>
            </li>)}
          </ul>}
          <Pagination label="صفحه‌بندی اقامت‌های قابل ثبت نظر" page={eligiblePage} pages={eligible.data.totalPages} onChange={setEligiblePage} />
        </>}
      </KoochCard>
      <KoochCard padding="sm" aria-labelledby="submitted-heading">
        <h2 id="submitted-heading" className="text-base font-bold">نظرهای ارسال‌شده</h2>
        {submitted.error ? <ReviewFailure message={submitted.error} /> : !submitted.data ? <p role="status" className="py-3 text-sm text-muted-foreground">در حال دریافت نظرها…</p> : <>
          {!submitted.data.items.length && <p className={styles.empty}>هنوز نظری برای اقامت‌های تأییدشده ثبت نکرده‌اید.</p>}
          {submitted.data.items.length > 0 && <ul className={styles.submittedList} aria-label="نظرهای ارسال‌شده">
            {submitted.data.items.map(item => <li key={item.review.id} className={styles.submittedItem}>
              <article aria-labelledby={`submitted-review-${item.review.id}`} className={styles.submittedCard}>
              <header className={styles.reviewHeader}>
                <div className={styles.reviewIdentity}><h3 id={`submitted-review-${item.review.id}`}>{item.propertyName}</h3>
                  {(item.checkInDate || item.checkOutDate) && <p className={styles.stayMeta}>
                    {item.checkInDate && <>ورود: <time dateTime={item.checkInDate}>{reviewDate(item.checkInDate)}</time></>}
                    {item.checkInDate && item.checkOutDate && " · "}
                    {item.checkOutDate && <>خروج: <time dateTime={item.checkOutDate}>{reviewDate(item.checkOutDate)}</time></>}
                  </p>}
                </div>
                <span className={styles.reviewStatus}>{reviewStatus(item.review)}</span>
              </header>
              <div className={styles.ratingRow}>
                <div className={styles.overall} data-quality={getRatingQuality(item.review.overallRating).tone}>
                  <div className={styles.overallValue}><strong className={styles.scoreBadge}><span className="sr-only">امتیاز کلی: </span>{item.review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span className={styles.scale}>از ۱۰</span></div>
                  <p className={styles.scoreQuality}>{getRatingQuality(item.review.overallRating).label}</p>
                </div>
                <ReviewScoreList scores={item.review} appearance="brand" />
              </div>
              <div className={styles.comment}><p className={styles.commentLabel}>متن نظر</p><p>{item.review.comment || "بدون توضیح"}</p></div>
              {item.review.moderationStatus === "Rejected" && item.review.rejectionReason && <p className={styles.rejection}>دلیل رد نظر: {item.review.rejectionReason}</p>}
              <footer className={styles.reviewActions}>
                {item.canEdit ? <KoochButton variant="outline" size="sm" onClick={() => { setMessage(""); setSelected({
                  reservationId: item.review.reservationId, reservationNumber: item.reservationNumber,
                  propertyId: item.review.propertyId, propertyName: item.propertyName, checkOutDate: item.checkOutDate,
                  submissionDeadlineLocalDate: item.submissionDeadlineLocalDate, reviewId: item.review.id, revision: item.review.revision,
                }); }}>{item.review.moderationStatus === "Rejected" ? "ویرایش و ارسال مجدد" : "ویرایش نظر"}</KoochButton> : <p className="text-sm text-muted-foreground">این نظر اکنون قابل ویرایش نیست.</p>}
                {item.reservationNumber && <Link className={`${reviewLinkClass} ${styles.reservationLink}`} href={`/account/reservations/${encodeURIComponent(item.reservationNumber)}`}>مشاهده رزرو</Link>}
              </footer>
              </article>
            </li>)}
          </ul>}
          <Pagination label="صفحه‌بندی نظرهای ارسال‌شده" page={reviewsPage} pages={submitted.data.totalPages} onChange={setReviewsPage} />
        </>}
      </KoochCard>
      </div>
    </div>
  </main>;
}

export function GuestReviewsPage() {
  const session = useAuthSession();
  const router = useRouter();
  const allowed = session.authenticated && session.workspaces.includes("account");
  useEffect(() => {
    if (session.loading) return;
    if (!session.authenticated) router.replace("/login?returnTo=%2Faccount%2Freviews");
    else if (!allowed) router.replace(resolveSessionDestination(session));
  }, [allowed, router, session]);
  if (session.loading || !allowed) return <p role="status" className="p-6 text-center text-sm text-muted-foreground">در حال آماده‌سازی حساب کاربری…</p>;
  return <ReviewsContent key={session.user?.userId} />;
}
