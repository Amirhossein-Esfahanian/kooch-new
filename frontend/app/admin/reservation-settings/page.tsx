"use client";

import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { apiRequest } from "@/lib/owner-api";

type ReservationSettingsResponse = {
  freeChildMaxAge: number | null;
  halfPriceChildMinAge: number | null;
  halfPriceChildMaxAge: number | null;
  halfPriceChildRate: number;
};

type ReservationSettingsDraft = {
  freeChildMaxAge: string;
  halfPriceChildMinAge: string;
  halfPriceChildMaxAge: string;
  halfPriceChildRate: string;
};

type ReservationDeadlineSettingsResponse = {
  paymentWindowMinutes: number;
  ownerApprovalWindowMinutes: number;
  ownerApprovalReminderIntervalMinutes: number;
};

type ReservationDeadlineSettingsDraft = {
  paymentWindowMinutes: string;
  ownerApprovalWindowMinutes: string;
  ownerApprovalReminderIntervalMinutes: string;
};

type ReservationDeadlineSettingsErrors = Partial<
  Record<keyof ReservationDeadlineSettingsDraft, string>
>;

const emptyDraft: ReservationSettingsDraft = {
  freeChildMaxAge: "",
  halfPriceChildMinAge: "",
  halfPriceChildMaxAge: "",
  halfPriceChildRate: "50",
};

const emptyDeadlineDraft: ReservationDeadlineSettingsDraft = {
  paymentWindowMinutes: "",
  ownerApprovalWindowMinutes: "",
  ownerApprovalReminderIntervalMinutes: "",
};

function toDraft(settings: ReservationSettingsResponse): ReservationSettingsDraft {
  return {
    freeChildMaxAge:
      settings.freeChildMaxAge === null ? "" : String(settings.freeChildMaxAge),
    halfPriceChildMinAge:
      settings.halfPriceChildMinAge === null
        ? ""
        : String(settings.halfPriceChildMinAge),
    halfPriceChildMaxAge:
      settings.halfPriceChildMaxAge === null
        ? ""
        : String(settings.halfPriceChildMaxAge),
    halfPriceChildRate: String(settings.halfPriceChildRate),
  };
}

function optionalAge(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function toDeadlineDraft(
  settings: ReservationDeadlineSettingsResponse,
): ReservationDeadlineSettingsDraft {
  return {
    paymentWindowMinutes: String(settings.paymentWindowMinutes),
    ownerApprovalWindowMinutes: String(settings.ownerApprovalWindowMinutes),
    ownerApprovalReminderIntervalMinutes: String(
      settings.ownerApprovalReminderIntervalMinutes,
    ),
  };
}

export default function AdminReservationSettingsPage() {
  const { authenticated, loading: sessionLoading, workspaces } = useAuthSession();
  const [draft, setDraft] = useState<ReservationSettingsDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deadlineDraft, setDeadlineDraft] =
    useState<ReservationDeadlineSettingsDraft>(emptyDeadlineDraft);
  const [deadlineErrors, setDeadlineErrors] =
    useState<ReservationDeadlineSettingsErrors>({});
  const [deadlineLoading, setDeadlineLoading] = useState(true);
  const [deadlineSaving, setDeadlineSaving] = useState(false);

  useEffect(() => {
    if (sessionLoading || !authenticated || !workspaces.includes("admin")) return;

    apiRequest<ReservationSettingsResponse>("/admin/reservation-settings")
      .then((settings) => setDraft(toDraft(settings)))
      .catch((caught: Error) =>
        toast.error(caught.message || "تنظیمات رزرو بارگذاری نشد"),
      )
      .finally(() => setLoading(false));

    apiRequest<ReservationDeadlineSettingsResponse>(
      "/admin/reservation-settings/deadlines",
    )
      .then((settings) => setDeadlineDraft(toDeadlineDraft(settings)))
      .catch((caught: Error) =>
        toast.error(caught.message || "مهلت‌های رزرو بارگذاری نشد"),
      )
      .finally(() => setDeadlineLoading(false));
  }, [authenticated, sessionLoading, workspaces]);

  function update(key: keyof ReservationSettingsDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDeadline(
    key: keyof ReservationDeadlineSettingsDraft,
    value: string,
  ) {
    setDeadlineDraft((current) => ({ ...current, [key]: value }));
    setDeadlineErrors((current) => ({ ...current, [key]: undefined }));
  }

  function validate() {
    const freeChildMaxAge = optionalAge(draft.freeChildMaxAge);
    const halfPriceChildMinAge = optionalAge(draft.halfPriceChildMinAge);
    const halfPriceChildMaxAge = optionalAge(draft.halfPriceChildMaxAge);
    const halfPriceChildRate = Number(draft.halfPriceChildRate);
    const ages = [
      freeChildMaxAge,
      halfPriceChildMinAge,
      halfPriceChildMaxAge,
    ];

    if (
      ages.some((age) => age !== null && (!Number.isFinite(age) || age < 0 || age > 17))
    ) {
      toast.error("سن کودک باید بین ۰ تا ۱۷ سال باشد");
      return null;
    }

    if (
      halfPriceChildMinAge !== null &&
      halfPriceChildMaxAge !== null &&
      halfPriceChildMinAge > halfPriceChildMaxAge
    ) {
      toast.error("حداقل سن نیم‌بها نمی‌تواند بیشتر از حداکثر سن باشد");
      return null;
    }

    if (
      !Number.isFinite(halfPriceChildRate) ||
      halfPriceChildRate < 0 ||
      halfPriceChildRate > 100
    ) {
      toast.error("درصد کودک نیم‌بها باید بین ۰ تا ۱۰۰ باشد");
      return null;
    }

    return {
      freeChildMaxAge,
      halfPriceChildMinAge,
      halfPriceChildMaxAge,
      halfPriceChildRate,
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = validate();
    if (!payload) return;

    setSaving(true);
    try {
      const updated = await apiRequest<ReservationSettingsResponse>(
        "/admin/reservation-settings",
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );
      setDraft(toDraft(updated));
      toast.success("تنظیمات رزرو ذخیره شد");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "ذخیره تنظیمات رزرو ناموفق بود",
      );
    } finally {
      setSaving(false);
    }
  }

  function validateDeadlines() {
    const errors: ReservationDeadlineSettingsErrors = {};
    const values = Object.entries(deadlineDraft) as Array<
      [keyof ReservationDeadlineSettingsDraft, string]
    >;

    for (const [key, rawValue] of values) {
      if (rawValue.trim() === "") {
        errors[key] = "این مقدار الزامی است";
        continue;
      }

      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 1 || value > 10080) {
        errors[key] = "مقدار باید یک عدد صحیح بین ۱ تا ۱۰۰۸۰ دقیقه باشد";
      }
    }

    setDeadlineErrors(errors);
    if (Object.keys(errors).length > 0) return null;

    return {
      paymentWindowMinutes: Number(deadlineDraft.paymentWindowMinutes),
      ownerApprovalWindowMinutes: Number(
        deadlineDraft.ownerApprovalWindowMinutes,
      ),
      ownerApprovalReminderIntervalMinutes: Number(
        deadlineDraft.ownerApprovalReminderIntervalMinutes,
      ),
    };
  }

  async function saveDeadlines(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = validateDeadlines();
    if (!payload) return;

    setDeadlineSaving(true);
    try {
      const updated = await apiRequest<ReservationDeadlineSettingsResponse>(
        "/admin/reservation-settings/deadlines",
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );
      setDeadlineDraft(toDeadlineDraft(updated));
      setDeadlineErrors({});
      toast.success("مهلت‌های رزرو ذخیره شد");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "ذخیره مهلت‌های رزرو ناموفق بود",
      );
    } finally {
      setDeadlineSaving(false);
    }
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          appearance="plain"
          description="قوانین پیش‌فرض کودک زمانی استفاده می‌شوند که اقامتگاه قانون اختصاصی ثبت نکرده باشد."
          eyebrow="پنل مدیریت"
          title="تنظیمات رزرو"
        />

        <KoochCard variant="elevated">
          {loading ? (
            <p className="text-sm text-muted-foreground">
              در حال بارگذاری تنظیمات رزرو...
            </p>
          ) : (
            <form className="grid gap-5" onSubmit={save}>
              <h2 className="text-base font-semibold text-foreground">
                قوانین قیمت‌گذاری کودک
              </h2>

              <div className="grid gap-4 md:grid-cols-2">
                <KoochField
                  helperText="کودکان تا این سن با قانون رایگان پیش‌فرض بررسی می‌شوند."
                  label="حداکثر سن کودک رایگان"
                >
                  <KoochInput
                    max={17}
                    min={0}
                    onChange={(event) =>
                      update("freeChildMaxAge", event.target.value)
                    }
                    type="number"
                    value={draft.freeChildMaxAge}
                  />
                </KoochField>

                <KoochField
                  helperText="برای نیم‌بها مقدار ۵۰ را وارد کنید."
                  label="درصد کودک نیم‌بها"
                  required
                >
                  <KoochInput
                    max={100}
                    min={0}
                    onChange={(event) =>
                      update("halfPriceChildRate", event.target.value)
                    }
                    step="0.01"
                    type="number"
                    value={draft.halfPriceChildRate}
                  />
                </KoochField>

                <KoochField label="حداقل سن کودک نیم‌بها">
                  <KoochInput
                    max={17}
                    min={0}
                    onChange={(event) =>
                      update("halfPriceChildMinAge", event.target.value)
                    }
                    type="number"
                    value={draft.halfPriceChildMinAge}
                  />
                </KoochField>

                <KoochField label="حداکثر سن کودک نیم‌بها">
                  <KoochInput
                    max={17}
                    min={0}
                    onChange={(event) =>
                      update("halfPriceChildMaxAge", event.target.value)
                    }
                    type="number"
                    value={draft.halfPriceChildMaxAge}
                  />
                </KoochField>
              </div>

              <div className="flex justify-end">
                <KoochButton disabled={saving} loading={saving} type="submit">
                  ذخیره تنظیمات
                </KoochButton>
              </div>
            </form>
          )}
        </KoochCard>

        <KoochCard variant="elevated">
          {deadlineLoading ? (
            <p className="text-sm text-muted-foreground">
              در حال بارگذاری مهلت‌های رزرو...
            </p>
          ) : (
            <form className="grid gap-5" onSubmit={saveDeadlines}>
              <div className="grid gap-1">
                <h2 className="text-base font-semibold text-foreground">
                  مهلت‌های رزرو
                </h2>
                <p className="text-sm text-muted-foreground">
                  زمان‌بندی پرداخت، تأیید مالک و یادآوری رزروهای در انتظار را
                  بر حسب دقیقه تنظیم کنید.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <KoochField
                  error={deadlineErrors.paymentWindowMinutes}
                  helperText="مدت زمانی که کاربر پس از ایجاد مرحله پرداخت برای تکمیل آن فرصت دارد، بر حسب دقیقه."
                  label="مهلت پرداخت"
                  required
                >
                  <KoochInput
                    dir="ltr"
                    error={deadlineErrors.paymentWindowMinutes}
                    inputMode="numeric"
                    max={10080}
                    min={1}
                    onChange={(event) =>
                      updateDeadline("paymentWindowMinutes", event.target.value)
                    }
                    required
                    step={1}
                    type="number"
                    value={deadlineDraft.paymentWindowMinutes}
                  />
                </KoochField>

                <KoochField
                  error={deadlineErrors.ownerApprovalWindowMinutes}
                  helperText="مدت زمانی که مالک برای تأیید رزروهای درخواستی فرصت دارد، بر حسب دقیقه."
                  label="مهلت تأیید مالک"
                  required
                >
                  <KoochInput
                    dir="ltr"
                    error={deadlineErrors.ownerApprovalWindowMinutes}
                    inputMode="numeric"
                    max={10080}
                    min={1}
                    onChange={(event) =>
                      updateDeadline(
                        "ownerApprovalWindowMinutes",
                        event.target.value,
                      )
                    }
                    required
                    step={1}
                    type="number"
                    value={deadlineDraft.ownerApprovalWindowMinutes}
                  />
                </KoochField>

                <KoochField
                  error={deadlineErrors.ownerApprovalReminderIntervalMinutes}
                  helperText="فاصله زمانی بررسی و ارسال یادآوری رزروهای در انتظار تأیید، بر حسب دقیقه."
                  label="فاصله یادآوری تأیید مالک"
                  required
                >
                  <KoochInput
                    dir="ltr"
                    error={deadlineErrors.ownerApprovalReminderIntervalMinutes}
                    inputMode="numeric"
                    max={10080}
                    min={1}
                    onChange={(event) =>
                      updateDeadline(
                        "ownerApprovalReminderIntervalMinutes",
                        event.target.value,
                      )
                    }
                    required
                    step={1}
                    type="number"
                    value={deadlineDraft.ownerApprovalReminderIntervalMinutes}
                  />
                </KoochField>
              </div>

              <div className="flex justify-end">
                <KoochButton
                  disabled={deadlineSaving}
                  loading={deadlineSaving}
                  type="submit"
                >
                  ذخیره مهلت‌ها
                </KoochButton>
              </div>
            </form>
          )}
        </KoochCard>
      </main>
    </AdminLayout>
  );
}
