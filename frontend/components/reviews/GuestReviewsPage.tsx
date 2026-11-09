"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { GuestReviewForm } from "@/components/reviews/GuestReviewForm";
import { ReviewInvitationOptOut } from "@/components/reviews/ReviewInvitationOptOut";
import type { PagedResult } from "@/lib/account-reservations";
import { getEligibleReviewStays, getGuestReviews, reviewCategories, reviewDate, reviewError, reviewLinkClass, reviewStatus,
  type EligibleReviewStay, type GuestReviewListItem } from "@/lib/guest-reviews";

function useReviewPage<T>(fetchPage: (page: number, signal?: AbortSignal) => Promise<PagedResult<T>>, page: number, version: number) {
  const [data, setData] = useState<PagedResult<T> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    fetchPage(page, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(reviewError(failure)); });
    return () => controller.abort();
  }, [fetchPage, page, version]);
  return { data, error };
}

function Pagination({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label: string }) {
  if (pages <= 1) return null;
  return <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-3">
    <KoochButton variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>صفحه قبل</KoochButton>
    <span className="text-sm tabular-nums">صفحه {page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}</span>
    <KoochButton variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>صفحه بعد</KoochButton>
  </nav>;
}

function ReviewFailure({ message }: { message: string }) {
  return <div className="mt-3">
    <p role="alert" className="text-sm leading-7 text-destructive">{message}</p>
    {message.includes("نشست") && <Link href="/login?returnTo=%2Faccount%2Freviews" className={reviewLinkClass}>ورود دوباره</Link>}
  </div>;
}

function ReviewsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedPageValue = Number(params.get("eligiblePage") ?? "1");
  const requestedPage = Number.isInteger(requestedPageValue) && requestedPageValue >= 1 && requestedPageValue <= 100000 ? requestedPageValue : 1;
  const [eligiblePage, setEligiblePage] = useState(requestedPage);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<EligibleReviewStay | null>(null);
  const [message, setMessage] = useState("");
  const listHeading = useRef<HTMLHeadingElement>(null);
  const eligible = useReviewPage(getEligibleReviewStays, eligiblePage, version);
  const submitted = useReviewPage(getGuestReviews, reviewsPage, version);
  const requested = params.get("reservationId");
  const handled = useRef<string | null>(null);
  useEffect(() => { if (requested) setEligiblePage(requestedPage); }, [requested, requestedPage]);
  useEffect(() => {
    if (!requested || handled.current === requested || !eligible.data || eligible.data.page !== requestedPage) return;
    handled.current = requested;
    const stay = /^[1-9]\d{0,9}$/.test(requested)
      ? eligible.data.items.find(item => String(item.reservationId) === requested) : undefined;
    if (stay) setSelected(stay);
    else setMessage("اقامت انتخاب‌شده در فهرست مجاز این صفحه نیست. اقامت‌های قابل ثبت نظر را بررسی کنید.");
  }, [requested, requestedPage, eligible.data]);
  function closeForm() {
    setSelected(null); router.replace("/account/reviews", { scroll: false });
    listHeading.current?.focus();
  }
  function refresh() {
    closeForm(); setVersion(value => value + 1);
  }
  return <main dir="rtl" className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
    <div className="mx-auto grid max-w-5xl gap-6">
      <KoochPageHeader eyebrow="محیط مهمان" title="نظرات من" description="اقامت‌های قابل ارزیابی و وضعیت نظرهای ارسال‌شده خود را ببینید." />
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/account" className={reviewLinkClass}>بازگشت به حساب کاربری</Link>
        <KoochButton variant="outline" onClick={refresh}>دریافت دوباره فهرست</KoochButton>
      </div>
      {message && <p className="rounded-lg border border-border bg-muted p-4 text-sm leading-7" role="status">{message}</p>}
      {selected && <GuestReviewForm key={selected.reservationId} stay={selected} onClose={closeForm} onSaved={() => {
        refresh(); setMessage("نظر شما ثبت شد و در انتظار تأیید است؛ هنوز منتشر نشده است.");
      }} />}
      <KoochCard aria-labelledby="eligible-heading">
        <h2 id="eligible-heading" ref={listHeading} tabIndex={-1} className="text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">اقامت‌های قابل ثبت نظر</h2>
        {eligible.error ? <ReviewFailure message={eligible.error} /> : !eligible.data ? <p role="status" className="py-5 text-sm text-muted-foreground">در حال دریافت اقامت‌ها…</p> : <>
          {!eligible.data.items.length && <p className="mt-3 text-sm leading-7 text-muted-foreground">اکنون اقامت واجد شرایطی برای ثبت یا ویرایش نظر ندارید. پس از اقامت تکمیل‌شده، تا ۳۰ روز از خروج می‌توانید نظر بدهید.</p>}
          <ul className="mt-3 divide-y divide-border">
            {eligible.data.items.map(stay => <li key={stay.reservationId} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div><h3 className="font-semibold">{stay.propertyName}</h3><p className="mt-1 text-sm text-muted-foreground">خروج: {reviewDate(stay.checkOutDate)} · مهلت: {reviewDate(stay.submissionDeadlineLocalDate)}</p></div>
              <div className="grid gap-2">
                <KoochButton variant="outline" onClick={() => { setSelected(stay); setMessage(""); }} aria-label={`${stay.reviewId === null ? "ثبت نظر" : "ویرایش نظر"} برای ${stay.propertyName}`}>{stay.reviewId === null ? "ثبت نظر" : "ویرایش نظر"}</KoochButton>
                {stay.reviewId === null && <ReviewInvitationOptOut stay={stay} />}
              </div>
            </li>)}
          </ul>
          <Pagination label="صفحه‌بندی اقامت‌های قابل ثبت نظر" page={eligiblePage} pages={eligible.data.totalPages} onChange={setEligiblePage} />
          {eligible.data.items.some(stay => stay.reviewId === null && !stay.invitationPreferenceAvailable) && <p className="mt-3 text-xs leading-6 text-muted-foreground">تنظیم یادآوری دائمی پس از تکمیل راه‌اندازی فعال می‌شود؛ ثبت نظر همچنان در دسترس است.</p>}
        </>}
      </KoochCard>
      <KoochCard aria-labelledby="submitted-heading">
        <h2 id="submitted-heading" className="text-lg font-bold">نظرهای ارسال‌شده</h2>
        {submitted.error ? <ReviewFailure message={submitted.error} /> : !submitted.data ? <p role="status" className="py-5 text-sm text-muted-foreground">در حال دریافت نظرها…</p> : <>
          {!submitted.data.items.length && <p className="mt-3 text-sm text-muted-foreground">هنوز نظری برای اقامت‌های تأییدشده ثبت نکرده‌اید.</p>}
          <ul className="mt-3 divide-y divide-border">
            {submitted.data.items.map(item => <li key={item.review.id} className="grid gap-3 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold">{item.propertyName}</h3><p className="mt-1 text-sm text-muted-foreground">{reviewDate(item.checkInDate)} تا {reviewDate(item.checkOutDate)}</p></div>
                <span className="rounded-md bg-muted px-3 py-2 text-sm font-semibold">{reviewStatus(item.review)}</span>
              </div>
              <p className="font-semibold tabular-nums">امتیاز کلی: {item.review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} از ۱۰</p>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{reviewCategories.map(([key, label]) => <div key={key} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{item.review[key].toLocaleString("fa-IR")}</dd></div>)}</dl>
              {item.review.comment && <p className="whitespace-pre-wrap break-words text-sm leading-7">{item.review.comment}</p>}
              <div className="flex flex-wrap gap-3">
                {item.canEdit ? <KoochButton variant="outline" onClick={() => { setMessage(""); setSelected({
                  reservationId: item.review.reservationId, reservationNumber: item.reservationNumber,
                  propertyId: item.review.propertyId, propertyName: item.propertyName, checkOutDate: item.checkOutDate,
                  submissionDeadlineLocalDate: item.submissionDeadlineLocalDate, reviewId: item.review.id, revision: item.review.revision,
                }); }}>{item.review.moderationStatus === "Rejected" ? "ویرایش و ارسال مجدد" : "ویرایش نظر"}</KoochButton> : <p className="text-sm text-muted-foreground">این نظر اکنون قابل ویرایش نیست.</p>}
                {item.reservationNumber && <Link className={reviewLinkClass} href={`/account/reservations/${encodeURIComponent(item.reservationNumber)}`}>مشاهده رزرو</Link>}
              </div>
            </li>)}
          </ul>
          <Pagination label="صفحه‌بندی نظرهای ارسال‌شده" page={reviewsPage} pages={submitted.data.totalPages} onChange={setReviewsPage} />
        </>}
      </KoochCard>
    </div>
  </main>;
}

export function GuestReviewsPage() {
  const session = useAuthSession();
  const router = useRouter();
  const allowed = session.authenticated && session.workspaces.includes("account");
  useEffect(() => {
    if (session.loading) return;
    if (!session.authenticated) router.replace("/login?returnTo=%2Faccount%2Freviews");
    else if (!allowed) router.replace(resolveSessionDestination(session));
  }, [allowed, router, session]);
  if (session.loading || !allowed) return <p role="status" className="p-6 text-center text-sm text-muted-foreground">در حال آماده‌سازی حساب کاربری…</p>;
  return <ReviewsContent key={session.user?.userId} />;
}
