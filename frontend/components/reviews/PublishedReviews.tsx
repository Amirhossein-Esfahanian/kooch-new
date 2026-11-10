"use client";
import { KoochButton } from "@/components/KoochButton";
import { reviewCategories, type ReviewScoreKey } from "@/lib/guest-reviews";
import { formatDateTime } from "@/lib/account-reservations";
import type { PublicGuestReview, PublicReviewPage } from "@/lib/property-reviews";

export function ReviewScoreList({ scores }: { scores: Partial<Record<ReviewScoreKey, number | null>> }) {
  return <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
    {reviewCategories.map(([key, label]) => <div className="flex justify-between gap-3" key={key}><dt>{label}</dt><dd className="tabular-nums">{scores[key]?.toLocaleString("fa-IR", { maximumFractionDigits: 1 }) ?? "—"}</dd></div>)}
  </dl>;
}
export function PublishedRating({ summary }: { summary: PublicReviewPage["summary"] | null }) {
  if (!summary) return <p role="status">در حال دریافت امتیاز…</p>;
  if (summary.count === 0 || summary.overallRating === null) return <p>هنوز امتیازی ثبت نشده</p>;
  return <p className="text-sm leading-7"><strong className="text-xl tabular-nums">{summary.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> از ۱۰ — بر اساس {summary.count.toLocaleString("fa-IR")} نظر</p>;
}
export function PublishedReviewContent({ review }: { review: PublicGuestReview }) {
  return <div className="min-w-0 space-y-4 break-words">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">{review.guestDisplayName}</p><p className="text-sm text-muted-foreground">{formatDateTime(review.submittedAtUtc)}</p></div>
    <p className="font-semibold tabular-nums">امتیاز کلی: {review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} از ۱۰</p>
    <ReviewScoreList scores={review} />
    <p className="whitespace-pre-wrap text-sm leading-7">{review.comment || "بدون توضیح"}</p>
    {review.ownerReply && <div className="space-y-2 rounded-lg bg-muted p-4"><h4 className="text-sm font-bold">پاسخ اقامتگاه</h4><p className="whitespace-pre-wrap text-sm leading-7">{review.ownerReply.text}</p></div>}
  </div>;
}
export function PublishedReviewList({ data, error, page, onPage, retry }: {
  data: PublicReviewPage | null; error: boolean; page: number; onPage: (page: number) => void; retry: () => void;
}) {
  if (error) return <div className="space-y-3"><p role="alert">نظرات در حال حاضر در دسترس نیست.</p><KoochButton variant="outline" onClick={retry}>دریافت دوباره نظرات</KoochButton></div>;
  if (!data) return <p role="status">در حال دریافت نظرات…</p>;
  return <div className="space-y-6">
    <PublishedRating summary={data.summary} />
    {data.summary.count > 0 && <><ReviewScoreList scores={data.summary.categories} /><ul className="divide-y divide-border">{data.reviews.items.map(review => <li key={review.id} className="py-6"><PublishedReviewContent review={review} /></li>)}</ul></>}
    {data.reviews.totalPages > 1 && <nav aria-label="صفحه‌بندی نظرات مهمانان" className="flex flex-wrap items-center gap-3"><KoochButton variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>صفحه قبل</KoochButton><span className="text-sm">صفحه {page.toLocaleString("fa-IR")} از {data.reviews.totalPages.toLocaleString("fa-IR")}</span><KoochButton variant="outline" disabled={page >= data.reviews.totalPages} onClick={() => onPage(page + 1)}>صفحه بعد</KoochButton></nav>}
  </div>;
}
