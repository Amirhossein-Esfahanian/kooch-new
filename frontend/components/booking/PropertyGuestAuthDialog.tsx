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
    title={propertyName || "ورود / ثبت‌نام"} description="ورود امن به حساب مشترک برای مشاهده و پیگیری رزروها"
    size="sm" contentClassName={`${styles.scope} ${styles.authDialog}`} bodyClassName={styles.authBody}>
    {/* The shared dialog owns initial focus so lazy mounting cannot steal its return target. */}
    {open && <CheckoutIdentityStep intent="account" allowAlternateLogin={false} autoFocusMobile={false} onBusyChange={setBusy} onAuthenticated={onAuthenticated} />}
  </KoochDialog>;
}
