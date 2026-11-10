"use client";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochInfoHint } from "@/components/KoochInfoHint";
import { reviewCategories, type ReviewScoreKey } from "@/lib/guest-reviews";
import { formatDate, formatDateTime } from "@/lib/account-reservations";
import type { PublicGuestReview, PublicReviewPage } from "@/lib/property-reviews";
import styles from "./PublishedReviews.module.css";

export function getRatingQuality(score: number) {
  if (score < 4) return { tone: "weak", label: "ضعیف" } as const;
  if (score < 6) return { tone: "average", label: "متوسط" } as const;
  if (score < 8) return { tone: "good", label: "خوب" } as const;
  if (score < 9) return { tone: "veryGood", label: "بسیار خوب" } as const;
  return { tone: "excellent", label: "عالی" } as const;
}

export function ReviewScoreList({ scores }: { scores: Partial<Record<ReviewScoreKey, number | null>> }) {
  return <dl className={styles.scores}>
    {reviewCategories.map(([key, label]) => {
      const value = scores[key];
      return <div className={`${styles.category} ${styles.qualityTone}`} data-quality={value != null ? getRatingQuality(value).tone : undefined} key={key}><dt>{label}</dt><dd>
        <span className={styles.categoryValue}>{value?.toLocaleString("fa-IR", { maximumFractionDigits: 1 }) ?? "—"}</span>
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
  const quality = getRatingQuality(summary.overallRating);
  return <div data-quality={quality.tone} className={`${styles.rating} ${styles.qualityTone} ${variant === "summary" ? styles.prominent : ""}`}>
    <div className={styles.ratingValue}><strong>{summary.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span>از ۱۰</span>
      <KoochInfoHint openOnHoverFocus constrainToViewport ariaLabel="نمایش امتیازهای اخیر" content={
        <div dir="rtl">
          <p className={styles.recentTitle}>امتیازهای اخیر</p>
          <p className={styles.count}>از جدیدترین به قدیمی‌ترین (راست به چپ)</p>
          {summary.recentRatings?.length ? <ol className={styles.recentRatings} aria-label="امتیازهای اخیر، از جدیدترین به قدیمی‌ترین">
            {summary.recentRatings.slice(0, 10).map((score, index) => {
              const recentQuality = getRatingQuality(score);
              return <li className={`${styles.qualityTone} ${styles.recentPill}`} data-quality={recentQuality.tone} key={index}
                aria-label={`${(index + 1).toLocaleString("fa-IR")}: ${score.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} از ۱۰، ${recentQuality.label}`}>
                {score.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </li>;
            })}
          </ol> : <p>امتیازهای اخیر در دسترس نیست.</p>}
        </div>
      } />
    </div>
    <p className={styles.quality}>{quality.label}</p>
    <p className={styles.count}>بر اساس {summary.count.toLocaleString("fa-IR")} نظر</p>
  </div>;
}
export function PublishedReviewContent({ review }: { review: PublicGuestReview }) {
  const quality = getRatingQuality(review.overallRating);
  return <KoochCard className={styles.card} aria-labelledby={`public-review-${review.id}`}>
    <header className={styles.reviewHeader}>
      <div className={styles.identity}>
      <h3 id={`public-review-${review.id}`}>{review.guestDisplayName}</h3>
      </div>
      <div className={styles.qualityTone} data-quality={quality.tone}>
        <p className={styles.guestScore}><span className="sr-only">امتیاز این نظر: </span><strong>{review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span>از ۱۰</span></p>
        <p className={styles.quality}>{quality.label}</p>
      </div>
      {review.roomTypeName && <p className={styles.reviewDate}>نوع اتاق: {review.roomTypeName}</p>}
      {review.checkInDate && <p className={styles.reviewDate}>ورود: <time dateTime={review.checkInDate}>{formatDate(review.checkInDate)}</time></p>}
      {review.checkOutDate && <p className={styles.reviewDate}>خروج: <time dateTime={review.checkOutDate}>{formatDate(review.checkOutDate)}</time></p>}
      <p className={styles.reviewDate}>تاریخ ثبت نظر: <time dateTime={review.submittedAtUtc}>{formatDateTime(review.submittedAtUtc)}</time></p>
    </header>
    <div className={styles.reviewBody}>
      <p className={`${styles.comment} ${review.comment ? "" : styles.ratingOnly}`}>{review.comment || "بدون توضیح"}</p>
      {review.ownerReply && <section className={styles.reply} aria-label="پاسخ اقامتگاه"><h4>پاسخ اقامتگاه</h4><p className={styles.comment}>{review.ownerReply.text}</p></section>}
      <details className={styles.disclosure}><summary>جزئیات امتیازها</summary><ReviewScoreList scores={review} /></details>
    </div>
  </KoochCard>;
}

function ReviewPagination({ reviews, page, onPage, position }: {
  reviews: PublicReviewPage["reviews"]; page: number; onPage: (page: number) => void; position: "بالا" | "پایین";
}) {
  if (reviews.totalPages <= 1) return null;
  return <nav aria-label={`صفحه‌بندی نظرات مهمانان (${position})`} className={styles.pagination}>
    <span className={styles.totalCount}>{reviews.totalCount.toLocaleString("fa-IR")} نظر</span>
    <KoochButton variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>صفحه قبل</KoochButton>
    <span>صفحه {page.toLocaleString("fa-IR")} از {reviews.totalPages.toLocaleString("fa-IR")}</span>
    <KoochButton variant="outline" disabled={page >= reviews.totalPages} onClick={() => onPage(page + 1)}>صفحه بعد</KoochButton>
  </nav>;
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
      <ReviewPagination reviews={data.reviews} page={page} onPage={onPage} position="بالا" />
      <ul className={styles.reviewList} aria-label="نظرات منتشرشدهٔ مهمانان">{data.reviews.items.map(review => <li key={review.id}><PublishedReviewContent review={review} /></li>)}</ul>
      <ReviewPagination reviews={data.reviews} page={page} onPage={onPage} position="پایین" />
    </> : <PublishedRating summary={data.summary} />}
  </div>;
}
