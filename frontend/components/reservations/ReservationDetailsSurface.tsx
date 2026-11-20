"use client";

import { useRef, useState, type ReactNode } from "react";
import { KoochDialog, type KoochDialogProps } from "@/components/KoochDialog";
import styles from "./ReservationDetailsSurface.module.css";

export function ReservationDetailsSurface({ presentation, pageHeader, ...props }: KoochDialogProps & {
  presentation: "dialog" | "page"; pageHeader: ReactNode;
}) {
  if (presentation === "dialog") return <KoochDialog {...props} />;
  if (!props.open) return null;
  return <div className={styles.page} dir="rtl">
    <header className={styles.header}>{pageHeader}</header>
    {props.footer && <div className={styles.actions} role="group" aria-label="اقدامات رزرو">{props.footer}</div>}
    <div className={styles.content} data-slot="reservation-details-page-body">{props.children}</div>
  </div>;
}

export const reservationDetailsTabs = [
  { id: "reservation", label: "رزرو و مهمان" },
  { id: "financial", label: "پرداخت و بازپرداخت" },
  { id: "activity", label: "فعالیت‌ها و یادداشت‌ها" },
] as const;
export type ReservationDetailsTab = typeof reservationDetailsTabs[number]["id"];

export function ReservationDetailsTabs({ id, active, onChange }: {
  id: string; active: ReservationDetailsTab; onChange: (tab: ReservationDetailsTab) => void;
}) {
  const [focused, setFocused] = useState<ReservationDetailsTab>(active);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <div role="tablist" aria-label="جزئیات رزرو" dir="rtl" className={styles.tabs}>
    {reservationDetailsTabs.map((tab, index) => <button key={tab.id} type="button" role="tab"
      id={`${id}-${tab.id}-tab`} aria-controls={`${id}-${tab.id}-panel`}
      aria-selected={active === tab.id} tabIndex={focused === tab.id ? 0 : -1}
      onFocus={() => setFocused(tab.id)} ref={node => { buttons.current[index] = node; }}
      onClick={() => { setFocused(tab.id); onChange(tab.id); }} onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); onChange(tab.id); return;
        }
        let next: number;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = reservationDetailsTabs.length - 1;
        else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const forward = event.key === "ArrowLeft";
          next = (index + (forward ? 1 : -1) + reservationDetailsTabs.length) % reservationDetailsTabs.length;
        } else return;
        event.preventDefault(); buttons.current[next]?.focus();
      }}>{tab.label}</button>)}
  </div>;
}
