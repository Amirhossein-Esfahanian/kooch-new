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
import { reviewStatus } from "@/lib/guest-reviews";
import { ReviewModerationNavigation } from "./ReviewModerationNavigation";
import { AdminReviewDetail } from "./AdminReviewDetail";
import styles from "./AdminReviewsPage.module.css";

const initialFilters: AdminReviewFilters = { status: "All", propertyId: "", search: "" };

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
  function updateFilters(next: AdminReviewFilters) {
    if (savingRef.current) return;
    setDraft(next); setFilters(next); setPage(1); setSelectedId(null); setMessage("");
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
    <ReviewModerationNavigation />
    <KoochCard>
      <form onSubmit={filter} className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-2 text-sm">وضعیت<KoochSelect value={draft.status} disabled={saving} onChange={event => updateFilters({ ...draft, status: event.target.value as AdminReviewFilters["status"] })}>
          <option value="All">همه نظرات</option><option value="PendingApproval">در انتظار تأیید</option><option value="Approved">تأییدشده</option><option value="Rejected">ردشده</option><option value="Unpublished">لغو انتشارشده</option>
        </KoochSelect></label>
        <label className="grid gap-2 text-sm">شناسه اقامتگاه<KoochInput type="number" min={1} max={2147483647} value={draft.propertyId} disabled={saving} onChange={event => updateFilters({ ...draft, propertyId: event.target.value })} /></label>
        <label className="grid gap-2 text-sm">اقامتگاه یا شماره رزرو<KoochInput maxLength={200} value={draft.search} disabled={saving} onChange={event => updateFilters({ ...draft, search: event.target.value })} /></label>
        <KoochButton type="submit" disabled={saving}>اعمال فیلتر</KoochButton>
      </form>
    </KoochCard>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">جدیدترین ارسال‌ها ابتدا نمایش داده می‌شوند.</p>
      <KoochButton variant="outline" onClick={refresh} disabled={saving}>دریافت دوباره فهرست</KoochButton>
    </div>
    {message && <p role="status" className="text-sm leading-7">{message}</p>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !data ? <p role="status">در حال دریافت نظرات…</p> : <>
      {!data.items.length && <p role="status" className="py-8 text-center text-muted-foreground">نظری با این فیلتر وجود ندارد.</p>}
      <ul className={styles.list} aria-label="فهرست نظرات مهمانان">
        {data.items.map(item => <li key={item.review.id} className={styles.row}>
          <h2 className={styles.guest}>{item.guestDisplayName}</h2>
          <div className={styles.property}><p>{item.propertyName}</p><p>رزرو {item.reservationNumber ?? item.review.reservationId}</p></div>
          <p className={styles.score}><strong>{item.review.overallRating.toLocaleString("fa-IR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</strong><span> /۱۰</span></p>
          <div className={styles.meta}><p className={styles.status}>{status(item)}</p><time dateTime={item.submittedAtUtc}>{formatDateTime(item.submittedAtUtc)}</time></div>
          <KoochButton className={styles.reviewAction} variant="outline" size="sm" onClick={() => setSelectedId(item.review.id)} aria-label={`بررسی نظر ${item.review.id} برای ${item.propertyName}`}>بررسی</KoochButton>
        </li>)}
      </ul>
      <nav aria-label="صفحه‌بندی نظرات" className={styles.pagination}>
        <p className={styles.total}>تعداد کل: {data.totalCount.toLocaleString("fa-IR")} نظر</p>
        <KoochButton variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>صفحه قبل</KoochButton>
        <span className="text-sm tabular-nums">صفحه {page.toLocaleString("fa-IR")} از {Math.max(1, data.totalPages).toLocaleString("fa-IR")}</span>
        <KoochButton variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>صفحه بعد</KoochButton>
      </nav>
    </>}
    <KoochDialog open={selectedId !== null} onOpenChange={open => {
      if (!open && !savingRef.current) { if (action) setAction(null); else setSelectedId(null); }
    }} closeDisabled={saving} size="md" title={title} contentClassName={styles.dialog} bodyClassName={styles.dialogBody}
      footer={selected && !detailError && selected.review.moderationStatus !== "Rejected" ? <div className={styles.actionFooter}>
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
        <AdminReviewDetail item={selected} status={status(selected)} />
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
