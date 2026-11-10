import { formatDateTime } from "@/lib/account-reservations";
import type { AdminReview } from "@/lib/admin-reviews";
import { reviewCategories, reviewDate } from "@/lib/guest-reviews";
import styles from "./AdminReviewsPage.module.css";

export function AdminReviewDetail({ item, status }: { item: AdminReview; status: string }) {
  const reply = item.ownerReply;
  const replyStatus = reply?.moderationStatus === "PendingApproval" ? "در انتظار تأیید"
    : reply?.moderationStatus === "Rejected" ? "ردشده" : "تأییدشده";
  return <>
    <section className={styles.context} aria-label="اطلاعات مهمان و اقامت">
      <div><h2 className="font-bold">{item.guestDisplayName}</h2>
        <p>{item.propertyName} · اقامتگاه {item.review.propertyId.toLocaleString("fa-IR")}</p>
        <p>رزرو {item.reservationNumber ?? item.review.reservationId}</p>
        <p className="text-muted-foreground">{reviewDate(item.checkInDate)} تا {reviewDate(item.checkOutDate)}</p>
        <p className="text-muted-foreground">ارسال: {formatDateTime(item.submittedAtUtc)}</p>
      </div>
      <p className={styles.detailScore}>امتیاز کلی: {item.review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} از ۱۰</p>
    </section>
    <dl className={styles.categories}>{reviewCategories.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{item.review[key].toLocaleString("fa-IR")}</dd></div>)}</dl>
    <section className={styles.detailSection} aria-label="متن نظر مهمان"><h3>متن نظر مهمان</h3><p className={styles.prose}>{item.review.comment || "بدون توضیح"}</p></section>
    <section className={styles.detailSection} aria-label="وضعیت و آخرین تصمیم"><h3>وضعیت و آخرین تصمیم</h3>
      <p>{status} · {item.review.isPublished ? "منتشرشده" : "منتشرنشده"} · نسخه {item.review.revision.toLocaleString("fa-IR")}</p>
      {item.review.rejectionReason && <p className={styles.prose}>دلیل رد: {item.review.rejectionReason}</p>}
      {item.unpublicationReason && <p className={styles.prose}>دلیل داخلی لغو انتشار: {item.unpublicationReason}</p>}
      {item.moderatedAtUtc && <p className="text-muted-foreground">تصمیم: {formatDateTime(item.moderatedAtUtc)} · مدیر {item.moderatedByUserId?.toLocaleString("fa-IR")}</p>}
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
  </>;
}
