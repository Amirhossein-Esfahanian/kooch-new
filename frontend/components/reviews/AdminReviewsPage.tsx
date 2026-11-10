"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochInput, KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { formatDateTime, type PagedResult } from "@/lib/account-reservations";
import { getAdminReview, getAdminReviews, moderateReview, setReviewPublication, moderationError, type AdminReview, type AdminReviewFilters } from "@/lib/admin-reviews";
import { reviewCategories, reviewDate, reviewStatus } from "@/lib/guest-reviews";
import { ReviewModerationNavigation } from "./ReviewModerationNavigation";

const initialFilters: AdminReviewFilters = { status: "PendingApproval", propertyId: "", search: "" };

function ModerationContent() {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<PagedResult<AdminReview> | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<AdminReview | null>(null);
  const [detailError, setDetailError] = useState("");
  const [action, setAction] = useState<"approve" | "reject" | "unpublish" | "republish" | null>(null);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const decisionRequest = useRef<AbortController | null>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const cancelDecision = useRef<HTMLButtonElement>(null);
  const reasonInput = useRef<HTMLDivElement>(null);
  const previousAction = useRef<typeof action>(null);
  useEffect(() => () => decisionRequest.current?.abort(), []);
  useEffect(() => {
    if (action) {
      previousAction.current = action;
      (action === "reject" || action === "unpublish" ? reasonInput.current?.querySelector("textarea") : cancelDecision.current)?.focus();
    } else if (previousAction.current && selectedId !== null) {
      (previousAction.current === "approve" || previousAction.current === "republish" ? approveButton.current : rejectButton.current)?.focus();
      previousAction.current = null;
    }
  }, [action, selectedId]);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    getAdminReviews(filters, page, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        if (result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages);
        else setData(result);
      }
    }).catch(failure => { if (!controller.signal.aborted) setError(moderationError(failure)); });
    return () => controller.abort();
  }, [filters, page, version]);
  useEffect(() => {
    setSelected(null); setDetailError(""); setAction(null); setReason("");
    if (selectedId === null) return;
    const controller = new AbortController();
    getAdminReview(selectedId, controller.signal).then(result => {
      if (!controller.signal.aborted) setSelected(result);
    }).catch(failure => { if (!controller.signal.aborted) setDetailError(moderationError(failure)); });
    return () => controller.abort();
  }, [selectedId, version]);
  function refresh() { if (!savingRef.current) { setSelectedId(null); setVersion(value => value + 1); } }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (savingRef.current) return;
    setPage(1); setSelectedId(null); setFilters({ ...draft }); setMessage("");
  }
  const reasonInvalid = reason.trim().length < 5 || reason.trim().length > 1000 || !/[\p{L}\p{N}]/u.test(reason);
  const needsReason = action === "reject" || action === "unpublish";
  const title = action === "unpublish" ? "لغو انتشار نظر" : action === "republish" ? "بازنشر نظر" : action === "reject" ? "رد نظر مهمان" : action === "approve" ? "تأیید و انتشار نظر" : "بررسی نظر مهمان";
  const confirmText = action === "unpublish" ? "ثبت دلیل و لغو انتشار" : action === "republish" ? "تأیید بازنشر" : action === "reject" ? "ثبت دلیل و رد نظر" : "تأیید و انتشار";
  const status = (item: AdminReview) => item.review.moderationStatus === "Approved" && !item.review.isPublished ? "لغو انتشارشده" : reviewStatus(item.review);
  async function decide() {
    if (!selected || !action || savingRef.current) return;
    setAttempted(true);
    if (needsReason && reasonInvalid) return;
    const controller = new AbortController(); decisionRequest.current = controller;
    savingRef.current = true; setSaving(true); setDetailError("");
    try {
      if (action === "unpublish" || action === "republish") await setReviewPublication(selected.review.id, selected.review.revision, action === "republish", reason.trim(), controller.signal);
      else await moderateReview(selected.review.id, selected.review.revision, action, reason.trim(), controller.signal);
      if (!controller.signal.aborted) {
        setAction(null); setSelectedId(null); setPage(1); setVersion(value => value + 1);
        setMessage(action === "unpublish" ? "نظر از نمایش و امتیازات عمومی خارج شد." : action === "republish" ? "نظر دوباره منتشر شد." : action === "approve" ? "نظر تأیید و منتشر شد." : "نظر رد شد؛ دلیل رد در حساب مهمان نمایش داده می‌شود.");
      }
    } catch (failure) {
      if (!controller.signal.aborted) { setAction(null); setDetailError(moderationError(failure)); setSelected(null); }
    } finally { savingRef.current = false; if (!controller.signal.aborted) setSaving(false); }
  }
  return <main dir="rtl" className="mx-auto w-full max-w-[1480px] space-y-6 p-4 lg:p-6">
    <KoochPageHeader eyebrow={null} appearance="plain" title="مدیریت نظرات" description="نظرهای مهمانان را بررسی کنید؛ تأیید هر نظر به معنی انتشار آن است." />
    <ReviewModerationNavigation active="reviews" />
    <KoochCard>
      <form onSubmit={filter} className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-2 text-sm">وضعیت<KoochSelect value={draft.status} disabled={saving} onChange={event => setDraft({ ...draft, status: event.target.value as AdminReviewFilters["status"] })}>
          <option value="PendingApproval">در انتظار تأیید</option><option value="Approved">تأییدشده</option><option value="Rejected">ردشده</option><option value="Unpublished">لغو انتشارشده</option><option value="All">همه</option>
        </KoochSelect></label>
        <label className="grid gap-2 text-sm">شناسه اقامتگاه<KoochInput type="number" min={1} max={2147483647} value={draft.propertyId} disabled={saving} onChange={event => setDraft({ ...draft, propertyId: event.target.value })} /></label>
        <label className="grid gap-2 text-sm">اقامتگاه یا شماره رزرو<KoochInput maxLength={200} value={draft.search} disabled={saving} onChange={event => setDraft({ ...draft, search: event.target.value })} /></label>
        <KoochButton type="submit" disabled={saving}>اعمال فیلتر</KoochButton>
      </form>
    </KoochCard>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">در انتظار تأیید: قدیمی‌ترین ارسال ابتدا نمایش داده می‌شود.</p>
      <KoochButton variant="outline" onClick={refresh} disabled={saving}>دریافت دوباره فهرست</KoochButton>
    </div>
    {message && <p role="status" className="text-sm leading-7">{message}</p>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !data ? <p role="status">در حال دریافت نظرات…</p> : <>
      {!data.items.length && <p role="status" className="py-8 text-center text-muted-foreground">نظری با این فیلتر وجود ندارد.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {data.items.map(item => <li key={item.review.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0 space-y-2">
            <h2 className="break-words font-semibold">{item.propertyName}</h2>
            <p className="text-sm">{item.guestDisplayName} · رزرو {item.reservationNumber ?? item.review.reservationId}</p>
            <p className="text-sm text-muted-foreground">ارسال: {formatDateTime(item.submittedAtUtc)}</p>
            <p className="text-sm">{status(item)} · امتیاز {item.review.overallRating.toLocaleString("fa-IR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} از ۱۰</p>
          </div>
          <KoochButton variant="outline" onClick={() => setSelectedId(item.review.id)} aria-label={`بررسی نظر ${item.review.id} برای ${item.propertyName}`}>بررسی نظر</KoochButton>
        </li>)}
      </ul>
      {data.totalPages > 1 && <nav aria-label="صفحه‌بندی نظرات" className="flex flex-wrap items-center gap-3">
        <KoochButton variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>صفحه قبل</KoochButton>
        <span className="text-sm tabular-nums">صفحه {page.toLocaleString("fa-IR")} از {data.totalPages.toLocaleString("fa-IR")}</span>
        <KoochButton variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>صفحه بعد</KoochButton>
      </nav>}
    </>}
    <KoochDialog open={selectedId !== null} onOpenChange={open => {
      if (!open && !savingRef.current) { if (action) setAction(null); else setSelectedId(null); }
    }} closeDisabled={saving} size="md" title={title}
      footer={selected && !detailError && selected.review.moderationStatus !== "Rejected" ? <div className="flex flex-wrap gap-3">
        {action ? <>
          <KoochButton ref={cancelDecision} variant="outline" disabled={saving} onClick={() => setAction(null)}>بازگشت به بررسی</KoochButton>
          <KoochButton loading={saving} disabled={needsReason && reasonInvalid} onClick={() => void decide()}>{confirmText}</KoochButton>
        </> : selected.review.moderationStatus === "Approved" ? selected.review.isPublished ?
          <KoochButton ref={rejectButton} variant="outline" onClick={() => { setAttempted(false); setReason(""); setAction("unpublish"); }}>لغو انتشار نظر</KoochButton> :
          <KoochButton ref={approveButton} onClick={() => setAction("republish")}>بازنشر نظر</KoochButton> : <>
          <KoochButton ref={approveButton} onClick={() => { setAttempted(false); setAction("approve"); }}>تأیید نظر</KoochButton>
          <KoochButton ref={rejectButton} variant="outline" onClick={() => { setAttempted(false); setReason(""); setAction("reject"); }}>رد نظر</KoochButton>
        </>}
      </div> : undefined}>
      {detailError ? <p role="alert" className="text-sm leading-7 text-destructive">{detailError}</p> : !selected ? <p role="status">در حال دریافت جزئیات…</p> : <div className="space-y-5">
        <h2 className="font-bold">{selected.propertyName} · اقامتگاه {selected.review.propertyId.toLocaleString("fa-IR")}</h2>
        <p className="text-sm">{selected.guestDisplayName} · رزرو {selected.reservationNumber ?? selected.review.reservationId}</p>
        <p className="text-sm">{reviewDate(selected.checkInDate)} تا {reviewDate(selected.checkOutDate)}</p>
        <p className="text-sm text-muted-foreground">ارسال: {formatDateTime(selected.submittedAtUtc)} · نسخه {selected.review.revision.toLocaleString("fa-IR")}</p>
        <p className="text-sm">{status(selected)} · {selected.review.isPublished ? "منتشرشده" : "منتشرنشده"}</p>
        <p className="text-lg font-bold tabular-nums">امتیاز کلی: {selected.review.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} از ۱۰</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{reviewCategories.map(([key, label]) => <div key={key} className="flex justify-between gap-3"><dt>{label}</dt><dd className="tabular-nums">{selected.review[key].toLocaleString("fa-IR")}</dd></div>)}</dl>
        <p className="whitespace-pre-wrap break-words text-sm leading-7">{selected.review.comment || "بدون توضیح"}</p>
        {selected.review.rejectionReason && <p className="whitespace-pre-wrap break-words text-sm leading-7">دلیل رد: {selected.review.rejectionReason}</p>}
        {selected.unpublicationReason && <p className="whitespace-pre-wrap break-words text-sm leading-7">دلیل داخلی لغو انتشار: {selected.unpublicationReason}</p>}
        {selected.moderatedAtUtc && <p className="text-sm text-muted-foreground">تصمیم: {formatDateTime(selected.moderatedAtUtc)} · مدیر {selected.moderatedByUserId?.toLocaleString("fa-IR")}</p>}
        {action && <section aria-label="تأیید تصمیم" className="space-y-3 border-t border-border pt-4">
          <p role="status" className="text-sm leading-7">{action === "unpublish" ? "نظر و پاسخ آن از نمایش و میانگین عمومی خارج می‌شوند؛ دلیل زیر فقط داخلی است. متن و امتیاز مهمان حفظ می‌شود." : action === "republish" ? "این نظر تأییدشده بدون تغییر متن یا امتیاز دوباره عمومی می‌شود. بازنشر را تأیید می‌کنید؟" : action === "reject" ? "دلیل روشن و محترمانه بنویسید؛ این متن به مهمان نمایش داده می‌شود." : "این نظر پس از تأیید، منتشرشده محسوب می‌شود. امتیاز و متن را بررسی کرده‌اید؟"}</p>
          {needsReason && <div ref={reasonInput} className="grid gap-2 text-start">
            <label htmlFor="review-rejection-reason" className="text-sm font-medium">{action === "unpublish" ? "دلیل داخلی لغو انتشار (الزامی)" : "دلیل رد نظر (الزامی)"}</label>
            <KoochTextarea id="review-rejection-reason" maxLength={1000} value={reason} disabled={saving} onChange={event => setReason(event.target.value)} aria-invalid={(attempted || reason.length > 0) && reasonInvalid} aria-describedby="review-rejection-help" />
            <p id="review-rejection-help" role={(attempted || reason.length > 0) && reasonInvalid ? "alert" : undefined} className="text-sm text-muted-foreground">دلیل باید روشن و بین ۵ تا ۱۰۰۰ نویسه باشد؛ امتیاز پایین به‌تنهایی دلیل رد نیست.</p>
          </div>}
        </section>}
      </div>}
    </KoochDialog>
  </main>;
}

export function AdminReviewsPage() {
  const session = useAuthSession();
  const allowed = !session.loading && session.authenticated && session.workspaces.includes("admin") && session.platformRole === "SuperAdmin";
  return <AdminLayout requiredPlatformPermission="ManageReviews">
    {allowed ? <ModerationContent key={session.user?.userId} /> : <p role={session.loading ? "status" : "alert"}>مدیریت نظرات فقط برای مدیر کل سامانه مجاز است.</p>}
  </AdminLayout>;
}
