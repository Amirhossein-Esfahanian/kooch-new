"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochInput, KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { formatDateTime, formatNumber } from "@/lib/account-reservations";
import { apiRequest } from "@/lib/owner-api";

type Target = "SelectedAdmins" | "SelectedPropertyOwners" | "AllAdmins" | "AllPropertyOwners";
type Announcement = {
  id: number; title: string; body: string; target: Target; senderUserId: number;
  sentAtUtc: string; recipientCount: number; recipientUserIds: number[];
};
type Recipient = { id: number; displayName: string };
type RecipientPage = { items: Recipient[]; totalPages: number };
type Draft = { title: string; body: string; target: Target; recipientUserIds: number[]; idempotencyKey: string };

const targetLabels: Record<Target, string> = {
  SelectedAdmins: "مدیران منتخب", SelectedPropertyOwners: "مالکان منتخب",
  AllAdmins: "همه مدیران", AllPropertyOwners: "همه مالکان",
};
const isSelected = (target: Target) => target === "SelectedAdmins" || target === "SelectedPropertyOwners";
const errorText = (error: unknown) => error instanceof Error ? error.message : "درخواست انجام نشد. دوباره تلاش کنید.";
const emptyDraft = (): Draft => ({ title: "", body: "", target: "SelectedAdmins", recipientUserIds: [], idempotencyKey: crypto.randomUUID() });

export default function AdminAnnouncementsPage() {
  const { authenticated, loading: sessionLoading, workspaces, platformRole, platformPermissions, user } = useAuthSession();
  const canManage = !sessionLoading && authenticated && workspaces.includes("admin") &&
    (platformRole === "SuperAdmin" || platformPermissions.includes("ManageNotifications"));
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [adminNames, setAdminNames] = useState<Record<number, string>>({});
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientPages, setRecipientPages] = useState(0);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try { setItems(await apiRequest<Announcement[]>("/admin/announcements")); }
    catch (error) { setItems([]); setLoadError(errorText(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canManage) void load(); }, [canManage, load]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    apiRequest<RecipientPage>("/admin/announcements/recipients?target=SelectedAdmins&page=1&pageSize=100").then((result) => {
      if (active) setAdminNames(Object.fromEntries(result.items.map((item) => [item.id, item.displayName])));
    }).catch(() => {});
    return () => { active = false; };
  }, [canManage]);

  useEffect(() => {
    if (!open || !draft || !isSelected(draft.target) || !canManage) return;
    let active = true;
    setRecipientLoading(true); setRecipientError(null); setRecipients([]);
    const query = new URLSearchParams({ target: draft.target, page: String(recipientPage), pageSize: "20" });
    if (recipientSearch.trim()) query.set("search", recipientSearch.trim());
    apiRequest<RecipientPage>(`/admin/announcements/recipients?${query}`).then((result) => {
      if (active) { setRecipients(result.items); setRecipientPages(result.totalPages); }
    }).catch((error) => { if (active) setRecipientError(errorText(error)); })
      .finally(() => { if (active) setRecipientLoading(false); });
    return () => { active = false; };
  }, [open, draft?.target, canManage, recipientPage, recipientSearch]);

  function changeDraft(change: Partial<Draft>) {
    setDraft((current) => current ? { ...current, ...change, idempotencyKey: crypto.randomUUID() } : current);
    setSendError(null);
  }
  function beginCreate() {
    setDraft(emptyDraft()); setRecipientSearch(""); setRecipientPage(1);
    setRecipients([]); setSendError(null); setOpen(true);
  }
  async function send() {
    if (!draft || saving) return;
    setSaving(true); setSendError(null);
    try {
      await apiRequest<Announcement>("/admin/announcements", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: draft.idempotencyKey, title: draft.title.trim(), body: draft.body.trim(),
          target: draft.target, recipientUserIds: isSelected(draft.target) ? draft.recipientUserIds : [],
        }),
      });
      setOpen(false); setConfirmAll(false); setDraft(null);
      toast.success("اعلان ارسال شد.");
      await load();
    } catch (error) { setSendError(errorText(error)); setConfirmAll(false); }
    finally { setSaving(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft?.title.trim() || !draft.body.trim() || isSelected(draft.target) && !draft.recipientUserIds.length) return;
    if (!isSelected(draft.target)) setConfirmAll(true);
    else void send();
  }
  const selectedNames = draft?.recipientUserIds.map((id) => recipients.find((person) => person.id === id)?.displayName ?? `کاربر ${formatNumber(id)}`) ?? [];

  return <AdminLayout requiredPlatformPermission="ManageNotifications">
    <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6" dir="rtl">
      <KoochPageHeader appearance="plain" eyebrow="اعلان‌ها" title="اعلان‌های مدیریتی"
        description="ارسال اطلاعیه یک‌طرفه به مدیران یا مالکان و مرور سابقه ارسال‌ها."
        actions={<KoochButton onClick={beginCreate}>ایجاد اعلان</KoochButton>} />
      <KoochCard className="grid gap-4">
        <h2 className="text-base font-semibold">اعلان‌های ارسال‌شده</h2>
        {loading ? <p role="status" className="text-sm text-muted-foreground">در حال بارگذاری اعلان‌ها…</p>
          : loadError ? <div className="grid justify-items-start gap-3"><KoochAlert variant="destructive">{loadError}</KoochAlert><KoochButton variant="outline" onClick={() => void load()}>تلاش دوباره</KoochButton></div>
          : items.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">هنوز اعلانی ارسال نشده است.</p>
          : <ul className="divide-y divide-border">{items.map((item) => <li key={item.id} className="grid gap-2 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0"><h3 className="font-medium text-foreground">{item.title}</h3><p className="mt-1 text-xs text-muted-foreground">{targetLabels[item.target]} · {formatNumber(item.recipientCount)} گیرنده</p></div>
            <div className="text-xs text-muted-foreground sm:text-end"><p>فرستنده: {item.senderUserId === user?.userId ? (user.fullName || "شما") : adminNames[item.senderUserId] ?? `مدیر ${formatNumber(item.senderUserId)}`}</p><time dateTime={item.sentAtUtc}>{formatDateTime(item.sentAtUtc)}</time></div>
          </li>)}</ul>}
      </KoochCard>
      <KoochDialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }} closeDisabled={saving} title="ایجاد اعلان" size="md">
        {draft && <form className="grid gap-4" onSubmit={submit}>
          <KoochField label="عنوان" required><KoochInput required maxLength={200} value={draft.title} disabled={saving} onChange={(event) => changeDraft({ title: event.target.value })} /></KoochField>
          <KoochField label="متن اعلان" required><KoochTextarea required maxLength={4000} rows={5} value={draft.body} disabled={saving} onChange={(event) => changeDraft({ body: event.target.value })} /></KoochField>
          <KoochField label="گیرندگان" required><KoochSelect value={draft.target} disabled={saving} onChange={(event) => { changeDraft({ target: event.target.value as Target, recipientUserIds: [] }); setRecipientPage(1); setRecipientSearch(""); }}>
            {Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </KoochSelect></KoochField>
          {isSelected(draft.target) && <div className="grid gap-3"><KoochField label="جستجوی گیرنده"><KoochInput value={recipientSearch} placeholder="نام گیرنده" onChange={(event) => { setRecipientSearch(event.target.value); setRecipientPage(1); }} /></KoochField>
              {recipientLoading ? <p role="status" className="text-sm text-muted-foreground">در حال دریافت گیرندگان…</p> : recipientError ? <KoochAlert variant="destructive">{recipientError}</KoochAlert>
                : <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-2" role="group" aria-label="انتخاب گیرندگان">
                  {recipients.map((person) => <label key={person.id} className="flex min-h-10 items-center gap-2 rounded px-2 text-sm hover:bg-muted">
                    <input type="checkbox" checked={draft.recipientUserIds.includes(person.id)} disabled={saving} onChange={() => changeDraft({ recipientUserIds: draft.recipientUserIds.includes(person.id) ? draft.recipientUserIds.filter((id) => id !== person.id) : [...draft.recipientUserIds, person.id] })} />{person.displayName}
                  </label>)}
                  {recipients.length === 0 && <p className="p-2 text-sm text-muted-foreground">گیرنده‌ای پیدا نشد.</p>}
                </div>}
              {recipientPages > 1 && <div className="flex items-center gap-2"><KoochButton size="sm" variant="outline" disabled={recipientPage <= 1} onClick={() => setRecipientPage((page) => page - 1)}>قبلی</KoochButton><span className="text-xs text-muted-foreground">صفحه {formatNumber(recipientPage)}</span><KoochButton size="sm" variant="outline" disabled={recipientPage >= recipientPages} onClick={() => setRecipientPage((page) => page + 1)}>بعدی</KoochButton></div>}
              {selectedNames.length > 0 && <p className="text-xs text-muted-foreground">انتخاب‌شده: {selectedNames.join("، ")}</p>}
            </div>}
          {sendError && <KoochAlert variant="destructive">{sendError}</KoochAlert>}
          <div className="flex justify-end gap-2 border-t border-border pt-4"><KoochButton variant="outline" disabled={saving} onClick={() => setOpen(false)}>انصراف</KoochButton><KoochButton type="submit" loading={saving} disabled={!draft.title.trim() || !draft.body.trim() || isSelected(draft.target) && !draft.recipientUserIds.length}>{isSelected(draft.target) ? "ارسال اعلان" : "بررسی و ارسال"}</KoochButton></div>
        </form>}
      </KoochDialog>
      <KoochConfirmDialog open={confirmAll} onOpenChange={(next) => { if (!saving) setConfirmAll(next); }} title="تأیید ارسال همگانی" description={`این اعلان برای ${draft ? targetLabels[draft.target] : "همه گیرندگان"} ارسال می‌شود. ادامه می‌دهید؟`} confirmText="ارسال اعلان" loading={saving} onConfirm={send} />
    </main>
  </AdminLayout>;
}
