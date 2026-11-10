"use client";
import { useEffect, useRef, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { useOwnerProperty } from "@/components/owner/OwnerPropertyProvider";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochButton } from "@/components/KoochButton";
import { KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochDialog } from "@/components/KoochDialog";
import { PublishedReviewContent } from "./PublishedReviews";
import { getOwnerReviews, propertyReviewError, saveOwnerReply, type OwnerReview, type OwnerReviewFilter } from "@/lib/property-reviews";
import type { PagedResult } from "@/lib/account-reservations";

function OwnerReviewContent({ propertyId, canReply }: { propertyId: number; canReply: boolean }) {
  const [filter, setFilter] = useState<OwnerReviewFilter>("All");
  const [page, setPage] = useState(1); const [version, setVersion] = useState(0);
  const [data, setData] = useState<PagedResult<OwnerReview> | null>(null); const [error, setError] = useState("");
  const [selected, setSelected] = useState<OwnerReview | null>(null); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false); const saving = useRef(false); const request = useRef<AbortController | null>(null);
  const [saveError, setSaveError] = useState(""); const [message, setMessage] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    getOwnerReviews(propertyId, filter, page, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages); else setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(propertyReviewError(failure)); });
    return () => controller.abort();
  }, [propertyId, filter, page, version]);
  async function save() {
    if (!selected || !canReply || saving.current || needsReload || !body.trim() || body.trim().length > 2000) return;
    const controller = new AbortController(); request.current = controller; saving.current = true; setBusy(true); setSaveError("");
    try {
      await saveOwnerReply(propertyId, selected.review.id, body.trim(), selected.reply?.revision, controller.signal);
      if (!controller.signal.aborted) { setSelected(null); setPage(1); setVersion(v => v + 1); setMessage("پاسخ برای تأیید مدیر کل ارسال شد؛ نسخهٔ جدید هنوز عمومی نیست."); }
    } catch (failure) { if (!controller.signal.aborted) { setSaveError(propertyReviewError(failure)); setNeedsReload(true); } }
    finally { saving.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  return <main dir="rtl" className="mx-auto max-w-[1480px] space-y-6 p-4 lg:p-6">
    <KoochPageHeader eyebrow={null} appearance="plain" title="نظرات اقامتگاه" description="نظرهای منتشرشدهٔ اقامتگاه فعال و وضعیت پاسخ رسمی را ببینید." />
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="grid gap-2 text-sm">وضعیت پاسخ<KoochSelect value={filter} onChange={event => { setFilter(event.target.value as OwnerReviewFilter); setPage(1); }}><option value="All">همه</option><option value="Unanswered">بدون پاسخ</option><option value="PendingApproval">پاسخ در انتظار تأیید</option><option value="Answered">پاسخ‌داده‌شده</option></KoochSelect></label><KoochButton variant="outline" onClick={() => setVersion(v => v + 1)}>دریافت دوباره فهرست</KoochButton></div>
    {message && <p role="status">{message}</p>}
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">در حال دریافت نظرات…</p> : <>
      {!data.items.length && <p role="status">نظر منتشرشده‌ای با این فیلتر وجود ندارد.</p>}
      <ul className="divide-y divide-border">{data.items.map(item => <li key={item.review.id} className="space-y-4 py-6"><PublishedReviewContent review={item.review} />
        {item.reply && <div className="space-y-2 text-sm"><p>نسخهٔ پاسخ: {item.reply.moderationStatus === "PendingApproval" ? "در انتظار تأیید" : item.reply.moderationStatus === "Rejected" ? "ردشده" : "تأییدشده"}</p>
          {item.reply.moderationStatus !== "Approved" && <p className="whitespace-pre-wrap break-words leading-7">{item.reply.body}</p>}
          {item.reply.rejectionReason && <p className="whitespace-pre-wrap break-words">دلیل رد پاسخ: {item.reply.rejectionReason}</p>}
          {item.reply.publishedBody && item.reply.moderationStatus !== "Approved" && <p className="text-muted-foreground">نسخهٔ تأییدشدهٔ قبلی همچنان عمومی است.</p>}</div>}
        {canReply && <KoochButton variant="outline" onClick={() => { setSelected(item); setBody(item.reply?.body ?? ""); setSaveError(""); setNeedsReload(false); }}>{item.reply ? "ویرایش پاسخ" : "ثبت پاسخ اقامتگاه"}</KoochButton>}
      </li>)}</ul>
      {data.totalPages > 1 && <nav aria-label="صفحه‌بندی نظرات اقامتگاه" className="flex flex-wrap items-center gap-3"><KoochButton variant="outline" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>صفحه قبل</KoochButton><span>صفحه {page.toLocaleString("fa-IR")} از {data.totalPages.toLocaleString("fa-IR")}</span><KoochButton variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(v => v + 1)}>صفحه بعد</KoochButton></nav>}
    </>}
    <KoochDialog open={selected !== null} size="md" closeDisabled={busy} onOpenChange={open => { if (!open && !saving.current) setSelected(null); }} title="پاسخ رسمی اقامتگاه" description="پاسخ جدید یا ویرایش‌شده فقط پس از تأیید مدیر کل عمومی می‌شود."
      footer={needsReload ? <KoochButton variant="outline" onClick={() => { setSelected(null); setVersion(v => v + 1); }}>دریافت اطلاعات تازه</KoochButton> : <KoochButton loading={busy} disabled={!body.trim() || body.trim().length > 2000 || !canReply} onClick={() => void save()}>ارسال پاسخ برای تأیید</KoochButton>}>
      <label htmlFor="owner-review-reply" className="mb-2 block text-sm font-semibold">متن پاسخ (الزامی)</label><KoochTextarea id="owner-review-reply" maxLength={2000} value={body} disabled={busy} onChange={event => setBody(event.target.value)} aria-describedby="owner-review-reply-help" /><p id="owner-review-reply-help" className="mt-2 text-sm text-muted-foreground">حداکثر ۲۰۰۰ نویسه؛ این پاسخ یک گفت‌وگو یا مسیر اعتراض نیست.</p>
      {saveError && <p role="alert" className="mt-3 text-sm text-destructive">{saveError}</p>}
    </KoochDialog>
  </main>;
}
export function OwnerReviewsPage() {
  const property = useOwnerProperty(); const session = useAuthSession();
  const allowed = !session.loading && session.authenticated && session.workspaces.includes("owner") && property.routePropertyIsValid && property.propertyId !== null && property.effectivePermissions?.Reviews?.view;
  return <OwnerLayout>{allowed && property.propertyId ? <OwnerReviewContent key={`${session.user?.userId}-${property.propertyId}`} propertyId={property.propertyId} canReply={Boolean(property.effectivePermissions?.Reviews?.edit)} /> : <p role="status" className="p-6">اقامتگاه مجاز با دسترسی مشاهدهٔ نظرات را از منوی اصلی انتخاب کنید.</p>}</OwnerLayout>;
}
