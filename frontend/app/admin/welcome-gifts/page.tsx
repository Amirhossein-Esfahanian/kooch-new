"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochCheckbox, KoochField, KoochInput } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { apiRequest } from "@/lib/owner-api";

type Campaign = {
  id: number;
  title: string;
  amount: number;
  startDate: string;
  endDate: string;
  maxRecipients: number;
  grantedCount: number;
  validityDays: number;
  isActive: boolean;
};

type CampaignDraft = {
  title: string;
  amount: string;
  startDate: string | null;
  endDate: string | null;
  maxRecipients: string;
  validityDays: string;
  isActive: boolean;
};

const endpoint = "/admin/welcome-gift-campaigns";

function emptyDraft(): CampaignDraft {
  return {
    title: "",
    amount: "",
    startDate: null,
    endDate: null,
    maxRecipients: "",
    validityDays: "",
    isActive: true,
  };
}

function iranToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function campaignStatus(campaign: Campaign, today: string) {
  if (!campaign.isActive) return { label: "غیرفعال", variant: "muted" as const };
  if (campaign.endDate < today) return { label: "پایان‌یافته", variant: "muted" as const };
  if (campaign.startDate > today) return { label: "آینده", variant: "default" as const };
  if (campaign.grantedCount >= campaign.maxRecipients) {
    return { label: "ظرفیت تکمیل", variant: "warning" as const };
  }
  return { label: "فعال", variant: "success" as const };
}

function persianDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00Z`));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "درخواست انجام نشد. دوباره تلاش کنید.";
}

export default function AdminWelcomeGiftsPage() {
  const currencyLabel = useSiteCurrencyLabel();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft>(emptyDraft);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCampaigns(await apiRequest<Campaign[]>(endpoint));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft());
    setActionError(null);
    setDialogOpen(true);
  }

  function openEdit(campaign: Campaign) {
    setEditing(campaign);
    setDraft({
      title: campaign.title,
      amount: String(campaign.amount),
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      maxRecipients: String(campaign.maxRecipients),
      validityDays: String(campaign.validityDays),
      isActive: campaign.isActive,
    });
    setActionError(null);
    setDialogOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!draft.startDate || !draft.endDate) {
      setActionError("بازه اجرای کمپین را انتخاب کنید.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        amount: Number(draft.amount),
        startDate: draft.startDate,
        endDate: draft.endDate,
        maxRecipients: Number(draft.maxRecipients),
        validityDays: Number(draft.validityDays),
        isActive: draft.isActive,
      };
      await apiRequest<Campaign>(editing ? `${endpoint}/${editing.id}` : endpoint, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setDialogOpen(false);
      toast.success(editing ? "کمپین ویرایش شد." : "کمپین ایجاد شد.");
      await load();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setActionError(null);
    try {
      await apiRequest<void>(`${endpoint}/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      toast.success("کمپین حذف شد.");
      await load();
    } catch (error) {
      setDeleting(null);
      setActionError(errorMessage(error));
    }
  }

  const today = iranToday();

  return (
    <AdminLayout requiredPlatformPermission="ManagePromotions">
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6" dir="rtl">
        <KoochPageHeader
          appearance="plain"
          eyebrow="پنل مدیریت"
          title="کمپین‌های هدیه خوش‌آمدگویی"
          description="کمپین‌های هدیه خوش‌آمدگویی را مدیریت کنید."
          actions={<KoochButton onClick={openCreate}>ایجاد کمپین</KoochButton>}
        />
        {actionError && !dialogOpen && <KoochAlert variant="destructive">{actionError}</KoochAlert>}
        <KoochCard className="grid gap-4">
          <h2 className="text-base font-semibold">فهرست کمپین‌ها</h2>
          {loading ? <p className="text-sm text-muted-foreground">در حال بارگذاری…</p> : loadError ? (
            <div className="grid justify-items-start gap-3">
              <KoochAlert variant="destructive">{loadError}</KoochAlert>
              <KoochButton variant="outline" onClick={() => void load()}>تلاش دوباره</KoochButton>
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز کمپینی ثبت نشده است.</p>
          ) : (
            <div className="grid gap-3">
              {campaigns.map((campaign) => {
                const status = campaignStatus(campaign, today);
                return (
                  <article key={campaign.id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto] lg:items-center">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-foreground">{campaign.title}</h3>
                      <KoochBadge variant={status.variant}>{status.label}</KoochBadge>
                    </div>
                    <div className="text-sm"><span className="text-muted-foreground">مبلغ: </span><span className="font-semibold">{formatCurrency(campaign.amount, { currencyLabel })}</span></div>
                    <div className="text-sm"><span className="text-muted-foreground">بازه: </span><span>{persianDate(campaign.startDate)} تا {persianDate(campaign.endDate)}</span></div>
                    <div className="text-sm"><span className="text-muted-foreground">اعتبار: </span><span>{new Intl.NumberFormat("fa-IR").format(campaign.validityDays)} روز</span><br /><span className="text-muted-foreground">دریافت‌کنندگان: </span><span>{new Intl.NumberFormat("fa-IR").format(campaign.grantedCount)} / {new Intl.NumberFormat("fa-IR").format(campaign.maxRecipients)}</span></div>
                    <div className="flex gap-2 lg:justify-end">
                      <KoochButton size="sm" variant="outline" onClick={() => openEdit(campaign)} aria-label={`ویرایش ${campaign.title}`}>ویرایش</KoochButton>
                      <KoochButton size="sm" variant="ghost" onClick={() => setDeleting(campaign)} aria-label={`حذف ${campaign.title}`}>حذف</KoochButton>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </KoochCard>
        <KoochDialog open={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open); }} title={editing ? "ویرایش کمپین" : "ایجاد کمپین"} size="sm" closeDisabled={saving}>
          <form id="welcome-gift-form" onSubmit={(event) => void save(event)} className="grid gap-4">
            <KoochField label="عنوان" required><KoochInput required maxLength={150} disabled={saving} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></KoochField>
            <KoochField label={`مبلغ (${currencyLabel})`} required><KoochInput required type="number" min="0.01" step="0.01" inputMode="decimal" disabled={saving} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></KoochField>
            <KoochField label="بازه اجرای کمپین" required>
              <KoochDatePicker mode="range" calendarType="jalali" openOnDialog autoCommit value={{ startDate: draft.startDate, endDate: draft.endDate }} onChange={({ startDate, endDate }) => setDraft({ ...draft, startDate, endDate })} />
            </KoochField>
            <div className="grid gap-4 sm:grid-cols-2">
              <KoochField label="حداکثر دریافت‌کنندگان" required><KoochInput required type="number" min="1" step="1" inputMode="numeric" disabled={saving} value={draft.maxRecipients} onChange={(event) => setDraft({ ...draft, maxRecipients: event.target.value })} /></KoochField>
              <KoochField label="مدت اعتبار (روز)" required><KoochInput required type="number" min="1" step="1" inputMode="numeric" disabled={saving} value={draft.validityDays} onChange={(event) => setDraft({ ...draft, validityDays: event.target.value })} /></KoochField>
            </div>
            <KoochCheckbox label="فعال" checked={draft.isActive} disabled={saving} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
            {actionError && <KoochAlert variant="destructive">{actionError}</KoochAlert>}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <KoochButton variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>انصراف</KoochButton>
              <KoochButton type="submit" loading={saving} disabled={!draft.startDate || !draft.endDate}>ذخیره</KoochButton>
            </div>
          </form>
        </KoochDialog>
        <KoochConfirmDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }} title="حذف کمپین" description={deleting ? `کمپین «${deleting.title}» حذف شود؟` : undefined} confirmText="حذف" variant="destructive" onConfirm={remove} />
      </main>
    </AdminLayout>
  );
}
