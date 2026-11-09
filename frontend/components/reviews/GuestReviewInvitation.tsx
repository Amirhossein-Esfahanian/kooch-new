"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { usePathname } from "next/navigation";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { ReviewInvitationOptOut } from "@/components/reviews/ReviewInvitationOptOut";
import { getAllReviewInvitationStays, guestReviewsChangedEvent, reviewDate, reviewLinkClass, type EligibleReviewStay } from "@/lib/guest-reviews";
import { dismissReviewInvitationForSession, isReviewInvitationDismissed } from "@/lib/review-invitation-session";

// Keep Marketplace account invitations out of Property-branded journeys.
export function reviewInvitationsAllowed(path: string) {
  return !/^\/(?:book|booking)(?:\/|$)/.test(path);
}

function InvitationContent({ userId, stays, dismiss, remove, navigate }: {
  userId: number; stays: EligibleReviewStay[]; dismiss: () => void; remove: (id: number) => void; navigate: () => void;
}) {
  const session = useAuthSession();
  const pathname = usePathname();
  const action = useRef<HTMLAnchorElement>(null);
  if (!session.authenticated || session.loading || session.user?.userId !== userId || !reviewInvitationsAllowed(pathname ?? "")) return null;
  const single = stays.length === 1 ? stays[0] : null;
  const suppress = (id: number) => { if (stays.length > 1) action.current?.focus(); remove(id); };
  return <section dir="rtl" aria-labelledby="global-review-invitation-title"
    className="max-h-[calc(100dvh-8rem)] w-full overflow-y-auto rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm motion-reduce:transition-none">
    <div className="flex items-start justify-between gap-3">
      <h2 id="global-review-invitation-title" className="pt-2 text-base font-bold">اقامتتان چطور بود؟</h2>
      <KoochButton variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="بستن دعوت‌نامه نظر برای این نشست" onClick={dismiss}>
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </KoochButton>
    </div>
    {single ? <p className="mt-1 break-words text-sm leading-7">{single.propertyName} · خروج {reviewDate(single.checkOutDate)}</p>
      : <p className="mt-1 text-sm leading-7">برای {stays.length.toLocaleString("fa-IR")} اقامت می‌توانید نظر بدهید.</p>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Link ref={action} className={reviewLinkClass} onClick={navigate} href={single ? `/account/reviews?reservationId=${single.reservationId}&eligiblePage=${single.invitationPage ?? 1}` : "/account/reviews"}>ثبت نظر</Link>
      <KoochButton variant="ghost" className="min-h-11" onClick={dismiss}>فعلاً نه</KoochButton>
    </div>
    {single ? <ReviewInvitationOptOut key={single.reservationId} stay={single} onSuppressed={suppress} /> : <details className="mt-2 text-sm">
      <summary className="min-h-11 cursor-pointer rounded-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">تنظیم یادآوری برای هر اقامت</summary>
      <ul className="max-h-48 overflow-y-auto overscroll-contain divide-y divide-border">
        {stays.map(stay => <li key={stay.reservationId} className="py-3">
          <p className="break-words font-semibold">{stay.propertyName}</p>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">خروج {reviewDate(stay.checkOutDate)} · رزرو {stay.reservationNumber ?? stay.reservationId.toLocaleString("fa-IR")}</p>
          <ReviewInvitationOptOut stay={stay} onSuppressed={suppress} />
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
