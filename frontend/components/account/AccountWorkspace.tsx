import Image from "next/image";
import type { ReactNode } from "react";
import { AccountNavigation } from "./AccountNavigation";
import styles from "./AccountWorkspace.module.css";

export function AccountWorkspace({ children }: { children: ReactNode }) {
  return <div className={styles.shell} dir="rtl">
    <aside className={styles.sidebar} aria-label="منوی حساب کاربری">
      <div className={styles.identity}>
        <Image src="/svgs/account/account.svg" alt="" width={24} height={24} className={styles.icon} />
        <span>حساب کاربری</span>
      </div>
      <AccountNavigation />
    </aside>
    <div className={styles.content}>{children}</div>
  </div>;
}
