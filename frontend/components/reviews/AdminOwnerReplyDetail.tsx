import type { AdminOwnerReply } from "@/lib/property-reviews";
import { formatDateTime } from "@/lib/account-reservations";
import { AdminReviewComment, AdminReviewScores } from "./AdminReviewDetail";
import styles from "./AdminReviewsPage.module.css";

export function AdminOwnerReplyDetail({ item }: { item: AdminOwnerReply }) {
  const { reply, guestReview } = item;
  const status = reply.moderationStatus === "PendingApproval" ? "در انتظار تأیید" : reply.moderationStatus === "Rejected" ? "ردشده" : "تأییدشده";
  const approved = reply.moderationStatus === "Approved";
  return <div className={styles.detailLayout}>
    <section className={styles.context} aria-label="اطلاعات مهمان و اقامتگاه">
      <div className={styles.contextIdentity}><h2 className="font-bold">{guestReview.guestDisplayName}</h2><p>{item.propertyName} · اقامتگاه {item.propertyId.toLocaleString("fa-IR")}</p></div>
      <div className={styles.detailScore} role="group" aria-label="امتیاز کلی"><span className={styles.detailScoreLabel}>امتیاز کلی</span><p><strong>{guestReview.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span>از ۱۰</span></p></div>
    </section>
    <div className={styles.detailMeta}>
      <p>ارسال نظر: <time dateTime={guestReview.submittedAtUtc}>{formatDateTime(guestReview.submittedAtUtc)}</time></p>
      <p>ارسال پاسخ: {item.submittedAtUtc ? <time dateTime={item.submittedAtUtc}>{formatDateTime(item.submittedAtUtc)}</time> : "زمان ارسال در دسترس نیست"}</p>
    </div>
    <section aria-label="نسخهٔ ارسال‌شدهٔ پاسخ اقامتگاه" className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className={styles.decisionRow}><h3 className="font-bold">{approved && reply.publishedBody ? "پاسخ عمومی تأییدشده" : "نسخهٔ ارسال‌شدهٔ پاسخ اقامتگاه"}</h3><p>{status} · نسخه {reply.revision.toLocaleString("fa-IR")}</p></div>
      <p className={`${styles.prose} text-base leading-7`}>{approved ? reply.publishedBody ?? reply.body : reply.body}</p>
      {reply.rejectionReason && <p className={styles.prose}>دلیل رد پاسخ: {reply.rejectionReason}</p>}
    </section>
    {!approved && reply.publishedBody && <section aria-label="پاسخ عمومی فعلی" className={styles.replyVersion}>
      <h4>پاسخ عمومی فعلی — نسخهٔ تأییدشدهٔ قبلی</h4><p className={styles.prose}>{reply.publishedBody}</p>
      <p className="mt-1 text-xs text-muted-foreground">تا تأیید نسخهٔ جدید، پاسخ تأییدشدهٔ قبلی در بخش عمومی باقی می‌ماند.</p>
    </section>}
    <AdminReviewScores scores={guestReview} />
    <AdminReviewComment comment={guestReview.comment} />
  </div>;
}
