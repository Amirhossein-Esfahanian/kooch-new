"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import {
  KoochField,
  KoochSearchableSelect,
} from "@/components/KoochFormControls";
import {
  assignReservationFollowUpRecipient,
  deactivateReservationFollowUpRecipient,
  getReservationFollowUpRecipients,
  searchReservationFollowUpCandidates,
  type ReservationFollowUpCandidate,
  type ReservationFollowUpRecipient,
} from "@/lib/reservation-follow-up";

export function ReservationFollowUpRecipients({ propertyId }: { propertyId: number }) {
  const [recipients, setRecipients] = useState<ReservationFollowUpRecipient[]>([]);
  const [candidates, setCandidates] = useState<ReservationFollowUpCandidate[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadRecipients = useCallback(async () => {
    setRecipients(await getReservationFollowUpRecipients(propertyId));
  }, [propertyId]);

  const loadCandidates = useCallback(async (query = "") => {
    setCandidates(await searchReservationFollowUpCandidates(propertyId, query));
  }, [propertyId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      getReservationFollowUpRecipients(propertyId),
      searchReservationFollowUpCandidates(propertyId),
    ])
      .then(([nextRecipients, nextCandidates]) => {
        if (!active) return;
        setRecipients(nextRecipients);
        setCandidates(nextCandidates);
      })
      .catch((caught: Error) => active && setError(caught.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [propertyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCandidates(search).catch((caught: Error) => setError(caught.message));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loadCandidates, search]);

  const options = useMemo(() => candidates.map((candidate) => ({
    value: candidate.userId,
    label: candidate.fullName,
    description: candidate.email ?? candidate.phoneNumber ?? undefined,
    searchText: [candidate.fullName, candidate.email, candidate.phoneNumber]
      .filter(Boolean)
      .join(" "),
  })), [candidates]);

  async function assign() {
    const userId = Number(selectedUserId);
    if (!Number.isInteger(userId) || userId <= 0 || saving) return;
    setSaving(true);
    setError("");
    try {
      await assignReservationFollowUpRecipient(propertyId, userId);
      setSelectedUserId("");
      await Promise.all([loadRecipients(), loadCandidates(search)]);
      toast.success("پیگیر رزروهای استعلامی اضافه شد.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "افزودن پیگیر انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(userId: number) {
    setSaving(true);
    setError("");
    try {
      await deactivateReservationFollowUpRecipient(propertyId, userId);
      await Promise.all([loadRecipients(), loadCandidates(search)]);
      toast.success("پیگیری این همکار غیرفعال شد.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "غیرفعال‌سازی انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KoochCard aria-labelledby="reservation-follow-up-title" className="grid gap-5" dir="rtl">
      <div className="max-w-3xl">
        <h2 className="text-xl font-black text-foreground" id="reservation-follow-up-title">
          پیگیری رزروهای استعلامی
        </h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          همکاران واجد شرایط مدیریت سایت را برای دریافت اعلان درخواست‌های نیازمند تأیید این اقامتگاه انتخاب کنید. این انتخاب هیچ دسترسی جدیدی ایجاد نمی‌کند.
        </p>
      </div>

      {error && <KoochAlert variant="destructive">{error}</KoochAlert>}

      {loading ? (
        <p className="text-sm font-semibold text-muted-foreground" role="status">
          در حال بارگذاری پیگیرها...
        </p>
      ) : (
        <>
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <KoochField
              helperText="فقط مدیران فعال دارای دسترسی مدیریت رزروهای همین اقامتگاه نمایش داده می‌شوند."
              label="همکار مدیریت سایت"
            >
              <KoochSearchableSelect
                disabled={saving}
                emptyText="همکار واجد شرایط دیگری پیدا نشد."
                onChange={setSelectedUserId}
                onSearchChange={setSearch}
                options={options}
                placeholder="انتخاب همکار"
                searchPlaceholder="جستجو با نام، ایمیل یا موبایل"
                value={selectedUserId}
              />
            </KoochField>
            <KoochButton
              className="w-full md:w-auto"
              disabled={!selectedUserId}
              loading={saving}
              onClick={assign}
              type="button"
            >
              افزودن پیگیر
            </KoochButton>
          </div>

          <div aria-live="polite" className="grid gap-2">
            <h3 className="text-sm font-black text-foreground">پیگیرهای فعال</h3>
            {recipients.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm leading-7 text-muted-foreground">
                هنوز پیگیر پلتفرمی برای این اقامتگاه تعیین نشده است. مالک و اعضای مجاز اقامتگاه مستقل از این فهرست اعلان دریافت می‌کنند.
              </p>
            ) : recipients.map((recipient) => (
              <div
                className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                key={recipient.userId}
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-foreground">{recipient.fullName}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground" dir="ltr">
                    {recipient.email ?? recipient.phoneNumber ?? "—"}
                  </p>
                </div>
                <KoochConfirmDialog
                  cancelText="انصراف"
                  confirmText="غیرفعال‌سازی"
                  description="این همکار دیگر اعلان پیگیری رزروهای استعلامی این اقامتگاه را دریافت نمی‌کند. دسترسی‌های فعلی او تغییر نخواهند کرد."
                  onConfirm={() => deactivate(recipient.userId)}
                  title="غیرفعال‌سازی پیگیری"
                  trigger={
                    <KoochButton disabled={saving} size="sm" type="button" variant="outline">
                      غیرفعال‌سازی
                    </KoochButton>
                  }
                  variant="warning"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </KoochCard>
  );
}
