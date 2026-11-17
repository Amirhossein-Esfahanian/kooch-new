import type { ReactNode } from "react";
import { KoochDialog, type KoochDialogProps } from "@/components/KoochDialog";
import styles from "./ReservationDetailsSurface.module.css";

export function ReservationDetailsSurface({ presentation, pageHeader, ...props }: KoochDialogProps & {
  presentation: "dialog" | "page"; pageHeader: ReactNode;
}) {
  if (presentation === "dialog") return <KoochDialog {...props} />;
  if (!props.open) return null;
  return <div className={styles.page} dir="rtl">
    <header className={styles.header}>{pageHeader}</header>
    <div className={styles.actions} role="group" aria-label="اقدامات رزرو">{props.footer}</div>
    <div className={styles.content} data-slot="reservation-details-page-body">{props.children}</div>
  </div>;
}
