"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochTextarea } from "@/components/KoochFormControls";
import { ScorePill } from "@/components/ScorePill";
import { getGuestReview, reviewCategories, reviewDate, reviewError, reviewLinkClass, saveGuestReview,
  type EligibleReviewStay, type GuestReviewRequest, type ReviewScoreKey } from "@/lib/guest-reviews";

export function GuestReviewForm({ stay, onClose, onSaved }: {
  stay: EligibleReviewStay; onClose: () => void; onSaved: () => void;
}) {
  const [scores, setScores] = useState<Partial<Record<ReviewScoreKey, string>>>({});
  const [comment, setComment] = useState("");
  const [revision, setRevision] = useState<number>();
  const [loading, setLoading] = useState(stay.reviewId !== null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const edit = stay.reviewId !== null;
  useEffect(() => {
    heading.current?.focus();
    const controller = new AbortController();
    request.current = controller;
    if (edit) getGuestReview(stay.reservationId, controller.signal).then(review => {
      if (controller.signal.aborted) return;
      setScores(Object.fromEntries(reviewCategories.map(([key]) => [key, String(review[key])])));
      setComment(review.comment); setRevision(review.revision); setLoading(false);
    }).catch(failure => {
      if (!controller.signal.aborted) { setError(reviewError(failure)); setLoadFailed(true); setLoading(false); }
    });
    return () => controller.abort();
  }, [edit, stay.reservationId]);
  const complete = reviewCategories.every(([key]) => /^[1-9]$|^10$/.test(scores[key] ?? ""));
  const average = complete ? reviewCategories.reduce((sum, [key]) => sum + Number(scores[key]), 0) / 6 : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || loading || loadFailed) return;
    setAttempted(true); setError("");
    if (!complete || comment.length > 4000) {
      const invalid = reviewCategories.find(([key]) => !scores[key]);
      if (invalid) event.currentTarget.querySelector<HTMLInputElement>(`input[name="${invalid[0]}"]`)?.focus();
      return;
    }
    inFlight.current = true; setBusy(true);
    const body = { ...Object.fromEntries(reviewCategories.map(([key]) => [key, Number(scores[key])])), comment,
      ...(edit ? { revision } : {}) } as GuestReviewRequest;
    try {
      await saveGuestReview(stay.reservationId, body, edit, request.current?.signal);
      if (!request.current?.signal.aborted) onSaved();
    } catch (failure) {
      if (!request.current?.signal.aborted) setError(reviewError(failure));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return (
    <KoochCard aria-labelledby="review-form-title" dir="rtl">
      <h2 className="text-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" id="review-form-title" ref={heading} tabIndex={-1}>{edit ? "ویرایش نظر" : "ثبت نظر"} — {stay.propertyName}</h2>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">خروج: {reviewDate(stay.checkOutDate)} · مهلت ثبت و ویرایش: {reviewDate(stay.submissionDeadlineLocalDate)}</p>
      <p className="mt-1 text-sm leading-7 text-muted-foreground">برای هر بخش امتیازی از ۱ تا ۱۰ انتخاب کنید. متن نظر اختیاری است و نظر پس از بررسی منتشر می‌شود.</p>
      {loading ? <p className="py-6" role="status">در حال دریافت نظر…</p> : (
        <form className="mt-5 grid gap-5" onSubmit={submit} noValidate aria-busy={busy}>
          <fieldset disabled={busy || loadFailed} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <legend className="mb-3 font-semibold">امتیازهای اقامت (همه الزامی)</legend>
            {reviewCategories.map(([key, label]) => {
              const invalid = attempted && !scores[key];
              return <div className="grid gap-2" key={key}>
                <ScorePill name={key} label={label} required value={scores[key] ? Number(scores[key]) : null}
                  onChange={score => setScores(current => ({ ...current, [key]: String(score) }))}
                  disabled={busy || loadFailed} invalid={Boolean(invalid)} describedBy={invalid ? `${key}-error` : undefined} />
                {invalid && <p className="text-sm text-destructive" id={`${key}-error`} role="alert">امتیاز {label} را انتخاب کنید.</p>}
              </div>;
            })}
          </fieldset>
          <output className="rounded-lg bg-muted px-4 py-3 text-sm font-semibold tabular-nums" aria-live="polite" aria-label="میانگین امتیاز">میانگین: {average === null ? "پس از انتخاب شش امتیاز" : `${average.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} از ۱۰`}</output>
          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="review-comment">تجربه شما (اختیاری)</label>
            <KoochTextarea id="review-comment" value={comment} onChange={event => setComment(event.target.value)} maxLength={4000} disabled={busy || loadFailed} aria-describedby="review-comment-help" />
            <p className="text-sm leading-6 text-muted-foreground" id="review-comment-help">{average !== null && average <= 3 ? "اگر مایلید، توضیح دهید چه چیزی می‌توانست بهتر باشد؛ نوشتن توضیح همچنان اختیاری است." : "حداکثر ۴۰۰۰ نویسه. اطلاعات شخصی یا حساس را در نظر ننویسید."}</p>
          </div>
          {error && <p className="text-sm leading-7 text-destructive" role="alert">{error}</p>}
          {error.includes("نشست") && <Link className={reviewLinkClass} href="/login?returnTo=%2Faccount%2Freviews">ورود دوباره</Link>}
          <div className="flex flex-wrap gap-3">
            <KoochButton type="submit" loading={busy} disabled={loadFailed || (edit && revision === undefined)}>{edit ? "ذخیره و ارسال برای بررسی" : "ارسال نظر برای بررسی"}</KoochButton>
            <KoochButton variant="outline" disabled={busy} onClick={onClose}>بازگشت به فهرست</KoochButton>
            {stay.reservationNumber && <Link className={reviewLinkClass} href={`/account/reservations/${encodeURIComponent(stay.reservationNumber)}`}>مشاهده رزرو</Link>}
          </div>
        </form>
      )}
    </KoochCard>
  );
}
