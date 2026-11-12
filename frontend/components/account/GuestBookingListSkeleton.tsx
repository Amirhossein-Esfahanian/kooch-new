import { AccountSkeleton } from "./AccountSkeleton";
import styles from "./GuestBookingLists.module.css";

export function GuestBookingListSkeleton({ kind }: { kind: "reservations" | "orders" }) {
  return <div className={styles.skeleton} role="status" aria-busy="true">
    <span className="sr-only">{kind === "orders" ? "در حال بارگذاری سفارش‌ها…" : "در حال بارگذاری رزروها…"}</span>
    {[0, 1, 2].map(index => <div className={styles.card} key={index} aria-hidden="true">
      <AccountSkeleton className={styles.skeletonReference} />
      <AccountSkeleton className={styles.skeletonTitle} />
      <div className={`${styles.facts} ${kind === "orders" ? styles.orderFacts : ""}`}>
        {(kind === "orders" ? [0, 1, 2] : [0, 1, 2, 3]).map(field => <div key={field}><AccountSkeleton className={styles.skeletonReference} /><AccountSkeleton className={styles.skeletonValue} /></div>)}
      </div>
      <AccountSkeleton className={styles.skeletonAction} />
    </div>)}
  </div>;
}
