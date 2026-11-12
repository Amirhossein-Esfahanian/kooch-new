"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochTextarea } from "@/components/KoochFormControls";
import { ScorePill } from "@/components/ScorePill";
import { getGuestReview, reviewCategories, reviewDate, reviewError, reviewLinkClass, saveGuestReview,
  type EligibleReviewStay, type GuestReviewRequest, type ReviewScoreKey } from "@/lib/guest-reviews";
import styles from "./GuestReviewForm.module.css";

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
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const baseline = useRef<{ scores: Partial<Record<ReviewScoreKey, string>>; comment: string }>({ scores: {}, comment: "" });
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const edit = stay.reviewId !== null;
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    if (edit) getGuestReview(stay.reservationId, controller.signal).then(review => {
      if (controller.signal.aborted) return;
      const savedScores = Object.fromEntries(reviewCategories.map(([key]) => [key, String(review[key])]));
      baseline.current = { scores: savedScores, comment: review.comment };
      setScores(savedScores);
      setComment(review.comment); setRevision(review.revision); setLoading(false);
    }).catch(failure => {
      if (!controller.signal.aborted) { setError(reviewError(failure)); setLoadFailed(true); setLoading(false); }
    });
    return () => controller.abort();
  }, [edit, stay.reservationId]);
  const complete = reviewCategories.every(([key]) => /^[1-9]$|^10$/.test(scores[key] ?? ""));
  const average = complete ? reviewCategories.reduce((sum, [key]) => sum + Number(scores[key]), 0) / 6 : null;
  const dirty = comment !== baseline.current.comment || reviewCategories.some(([key]) => (scores[key] ?? "") !== (baseline.current.scores[key] ?? ""));
  useEffect(() => {
    if (confirmDiscard) keepEditing.current?.focus();
    else heading.current?.focus();
  }, [step, confirmDiscard, loading]);

  function requestClose() {
    if (inFlight.current) return;
    if (confirmDiscard) setConfirmDiscard(false);
    else if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  // Only the final action calls this; implicit/native form submission is deliberately suppressed.
  async function submit() {
    if (step !== 2 || confirmDiscard || inFlight.current || loading || loadFailed) return;
    setAttempted(true); setError("");
    if (!complete || comment.length > 4000) {
      const invalid = reviewCategories.find(([key]) => !scores[key]);
      if (invalid) form.current?.querySelector<HTMLInputElement>(`input[name="${invalid[0]}"]`)?.focus();
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
    <KoochDialog open onOpenChange={open => { if (!open) requestClose(); }} closeDisabled={busy}
      title={`${edit ? "ویرایش نظر" : "ثبت نظر"} — ${stay.propertyName}`} size="md" dir="rtl"
      description={`خروج: ${reviewDate(stay.checkOutDate)} · مهلت ثبت و ویرایش: ${reviewDate(stay.submissionDeadlineLocalDate)}`}
      initialFocusRef={heading} className={styles.dialog} bodyClassName={styles.body} footerClassName={styles.footer}
      footer={confirmDiscard ? <div className={styles.buttons}>
        <KoochButton type="button" variant="outline" ref={keepEditing} onClick={() => setConfirmDiscard(false)}>ادامه ویرایش</KoochButton>
        <KoochButton type="button" variant="destructive" onClick={onClose}>صرف‌نظر از تغییرات</KoochButton>
      </div> : <div className={styles.actions}>
        <div className={styles.buttons}>
          {step === 1 ? <KoochButton key="continue" type="button" disabled={loading || loadFailed || !complete} onClick={event => { event.preventDefault(); setStep(2); }}>ادامه</KoochButton>
            : <KoochButton key="submit-review" type="button" form={formId} onClick={() => void submit()} loading={busy} disabled={loadFailed || !complete || (edit && revision === undefined)}>{edit ? "ذخیره و ارسال برای بررسی" : "ارسال نظر برای بررسی"}</KoochButton>}
          {step === 2 && <KoochButton type="button" variant="outline" disabled={busy} onClick={() => setStep(1)}>بازگشت به امتیازها</KoochButton>}
          <KoochButton type="button" variant="outline" disabled={busy} onClick={requestClose}>بازگشت به فهرست</KoochButton>
        </div>
        {stay.reservationNumber && <Link className={`${reviewLinkClass} ${styles.reservationLink}`} href={`/account/reservations/${encodeURIComponent(stay.reservationNumber)}`}>مشاهده رزرو</Link>}
      </div>}>
      {confirmDiscard ? <KoochAlert variant="question" title="تغییرات ذخیره‌نشده" role="alert">
        امتیازها یا متن نظر تغییر کرده‌اند. بدون ثبت از این فرم خارج می‌شوید؟
      </KoochAlert> : <>
      <ol className={styles.steps} aria-label="مراحل ثبت نظر"><li aria-current={step === 1 ? "step" : undefined}>۱. امتیازدهی</li><li aria-current={step === 2 ? "step" : undefined}>۲. بررسی و ثبت</li></ol>
      <h3 className={styles.stepTitle} tabIndex={-1} ref={heading}>{step === 1 ? "امتیازدهی" : "بررسی و ثبت"}</h3>
      {stay.reservationNumber && <p className={styles.context}>رزرو: <bdi dir="ltr">{stay.reservationNumber}</bdi></p>}
      {loading ? <p className="py-6" role="status">در حال دریافت نظر…</p> : (
        <form id={formId} ref={form} className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); event.stopPropagation(); }} noValidate aria-busy={busy}>
          {step === 1 ? <>
          <p className={styles.context}>برای هر بخش امتیازی از ۱ تا ۱۰ انتخاب کنید. متن نظر اختیاری است و نظر پس از بررسی منتشر می‌شود.</p>
          <fieldset disabled={busy || loadFailed} className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
            <legend className="mb-2 font-semibold">امتیازهای اقامت (همه الزامی)</legend>
            {reviewCategories.map(([key, label]) => {
              const invalid = attempted && !scores[key];
              return <div className="grid min-w-0 content-start gap-1" key={key}>
                <ScorePill name={key} label={label} required value={scores[key] ? Number(scores[key]) : null}
                  onChange={score => setScores(current => ({ ...current, [key]: String(score) }))}
                  disabled={busy || loadFailed} invalid={Boolean(invalid)} describedBy={invalid ? `${key}-error` : undefined} />
                {invalid && <p className="text-sm text-destructive" id={`${key}-error`} role="alert">امتیاز {label} را انتخاب کنید.</p>}
              </div>;
            })}
          </fieldset>
          </> : <dl className={styles.summary} aria-label="امتیازهای انتخاب‌شده">{reviewCategories.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Number(scores[key]).toLocaleString("fa-IR")}</dd></div>)}</dl>}
          <output className="rounded-lg bg-muted px-4 py-2 text-sm font-semibold tabular-nums" aria-live="polite" aria-label="میانگین امتیاز">میانگین: {average === null ? "پس از انتخاب شش امتیاز" : `${average.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} از ۱۰`}</output>
          {step === 2 && <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="review-comment">تجربه شما (اختیاری)</label>
            <KoochTextarea id="review-comment" value={comment} onChange={event => setComment(event.target.value)} maxLength={4000} disabled={busy || loadFailed} aria-describedby="review-comment-help" />
            <p className="text-sm leading-6 text-muted-foreground" id="review-comment-help">{average !== null && average <= 3 ? "اگر مایلید، توضیح دهید چه چیزی می‌توانست بهتر باشد؛ نوشتن توضیح همچنان اختیاری است." : "حداکثر ۴۰۰۰ نویسه. اطلاعات شخصی یا حساس را در نظر ننویسید."}</p>
          </div>}
          {error && <p className="text-sm leading-7 text-destructive" role="alert">{error}</p>}
          {error.includes("نشست") && <Link className={reviewLinkClass} href="/login?returnTo=%2Faccount%2Freviews">ورود دوباره</Link>}
        </form>
      )}
      </>}
    </KoochDialog>
  );
}
