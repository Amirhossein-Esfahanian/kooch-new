import styles from "./AccountSkeleton.module.css";

export function AccountSkeleton({ variant = "line", className = "" }: {
  variant?: "line" | "block"; className?: string;
}) {
  return <span aria-hidden="true" className={`${styles.placeholder} ${styles[variant]} ${className}`} />;
}

export function AccountContentSkeleton() {
  return <div className={styles.content} role="status" aria-busy="true" dir="rtl">
    <span className="sr-only">در حال بارگذاری حساب کاربری…</span>
    <div className={styles.headerPlaceholder} aria-hidden="true">
      <AccountSkeleton className={styles.short} />
      <AccountSkeleton className={styles.title} />
      <AccountSkeleton className={styles.description} />
    </div>
    <AccountSkeleton variant="block" className={styles.nextStay} />
    <div className={styles.cards} aria-hidden="true">
      {[0, 1, 2].map(index => <AccountSkeleton key={index} variant="block" />)}
    </div>
    <div className={styles.actions} aria-hidden="true"><AccountSkeleton className={styles.short} /><AccountSkeleton /><AccountSkeleton /></div>
  </div>;
}
