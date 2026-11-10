"use client";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { reviewCategories, type ReviewScoreKey } from "@/lib/guest-reviews";
import { formatDateTime } from "@/lib/account-reservations";
import type { PublicGuestReview, PublicReviewPage } from "@/lib/property-reviews";
import styles from "./PublishedReviews.module.css";

export function ReviewScoreList({ scores }: { scores: Partial<Record<ReviewScoreKey, number | null>> }) {
  return <dl className={styles.scores}>
    {reviewCategories.map(([key, label]) => {
      const value = scores[key];
      return <div className={styles.category} key={key}><dt>{label}</dt><dd>
        <span className={styles.categoryValue}>{value?.toLocaleString("fa-IR", { maximumFractionDigits: 1 }) ?? "—"}{value != null && <span> /۱۰</span>}</span>
        {value != null && <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={10} aria-valuenow={value} aria-valuetext={`${value.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} از ۱۰`} className={styles.track}>
          <span aria-hidden="true" style={{ width: `${value * 10}%` }} />
        </div>}
      </dd></div>;
    })}
  </dl>;
}
export function PublishedRating({ summary, variant = "compact" }: { summary: PublicReviewPage["summary"] | null; variant?: "compact" | "summary" }) {
  if (!summary) return <p role="status">در حال دریافت امتیاز…</p>;
  if (summary.count === 0 || summary.overallRating === null) return <p>هنوز امتیازی ثبت نشده</p>;
  return <div className={`${styles.rating} ${variant === "summary" ? styles.prominent : ""}`}>
    <p className={styles.ratingValue}><strong>{summary.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span>از ۱۰</span></p>
    <p className={styles.count}>بر اساس {summary.count.toLocaleString("fa-IR")} نظر منتشرشده</p>
  </div>;
}
export function PublishedReviewContent({ review }: { review: PublicGuestReview }) {
  return <KoochCard className={styles.card} aria-labelledby={`public-review-${review.id}`}>
    <header className={styles.reviewHeader}><div className={styles.identity}>
      <h3 id={`public-review-${review.id}`}>{review.guestDisplayName}</h3>
      <time dateTime={review.submittedAtUtc}>{formatDateTime(review.submittedAtUtc)}</time>
    </div><p className={styles.guestScore}><span className="sr-only">امتیاز این نظر: </span><strong>{review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span>از ۱۰</span></p></header>
    <p className={`${styles.comment} ${review.comment ? "" : styles.ratingOnly}`}>{review.comment || "بدون توضیح"}</p>
    <details className={styles.disclosure}><summary>جزئیات امتیازها</summary><ReviewScoreList scores={review} /></details>
    {review.ownerReply && <section className={styles.reply} aria-label="پاسخ اقامتگاه"><h4>پاسخ اقامتگاه</h4><p className={styles.comment}>{review.ownerReply.text}</p></section>}
  </KoochCard>;
}
export function PublishedReviewList({ data, error, page, onPage, retry }: {
  data: PublicReviewPage | null; error: boolean; page: number; onPage: (page: number) => void; retry: () => void;
}) {
  if (error) return <div className="space-y-3"><p role="alert">نظرات در حال حاضر در دسترس نیست.</p><KoochButton variant="outline" onClick={retry}>دریافت دوباره نظرات</KoochButton></div>;
  if (!data) return <p role="status">در حال دریافت نظرات…</p>;
  return <div className={styles.root}>
    {data.summary.count > 0 ? <>
      <section aria-label="خلاصه امتیازهای اقامتگاه" className={styles.summary}>
        <div className={styles.summaryHeader}><h3>امتیاز اقامتگاه</h3><PublishedRating summary={data.summary} variant="summary" /></div>
        <ReviewScoreList scores={data.summary.categories} />
      </section>
      <ul className={styles.reviewList} aria-label="نظرات منتشرشدهٔ مهمانان">{data.reviews.items.map(review => <li key={review.id}><PublishedReviewContent review={review} /></li>)}</ul>
    </> : <PublishedRating summary={data.summary} />}
    {data.reviews.totalPages > 1 && <nav aria-label="صفحه‌بندی نظرات مهمانان" className="flex flex-wrap items-center gap-3"><KoochButton variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>صفحه قبل</KoochButton><span className="text-sm">صفحه {page.toLocaleString("fa-IR")} از {data.reviews.totalPages.toLocaleString("fa-IR")}</span><KoochButton variant="outline" disabled={page >= data.reviews.totalPages} onClick={() => onPage(page + 1)}>صفحه بعد</KoochButton></nav>}
  </div>;
}
