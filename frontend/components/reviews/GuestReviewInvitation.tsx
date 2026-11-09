"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { getEligibleReviewStays, reviewDate, reviewLinkClass, type EligibleReviewStay } from "@/lib/guest-reviews";

export function GuestReviewInvitation({ userId }: { userId: number }) {
  const [stays, setStays] = useState<EligibleReviewStay[]>([]);
  const [total, setTotal] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setStays([]);
    getEligibleReviewStays(1, controller.signal).then(result => {
      if (!controller.signal.aborted) { setStays(result.items); setTotal(result.totalCount); }
    }).catch(() => { /* The permanent reviews link remains available if this optional invitation fails. */ });
    return () => controller.abort();
  }, [userId]);
  if (dismissed || !stays.length) return null;
  return (
    <KoochCard aria-labelledby="review-invitation-title" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold" id="review-invitation-title">اقامتتان چطور بود؟</h2>
        <KoochButton variant="ghost" onClick={() => setDismissed(true)}>فعلاً نه</KoochButton>
      </div>
      <p className="mt-1 text-sm leading-7 text-muted-foreground">تجربه اقامت خود را به اشتراک بگذارید. نظر شما پیش از انتشار بررسی می‌شود.</p>
      <ul className="mt-3 divide-y divide-border">
        {stays.map(stay => (
          <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={stay.reservationId}>
            <div><p className="font-semibold">{stay.propertyName}</p><p className="mt-1 text-sm text-muted-foreground">تاریخ خروج: {reviewDate(stay.checkOutDate)}</p></div>
            <Link className={reviewLinkClass} href={`/account/reviews?reservationId=${stay.reservationId}`} aria-label={`ثبت نظر برای ${stay.propertyName}`}>ثبت نظر</Link>
          </li>
        ))}
      </ul>
      {total > stays.length && <Link className={reviewLinkClass} href="/account/reviews">مشاهده همه اقامت‌ها</Link>}
    </KoochCard>
  );
}
