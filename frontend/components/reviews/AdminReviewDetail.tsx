import { formatDateTime } from "@/lib/account-reservations";
import type { AdminReview } from "@/lib/admin-reviews";
import { reviewCategories, reviewDate } from "@/lib/guest-reviews";
import styles from "./AdminReviewsPage.module.css";
import type { ReviewScores } from "@/lib/property-reviews";

export function AdminReviewScores({ scores }: { scores: ReviewScores }) {
  return <dl className={styles.categories}>{reviewCategories.map(([key, label]) => <div key={key} className={styles.category}>
    <dt>{label}</dt><dd>
      <span className={styles.categoryValue}>{scores[key].toLocaleString("fa-IR")}<span> /۱۰</span></span>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={10} aria-valuenow={scores[key]} aria-valuetext={`${scores[key].toLocaleString("fa-IR")} از ۱۰`} className={styles.ratingTrack}>
        <span aria-hidden="true" style={{ width: `${scores[key] * 10}%` }} />
      </div>
    </dd>
  </div>)}</dl>;
}

export function AdminReviewComment({ comment }: { comment: string }) {
  return <section className={styles.detailSection} aria-label="متن نظر مهمان">
    {comment ? <><h3>متن نظر مهمان</h3><p className={styles.prose}>{comment}</p></>
      : <p>متن نظر: <span className="text-muted-foreground">بدون توضیح</span></p>}
  </section>;
}

export function AdminReviewDetail({ item, status }: { item: AdminReview; status: string }) {
  const reply = item.ownerReply;
  const replyStatus = reply?.moderationStatus === "PendingApproval" ? "در انتظار تأیید"
    : reply?.moderationStatus === "Rejected" ? "ردشده" : "تأییدشده";
  return <div className={styles.detailLayout}>
    <section className={styles.context} aria-label="اطلاعات مهمان و اقامت">
      <div className={styles.contextIdentity}><h2 className="font-bold">{item.guestDisplayName}</h2>
        <p>{item.propertyName} · اقامتگاه {item.review.propertyId.toLocaleString("fa-IR")}</p>
        <p>رزرو {item.reservationNumber ?? item.review.reservationId}</p>
      </div>
      <div className={styles.detailScore} role="group" aria-label="امتیاز کلی">
        <span className={styles.detailScoreLabel}>امتیاز کلی</span>
        <p><strong>{item.review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span>از ۱۰</span></p>
      </div>
    </section>
    <div className={styles.detailMeta}>
      <p>اقامت: {reviewDate(item.checkInDate)} تا {reviewDate(item.checkOutDate)}</p>
      <p>ارسال: <time dateTime={item.submittedAtUtc}>{formatDateTime(item.submittedAtUtc)}</time></p>
    </div>
    <AdminReviewScores scores={item.review} />
    <AdminReviewComment comment={item.review.comment} />
    <section className={styles.detailSection} aria-label="وضعیت و آخرین تصمیم">
      <div className={styles.decisionRow}>
        <p>{status} · نسخه {item.review.revision.toLocaleString("fa-IR")}</p>
        {item.moderatedAtUtc && <p className="text-muted-foreground">تصمیم: {formatDateTime(item.moderatedAtUtc)} · مدیر {item.moderatedByUserId?.toLocaleString("fa-IR")}</p>}
      </div>
      {item.review.rejectionReason && <p className={styles.prose}>دلیل رد: {item.review.rejectionReason}</p>}
      {item.unpublicationReason && <p className={styles.prose}>دلیل داخلی لغو انتشار: {item.unpublicationReason}</p>}
    </section>
    <section className={styles.detailSection} aria-label="پاسخ اقامتگاه"><h3>پاسخ اقامتگاه</h3>
      {reply === undefined ? <p className="text-muted-foreground">اطلاعات پاسخ اقامتگاه در دسترس نیست.</p> : reply === null ? <p className="text-muted-foreground">پاسخی ثبت نشده است.</p> : <>
        <p>وضعیت نسخهٔ پاسخ: {replyStatus}</p>
        {reply.publishedBody && <div className={styles.replyVersion}><h4>نسخهٔ تأییدشدهٔ عمومی</h4><p className={styles.prose}>{reply.publishedBody}</p>
          {!item.review.isPublished && <p className="text-muted-foreground">با لغو انتشار نظر، این پاسخ نیز در بخش عمومی نمایش داده نمی‌شود.</p>}
        </div>}
        {(reply.moderationStatus !== "Approved" || !reply.publishedBody) && <div className={styles.replyVersion}><h4>{reply.moderationStatus === "Approved" ? "نسخهٔ تأییدشده" : "نسخهٔ ارسال‌شده (غیرعمومی)"}</h4><p className={styles.prose}>{reply.body}</p></div>}
        {reply.rejectionReason && <p className={styles.prose}>دلیل رد پاسخ: {reply.rejectionReason}</p>}
      </>}
    </section>
  </div>;
}
