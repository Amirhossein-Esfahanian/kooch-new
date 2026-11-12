import { AccountSkeleton } from "@/components/account/AccountSkeleton";
import styles from "./GuestReviewsPage.module.css";

export function GuestReviewsSkeleton({ variant }: { variant: "eligible" | "submitted" }) {
  return <div className={styles.skeletonList} role="status" aria-busy="true">
    <span className="sr-only">{variant === "eligible" ? "در حال دریافت اقامت‌ها…" : "در حال دریافت نظرها…"}</span>
    {[0, 1].map(index => variant === "eligible"
      ? <div className={styles.stayRow} key={index} aria-hidden="true">
        <div className={styles.stayInfo}>
          <AccountSkeleton className={styles.skeletonReference} />
          <AccountSkeleton className={styles.skeletonTitle} />
          <AccountSkeleton className={styles.skeletonDates} />
        </div>
        <AccountSkeleton className={styles.skeletonAction} />
      </div>
      : <div className={styles.submittedCard} key={index} aria-hidden="true">
        <AccountSkeleton className={styles.skeletonTitle} />
        <AccountSkeleton className={styles.skeletonDates} />
        <div className={styles.ratingRow}>
          <AccountSkeleton className={styles.skeletonScore} />
          <div className={styles.skeletonCategories}>{[0, 1, 2, 3, 4, 5].map(category => <AccountSkeleton key={category} />)}</div>
        </div>
        <AccountSkeleton className={styles.skeletonComment} />
        <AccountSkeleton className={styles.skeletonAction} />
      </div>)}
  </div>;
}
