"use client";

import { useState } from "react";
import { KoochDialog } from "@/components/KoochDialog";
import { CheckoutIdentityStep } from "@/components/booking/CheckoutIdentityStep";
import styles from "./PropertyDirectGuest.module.css";

export function PropertyGuestAuthDialog({ open, onOpenChange, onAuthenticated, propertyName }: {
  open: boolean; onOpenChange: (open: boolean) => void; onAuthenticated: () => void; propertyName?: string;
}) {
  const [busy, setBusy] = useState(false);
  return <KoochDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} closeDisabled={busy}
    title={<>{propertyName && <span className={styles.authProperty}>{propertyName}</span>}<span className={styles.authHeading}>ورود / ثبت‌نام</span></>}
    description="برای مشاهده و پیگیری رزروها، شماره موبایل خود را تأیید کنید."
    closeButtonClassName={styles.authClose}
    size="sm" contentClassName={`dark ${styles.scope} ${styles.authDialog}`} bodyClassName={styles.authBody}>
    {/* The shared dialog owns initial focus so lazy mounting cannot steal its return target. */}
    {open && <CheckoutIdentityStep intent="account" allowAlternateLogin={false} autoFocusMobile={false} showIntroduction={false} onBusyChange={setBusy} onAuthenticated={onAuthenticated} />}
  </KoochDialog>;
}
