import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { formatDateTime } from "@/lib/account-reservations";
import { reviewCategories } from "@/lib/guest-reviews";
import type { OwnerReview } from "@/lib/property-reviews";
import styles from "./OwnerReviewsPage.module.css";

export function OwnerReviewCard({ item, canReply, onReply }: {
  item: OwnerReview; canReply: boolean; onReply: () => void;
}) {
  const { review, reply } = item;
  const status = reply?.moderationStatus === "PendingApproval" ? "در انتظار تأیید"
    : reply?.moderationStatus === "Rejected" ? "ردشده" : "تأییدشده";
  const publishedText = review.ownerReply?.text ?? reply?.publishedBody;
  return <KoochCard padding="none" className={styles.card} aria-labelledby={`owner-review-${review.id}`}>
    <header className={styles.cardHeader}>
      <div className={styles.identity}>
        <h2 id={`owner-review-${review.id}`} className={styles.guestName}>{review.guestDisplayName}</h2>
        <time dateTime={review.submittedAtUtc} className={styles.date}>{formatDateTime(review.submittedAtUtc)}</time>
      </div>
      <p className={styles.overall}>
        <span className="sr-only">امتیاز کلی: </span>
        <strong>{review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
        <span>از ۱۰</span>
      </p>
    </header>
    <div className={styles.reviewBody}>
      <dl className={styles.scores}>
        {reviewCategories.map(([key, label]) => <div key={key} className={styles.category}>
          <dt>{label}</dt><dd>
            <span className={styles.categoryValue}>{review[key].toLocaleString("fa-IR")}</span>
            <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={10} aria-valuenow={review[key]} aria-valuetext={`${review[key].toLocaleString("fa-IR")} از ۱۰`} className={styles.track}>
              <span aria-hidden="true" style={{ width: `${review[key] * 10}%` }} />
            </div>
          </dd>
        </div>)}
      </dl>
      <div className={styles.comment}>
        <h3 className={styles.sectionTitle}>متن نظر مهمان</h3>
        <p className={!review.comment ? styles.emptyText : undefined}>{review.comment || "بدون توضیح"}</p>
      </div>
    </div>
    <section className={styles.reply} aria-labelledby={`owner-review-reply-${review.id}`}>
      <div className={styles.replyHeader}>
        <div className={styles.replyHeading}>
          <h3 id={`owner-review-reply-${review.id}`} className={styles.sectionTitle}>پاسخ اقامتگاه</h3>
          {reply && <p className={styles.replyStatus}>نسخهٔ پاسخ: {status}</p>}
        </div>
        {canReply && <KoochButton variant="outline" onClick={onReply}>{reply ? "ویرایش پاسخ" : "ثبت پاسخ اقامتگاه"}</KoochButton>}
      </div>
      {publishedText && <div className={styles.replyText}>
        {reply && reply.moderationStatus !== "Approved" && <p className={styles.versionLabel}>پاسخ منتشرشده</p>}
        <p>{publishedText}</p>
      </div>}
      {reply && reply.moderationStatus !== "Approved" && <div className={styles.replyText}>
        <p className={styles.versionLabel}>نسخهٔ ارسال‌شده</p><p>{reply.body}</p>
      </div>}
      {reply?.moderationStatus === "Approved" && !publishedText && <p className={styles.replyText}>{reply.body}</p>}
      {reply?.rejectionReason && <p className={styles.feedback}>دلیل رد پاسخ: {reply.rejectionReason}</p>}
      {reply?.publishedBody && reply.moderationStatus !== "Approved" && <p className={styles.emptyText}>نسخهٔ تأییدشدهٔ قبلی همچنان عمومی است.</p>}
      {!reply && !publishedText && <p className={styles.emptyText}>هنوز پاسخی ثبت نشده است.</p>}
    </section>
  </KoochCard>;
}
