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
  getAutomaticReservationRecipients,
  getReservationFollowUpRecipients,
  searchReservationFollowUpCandidates,
  type ReservationAutomaticRecipient,
  type ReservationFollowUpCandidate,
  type ReservationFollowUpRecipient,
} from "@/lib/reservation-follow-up";
import { toPersianDigits } from "@/lib/persian-digits";

const propertyRoleLabels: Record<string, string> = {
  PropertyOwner: "مالک اقامتگاه",
  Manager: "مدیر اقامتگاه",
  Reception: "پذیرش",
  Accounting: "حسابداری",
  Housekeeping: "خانه‌داری",
  Custom: "نقش سفارشی",
};

function automaticRecipientRole(recipient: ReservationAutomaticRecipient) {
  if (recipient.isOwner) return "مالک اقامتگاه";
  if (!recipient.propertyRole) return "عضو مجاز";
  return propertyRoleLabels[recipient.propertyRole] ?? recipient.propertyRole;
}

function ContactDetails({
  email,
  phoneNumber,
}: {
  email: string | null;
  phoneNumber: string | null;
}) {
  if (!email && !phoneNumber) {
    return <span className="text-xs text-muted-foreground">اطلاعات تماس ثبت نشده است.</span>;
  }

  return (
    <div className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {phoneNumber && (
        <span className="whitespace-nowrap" dir="ltr">
          {toPersianDigits(phoneNumber)}
        </span>
      )}
      {email && (
        <span className="min-w-0 break-all" dir="ltr">
          {email}
        </span>
      )}
    </div>
  );
}

export function ReservationFollowUpRecipients({
  propertyId,
  embedded = false,
}: {
  propertyId: number;
  embedded?: boolean;
}) {
  const [automaticRecipients, setAutomaticRecipients] = useState<
    ReservationAutomaticRecipient[]
  >([]);
  const [recipients, setRecipients] = useState<ReservationFollowUpRecipient[]>(
    [],
  );
  const [candidates, setCandidates] = useState<ReservationFollowUpCandidate[]>(
    [],
  );
  const [selectedUserId, setSelectedUserId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadAutomaticRecipients = useCallback(async () => {
    setAutomaticRecipients(await getAutomaticReservationRecipients(propertyId));
  }, [propertyId]);

  const loadRecipients = useCallback(async () => {
    setRecipients(await getReservationFollowUpRecipients(propertyId));
  }, [propertyId]);

  const loadCandidates = useCallback(
    async (query = "") => {
      setCandidates(
        await searchReservationFollowUpCandidates(propertyId, query),
      );
    },
    [propertyId],
  );

  useEffect(() => {
    let active = true;

    setAutomaticRecipients([]);
    setRecipients([]);
    setCandidates([]);
    setSelectedUserId("");
    setSearch("");
    setLoading(true);
    setError("");

    Promise.all([
      getAutomaticReservationRecipients(propertyId),
      getReservationFollowUpRecipients(propertyId),
      searchReservationFollowUpCandidates(propertyId),
    ])
      .then(([nextAutomaticRecipients, nextRecipients, nextCandidates]) => {
        if (!active) return;
        setAutomaticRecipients(nextAutomaticRecipients);
        setRecipients(nextRecipients);
        setCandidates(nextCandidates);
      })
      .catch((caught: Error) => active && setError(caught.message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [propertyId]);

  useEffect(() => {
    if (loading) return;

    const timer = window.setTimeout(() => {
      loadCandidates(search).catch((caught: Error) => setError(caught.message));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [loadCandidates, loading, search]);

  const options = useMemo(
    () =>
      candidates.map((candidate) => ({
        value: candidate.userId,
        label: candidate.fullName,
        description: candidate.email ?? candidate.phoneNumber ?? undefined,
        searchText: [candidate.fullName, candidate.email, candidate.phoneNumber]
          .filter(Boolean)
          .join(" "),
      })),
    [candidates],
  );

  async function assign() {
    const userId = Number(selectedUserId);
    if (!Number.isInteger(userId) || userId <= 0 || saving) return;

    setSaving(true);
    setError("");

    try {
      await assignReservationFollowUpRecipient(propertyId, userId);
      setSelectedUserId("");
      await Promise.all([
        loadAutomaticRecipients(),
        loadRecipients(),
        loadCandidates(search),
      ]);
      toast.success("پیگیر رزروهای استعلامی اضافه شد.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "افزودن پیگیر انجام نشد.";
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
      await Promise.all([
        loadAutomaticRecipients(),
        loadRecipients(),
        loadCandidates(search),
      ]);
      toast.success("پیگیری این همکار غیرفعال شد.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "غیرفعال‌سازی انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <>
      {error && <KoochAlert variant="destructive">{error}</KoochAlert>}

      {loading ? (
        <p
          className="text-sm font-semibold text-muted-foreground"
          role="status"
        >
          در حال بارگذاری گیرندگان اعلان...
        </p>
      ) : (
        <>
          <section className="grid gap-3" aria-labelledby="automatic-recipients-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3
                  className="text-sm font-bold text-foreground"
                  id="automatic-recipients-title"
                >
                  گیرندگان خودکار اقامتگاه
                </h3>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  مالک و اعضای فعال دارای مجوز مدیریت رزرو به‌صورت خودکار اعلان
                  دریافت می‌کنند و از این بخش قابل حذف نیستند.
                </p>
              </div>
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                {toPersianDigits(automaticRecipients.length)} نفر
              </span>
            </div>

            {automaticRecipients.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm leading-7 text-muted-foreground">
                در حال حاضر هیچ مالک یا عضو فعالی با مجوز مدیریت رزرو برای این
                اقامتگاه شناسایی نشد.
              </p>
            ) : (
              <div className="grid gap-2">
                {automaticRecipients.map((recipient) => (
                  <div
                    className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                    key={recipient.userId}
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-foreground">
                        {recipient.fullName}
                      </p>
                      <ContactDetails
                        email={recipient.email}
                        phoneNumber={recipient.phoneNumber}
                      />
                    </div>
                    <span className="w-fit shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                      {automaticRecipientRole(recipient)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            className="grid gap-3 border-t border-border pt-5"
            aria-labelledby="platform-follow-up-title"
          >
            <div>
              <h3
                className="text-sm font-bold text-foreground"
                id="platform-follow-up-title"
              >
                پیگیرهای مدیریت سایت
              </h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                مدیران پلتفرم فقط در صورتی قابل انتخاب هستند که مجوز مدیریت
                رزروها و دسترسی رزرو همین اقامتگاه را داشته باشند. افزودن پیگیر
                هیچ دسترسی جدیدی ایجاد نمی‌کند.
              </p>
            </div>

            <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <KoochField
                helperText="فقط مدیران فعال و واجد شرایط نمایش داده می‌شوند."
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-foreground">
                  پیگیرهای فعال
                </h4>
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {toPersianDigits(recipients.length)} نفر
                </span>
              </div>

              {recipients.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm leading-7 text-muted-foreground">
                  هنوز پیگیر پلتفرمی برای این اقامتگاه تعیین نشده است.
                </p>
              ) : (
                recipients.map((recipient) => (
                  <div
                    className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                    key={recipient.userId}
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-foreground">
                        {recipient.fullName}
                      </p>
                      <ContactDetails
                        email={recipient.email}
                        phoneNumber={recipient.phoneNumber}
                      />
                    </div>
                    <KoochConfirmDialog
                      cancelText="انصراف"
                      confirmText="غیرفعال‌سازی"
                      description="این همکار دیگر اعلان پیگیری رزروهای استعلامی این اقامتگاه را دریافت نمی‌کند. دسترسی‌های فعلی او تغییر نخواهند کرد."
                      onConfirm={() => deactivate(recipient.userId)}
                      title="غیرفعال‌سازی پیگیری"
                      trigger={
                        <KoochButton
                          disabled={saving}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          غیرفعال‌سازی
                        </KoochButton>
                      }
                      variant="warning"
                    />
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="grid gap-5" dir="rtl">
        {content}
      </div>
    );
  }

  return (
    <KoochCard
      aria-labelledby="reservation-follow-up-title"
      className="grid gap-5"
      dir="rtl"
    >
      <div className="max-w-3xl">
        <h2
          className="text-xl font-bold text-foreground"
          id="reservation-follow-up-title"
        >
          پیگیری رزروهای استعلامی
        </h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          گیرندگان خودکار اقامتگاه را مشاهده کنید و مدیران واجد شرایط پلتفرم را
          برای پیگیری درخواست‌های نیازمند تأیید تعیین کنید.
        </p>
      </div>
      {content}
    </KoochCard>
  );
}
