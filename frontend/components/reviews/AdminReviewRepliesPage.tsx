"use client";
import { useEffect, useRef, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminOwnerReplyDetail } from "./AdminOwnerReplyDetail";
import styles from "./AdminReviewsPage.module.css";
import { ReviewModerationNavigation } from "./ReviewModerationNavigation";
import { getAdminReplies, moderateOwnerReply, propertyReviewError, type AdminOwnerReply } from "@/lib/property-reviews";
import { formatDateTime, type PagedResult } from "@/lib/account-reservations";

function ReplyQueue() {
  const [status, setStatus] = useState("All"); const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0); const [data, setData] = useState<PagedResult<AdminOwnerReply> | null>(null);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<AdminOwnerReply | null>(null);
  const [action, setAction] = useState<"approve" | "reject" | null>(null); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const saving = useRef(false); const request = useRef<AbortController | null>(null);
  const [decisionError, setDecisionError] = useState("");
  const approve = useRef<HTMLButtonElement>(null); const reject = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null); const reasonField = useRef<HTMLDivElement>(null);
  const previousAction = useRef<typeof action>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (action) { previousAction.current = action; (action === "reject" ? reasonField.current?.querySelector("textarea") : cancel.current)?.focus(); }
    else if (previousAction.current && selected) { (previousAction.current === "reject" ? reject.current : approve.current)?.focus(); previousAction.current = null; }
  }, [action, selected]);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    getAdminReplies(status, page, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages); else setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(propertyReviewError(failure)); });
    return () => controller.abort();
  }, [status, page, version]);
  const invalidReason = reason.trim().length < 5 || reason.trim().length > 1000 || !/[\p{L}\p{N}]/u.test(reason);
  async function decide() {
    if (!selected || !action || saving.current || action === "reject" && invalidReason) return;
    saving.current = true; setBusy(true); setDecisionError(""); const controller = new AbortController(); request.current = controller;
    try {
      await moderateOwnerReply(selected.reply.id, selected.reply.revision, action, reason.trim(), controller.signal);
      if (!controller.signal.aborted) { setSelected(null); setAction(null); setPage(1); setVersion(v => v + 1); setMessage(action === "approve" ? "پاسخ اقامتگاه تأیید شد و نسخهٔ تأییدشده عمومی است." : "پاسخ رد شد؛ دلیل رد برای اقامتگاه قابل مشاهده است."); }
    } catch (failure) {
      if (!controller.signal.aborted) { setAction(null); setDecisionError(propertyReviewError(failure)); }
    } finally { saving.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  const label = (value: string) => value === "PendingApproval" ? "پاسخ در انتظار تأیید" : value === "Rejected" ? "پاسخ ردشده" : "پاسخ تأییدشده";
  return <main dir="rtl" className="mx-auto w-full max-w-[1480px] space-y-6 p-4 lg:p-6">
    <KoochPageHeader eyebrow={null} appearance="plain" title="بررسی پاسخ‌های اقامتگاه" description="پاسخ رسمی اقامتگاه جدا از نظر مهمان بررسی می‌شود؛ متن یا امتیاز مهمان تغییر نمی‌کند." />
    <ReviewModerationNavigation />
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="grid gap-2 text-sm">وضعیت پاسخ<KoochSelect value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="PendingApproval">در انتظار تأیید</option><option value="Approved">تأییدشده</option><option value="Rejected">ردشده</option><option value="All">همه</option></KoochSelect></label><KoochButton variant="outline" onClick={() => { setSelected(null); setVersion(v => v + 1); }}>دریافت دوباره پاسخ‌ها</KoochButton></div>
    {message && <p role="status">{message}</p>}
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">در حال دریافت پاسخ‌ها…</p> : <>
      {!data.items.length && <p role="status">پاسخی با این وضعیت برای بررسی وجود ندارد.</p>}
      <ul className={styles.list} aria-label="فهرست پاسخ‌های اقامتگاه">{data.items.map(item => <li className={styles.row} key={item.reply.id}>
        <h2 className={styles.guest}>{item.guestReview.guestDisplayName}</h2>
        <div className={styles.property}><p>{item.propertyName}</p><p>نظر {item.reply.reviewId.toLocaleString("fa-IR")}</p></div>
        <p className={styles.score}><strong>{item.guestReview.overallRating.toLocaleString("fa-IR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><span> /۱۰</span></p>
        <div className={styles.meta}><p className={styles.status}>{label(item.reply.moderationStatus)}</p>{item.submittedAtUtc ? <time dateTime={item.submittedAtUtc}>{formatDateTime(item.submittedAtUtc)}</time> : <p>زمان ارسال در دسترس نیست</p>}</div>
        <KoochButton className={styles.reviewAction} size="sm" variant="outline" onClick={() => { setSelected(item); setAction(null); setReason(""); setDecisionError(""); }}>بررسی پاسخ</KoochButton>
      </li>)}</ul>
      <nav aria-label="صفحه‌بندی پاسخ‌های اقامتگاه" className={styles.pagination}><p className={styles.total}>تعداد کل: {data.totalCount.toLocaleString("fa-IR")} پاسخ</p><KoochButton variant="outline" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>صفحه قبل</KoochButton><span>صفحه {page.toLocaleString("fa-IR")} از {Math.max(1, data.totalPages).toLocaleString("fa-IR")}</span><KoochButton variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(v => v + 1)}>صفحه بعد</KoochButton></nav>
    </>}
    <KoochDialog open={selected !== null} closeDisabled={busy} size="md" contentClassName={styles.dialog} bodyClassName={styles.dialogBody} title={action === "reject" ? "رد پاسخ اقامتگاه" : action === "approve" ? "تأیید پاسخ اقامتگاه" : "بررسی پاسخ اقامتگاه"} onOpenChange={open => { if (!open && !saving.current) { if (action) setAction(null); else setSelected(null); } }}
      footer={selected?.reply.moderationStatus === "PendingApproval" && !decisionError ? <div className={styles.actionFooter}>{action ? <><KoochButton ref={cancel} variant="outline" disabled={busy} onClick={() => setAction(null)}>بازگشت به بررسی پاسخ</KoochButton><KoochButton loading={busy} disabled={action === "reject" && invalidReason} onClick={() => void decide()}>{action === "approve" ? "تأیید و نمایش پاسخ" : "ثبت دلیل و رد پاسخ"}</KoochButton></> : <><KoochButton ref={approve} onClick={() => setAction("approve")}>تأیید پاسخ</KoochButton><KoochButton ref={reject} variant="outline" onClick={() => { setReason(""); setAction("reject"); }}>رد پاسخ</KoochButton></>}</div> : undefined}>
      {selected && <div className={styles.detailLayout}><AdminOwnerReplyDetail item={selected} />
        {action === "approve" && <p role="status" className="text-sm leading-7">پس از تأیید، این متن با عنوان «پاسخ اقامتگاه» عمومی می‌شود. انتشار را تأیید می‌کنید؟</p>}
        {action === "reject" && <div ref={reasonField} className="space-y-2"><label htmlFor="reply-rejection-reason" className="block text-sm">دلیل رد پاسخ (الزامی)</label><KoochTextarea id="reply-rejection-reason" value={reason} maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)} aria-invalid={reason.length > 0 && invalidReason} aria-describedby="reply-rejection-help" /><p id="reply-rejection-help" className="text-sm text-muted-foreground">دلیل روشن و بین ۵ تا ۱۰۰۰ نویسه باشد؛ به اقامتگاه نمایش داده می‌شود.</p></div>}
        {decisionError && <p role="alert" className="text-sm text-destructive">{decisionError}</p>}
      </div>}
    </KoochDialog>
  </main>;
}
export function AdminReviewRepliesPage() {
  const session = useAuthSession(); const allowed = !session.loading && session.authenticated && session.workspaces.includes("admin") && session.platformRole === "SuperAdmin";
  return <AdminLayout requiredPlatformPermission="ManageReviews">{allowed ? <ReplyQueue key={session.user?.userId} /> : <p role="status" className="p-6">بررسی پاسخ‌ها فقط برای مدیر کل سامانه مجاز است.</p>}</AdminLayout>;
}
