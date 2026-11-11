"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { usePathname } from "next/navigation";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { ReviewInvitationOptOut } from "@/components/reviews/ReviewInvitationOptOut";
import { getAllReviewInvitationStays, guestReviewsChangedEvent, reviewDate, type EligibleReviewStay } from "@/lib/guest-reviews";
import { dismissReviewInvitationForSession, isReviewInvitationDismissed } from "@/lib/review-invitation-session";
import styles from "./GuestReviewInvitation.module.css";

// Keep Marketplace account invitations out of Property-branded journeys.
export function reviewInvitationsAllowed(path: string) {
  const pathname = path.split(/[?#]/, 1)[0];
  return !/^\/(?:book|booking)(?:\/|$)/.test(pathname) && !/^\/account\/reviews(?:\/|$)/.test(pathname);
}

function InvitationContent({ userId, stays, dismiss, remove, navigate }: {
  userId: number; stays: EligibleReviewStay[]; dismiss: () => void; remove: (id: number) => void; navigate: () => void;
}) {
  const session = useAuthSession();
  const pathname = usePathname();
  const action = useRef<HTMLAnchorElement>(null);
  if (!stays.length || !session.authenticated || session.loading || session.user?.userId !== userId || !reviewInvitationsAllowed(pathname ?? "")) return null;
  const single = stays.length === 1 ? stays[0] : null;
  const suppress = (id: number) => { if (stays.length > 1) action.current?.focus(); remove(id); };
  return <section dir="rtl" aria-labelledby="global-review-invitation-title" className={styles.card}>
    <div className={styles.header}>
      <h2 id="global-review-invitation-title">اقامتت چطور بود؟</h2>
      <KoochButton variant="ghost" size="icon" className={styles.close} aria-label="بستن دعوت‌نامه نظر برای این نشست" onClick={dismiss}>
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </KoochButton>
    </div>
    <p className={styles.message}>تجربه‌ات در <strong>{stays[0].propertyName}</strong>{!single && ` و ${(stays.length - 1).toLocaleString("fa-IR")} اقامت دیگر`} رو با بقیه به اشتراک بذار.</p>
    <div className={styles.actions}>
      <Link ref={action} className={styles.primary} onClick={navigate} href={single ? `/account/reviews?reservationId=${single.reservationId}&eligiblePage=${single.invitationPage ?? 1}` : "/account/reviews"}>ثبت نظر</Link>
      <KoochButton variant="ghost" size="sm" className={styles.secondary} onClick={dismiss}>فعلاً نه</KoochButton>
    </div>
    {single ? <div className={styles.optOut}><ReviewInvitationOptOut key={single.reservationId} stay={single} onSuppressed={suppress} /></div> : <details className={styles.details}>
      <summary>تنظیم یادآوری برای هر اقامت</summary>
      <ul className={styles.stays}>
        {stays.map(stay => <li key={stay.reservationId}>
          <p className={styles.propertyName}>{stay.propertyName}</p>
          <p className={styles.stayMeta}>خروج {reviewDate(stay.checkOutDate)} · رزرو {stay.reservationNumber ?? stay.reservationId.toLocaleString("fa-IR")}</p>
          <div className={styles.optOut}><ReviewInvitationOptOut stay={stay} onSuppressed={suppress} /></div>
        </li>)}
      </ul>
    </details>}
  </section>;
}

function AuthenticatedInvitation({ userId, allowed }: { userId: number; allowed: boolean }) {
  const [stays, setStays] = useState<EligibleReviewStay[]>([]);
  const [dismissed, setDismissed] = useState(() => isReviewInvitationDismissed(userId));
  useEffect(() => {
    if (dismissed || !allowed) return;
    let disposed = false;
    let pending: AbortController | null = null;
    let lastAttempt = 0;
    let refreshAgain = false;
    async function load(force = false) {
      if (pending) { if (force) refreshAgain = true; return; }
      if (!force && (document.visibilityState === "hidden" || Date.now() - lastAttempt < 60000)) return;
      lastAttempt = Date.now();
      const controller = new AbortController(); pending = controller;
      try {
        const next = await getAllReviewInvitationStays(controller.signal);
        if (!disposed && !controller.signal.aborted) setStays(next);
      } catch { if (!disposed && !controller.signal.aborted) setStays([]); }
      finally {
        pending = null;
        if (refreshAgain && !disposed) { refreshAgain = false; void load(true); }
      }
    }
    const refresh = () => { void load(true); };
    const focus = () => { void load(); };
    void load(true);
    window.addEventListener(guestReviewsChangedEvent, refresh);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(focus, 5 * 60 * 1000);
    return () => {
      disposed = true; pending?.abort(); window.clearInterval(timer);
      window.removeEventListener(guestReviewsChangedEvent, refresh);
      window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus);
    };
  }, [userId, dismissed, allowed]);
  const id = `guest-review-invitation-${userId}`;
  useEffect(() => () => { toast.dismiss(id); }, [id]);
  useEffect(() => {
    if (!allowed || dismissed || !stays.length) { toast.dismiss(id); return; }
    const dismiss = () => {
      dismissReviewInvitationForSession(userId); setDismissed(true); toast.dismiss(id);
    };
    toast.custom(() => <InvitationContent userId={userId} stays={stays} dismiss={dismiss} navigate={() => { setStays([]); toast.dismiss(id); }}
      remove={reservationId => setStays(current => current.filter(stay => stay.reservationId !== reservationId))} />,
    { id, toasterId: "guest-reviews", duration: Infinity, dismissible: false, closeButton: false });
  }, [allowed, dismissed, id, stays, userId]);
  return allowed ? <Toaster id="guest-reviews" dir="rtl" position="bottom-left" containerAriaLabel="یادآوری نظر اقامت"
    offset={{ bottom: "max(24px, env(safe-area-inset-bottom))", left: "24px" }}
    mobileOffset={{ bottom: "calc(96px + env(safe-area-inset-bottom))", left: "12px", right: "12px" }} /> : null;
}

export function GuestReviewInvitation() {
  const session = useAuthSession();
  const pathname = usePathname();
  if (session.loading || !session.authenticated || !session.user || !session.workspaces.includes("account")) return null;
  return <AuthenticatedInvitation key={session.user.userId} userId={session.user.userId} allowed={reviewInvitationsAllowed(pathname ?? "")} />;
}
