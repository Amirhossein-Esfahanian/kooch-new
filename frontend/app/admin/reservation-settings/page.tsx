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

const emptyDraft: ReservationSettingsDraft = {
  freeChildMaxAge: "",
  halfPriceChildMinAge: "",
  halfPriceChildMaxAge: "",
  halfPriceChildRate: "50",
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

export default function AdminReservationSettingsPage() {
  const { authenticated, loading: sessionLoading, workspaces } = useAuthSession();
  const [draft, setDraft] = useState<ReservationSettingsDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sessionLoading || !authenticated || !workspaces.includes("admin")) return;

    apiRequest<ReservationSettingsResponse>("/admin/reservation-settings")
      .then((settings) => setDraft(toDraft(settings)))
      .catch((caught: Error) =>
        toast.error(caught.message || "تنظیمات رزرو بارگذاری نشد"),
      )
      .finally(() => setLoading(false));
  }, [authenticated, sessionLoading, workspaces]);

  function update(key: keyof ReservationSettingsDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
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
      </main>
    </AdminLayout>
  );
}
