"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { apiRequest, getToken } from "@/lib/owner-api";
import { SharedUploader } from "@/components/SharedUploader";

type SiteSettingType =
  | "Text"
  | "LongText"
  | "ImageUrl"
  | "Color"
  | "Boolean"
  | "Number";

interface SiteSettingResponse {
  id: number;
  key: string;
  value: string;
  type: SiteSettingType;
  group: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAtUtc: string;
  updatedAtUtc: string | null;
}

const groupLabels: Record<string, string> = {
  Brand: "برند سایت",
  Homepage: "صفحه اصلی",
  SEO: "سئو",
  Footer: "فوتر",
  Images: "تنظیمات تصاویر",
  Pricing: "تنظیمات قیمت‌گذاری",
  Reservation: "تنظیمات کمیسیون",
};

const imageLabels: Record<string, string> = {
  "site.logoUrl": "لوگوی سایت",
  "home.heroBackgroundUrl": "تصویر پس‌زمینه صفحه اصلی",
};

const settingDisplayLabels: Record<string, string> = {
  "pricing.minPrice": "MinimumPrice",
  "pricing.maxPrice": "MaximumPrice",
  ReservationCommissionPercent: "ReservationCommissionPercent",
  ReferralCommissionPercent: "ReferralCommissionPercent",
  CommissionType3Percent: "CommissionType3Percent",
  "reservation.freeChildMaxAge": "حداکثر سن کودک رایگان",
  "reservation.halfPriceChildMinAge": "حداقل سن کودک نیم‌بها",
  "reservation.halfPriceChildMaxAge": "حداکثر سن کودک نیم‌بها",
  "reservation.halfPriceChildRate": "درصد کودک نیم‌بها",
};

const priceSettingKeys = ["pricing.minPrice", "pricing.maxPrice"] as const;
const commissionSettingKeys = [
  "ReservationCommissionPercent",
  "ReferralCommissionPercent",
  "CommissionType3Percent",
] as const;

function inputType(type: SiteSettingType) {
  if (type === "Color") return "color";
  if (type === "Number") return "number";
  return "text";
}

export default function AdminSiteSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SiteSettingResponse[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    apiRequest<SiteSettingResponse[]>("/admin/site-settings")
      .then((items) => {
        setSettings(items);
        setDrafts(
          Object.fromEntries(items.map((item) => [item.key, item.value])),
        );
      })
      .catch((caught: Error) =>
        toast.error(caught.message || "تنظیمات سایت بارگذاری نشد"),
      )
      .finally(() => setLoading(false));
  }, [router]);

  const groupedSettings = useMemo(() => {
    return settings.reduce<Record<string, SiteSettingResponse[]>>(
      (groups, setting) => {
        groups[setting.group] = groups[setting.group] ?? [];
        groups[setting.group].push(setting);
        return groups;
      },
      {},
    );
  }, [settings]);

  function validateCentralSettings() {
    const minimumPrice = Number(drafts["pricing.minPrice"] ?? 0);
    const maximumPrice = Number(drafts["pricing.maxPrice"] ?? 0);

    if (
      !Number.isFinite(minimumPrice) ||
      !Number.isFinite(maximumPrice) ||
      minimumPrice < 0 ||
      maximumPrice < 0
    ) {
      toast.error("قیمت‌ها باید عددی و بزرگ‌تر یا مساوی صفر باشند");
      return false;
    }

    if (maximumPrice < minimumPrice) {
      toast.error("حداکثر قیمت باید بزرگ‌تر یا مساوی حداقل قیمت باشد");
      return false;
    }

    for (const key of commissionSettingKeys) {
      const percent = Number(drafts[key] ?? 0);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        toast.error("درصد کمیسیون باید بین ۰ تا ۱۰۰ باشد");
        return false;
      }
    }

    return true;
  }

  async function updateSetting(key: string, value: string) {
    return apiRequest<SiteSettingResponse>(
      `/admin/site-settings/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: JSON.stringify({ value }),
      },
    );
  }

  async function savePriceSettingsInSafeOrder() {
    const minimumPrice = Number(drafts["pricing.minPrice"]);
    const currentMaximum = Number(
      settings.find((setting) => setting.key === "pricing.maxPrice")?.value ??
        0,
    );
    const orderedKeys =
      minimumPrice > currentMaximum
        ? [...priceSettingKeys].reverse()
        : [...priceSettingKeys];

    const updatedSettings: SiteSettingResponse[] = [];
    for (const key of orderedKeys) {
      updatedSettings.push(await updateSetting(key, drafts[key] ?? ""));
    }
    return updatedSettings;
  }

  async function save(setting: SiteSettingResponse) {
    if (!validateCentralSettings()) return;

    setSavingKey(setting.key);
    try {
      const updatedSettings = priceSettingKeys.includes(
        setting.key as (typeof priceSettingKeys)[number],
      )
        ? await savePriceSettingsInSafeOrder()
        : [await updateSetting(setting.key, drafts[setting.key] ?? "")];

      setSettings((current) =>
        current.map(
          (item) =>
            updatedSettings.find((updated) => updated.key === item.key) ?? item,
        ),
      );
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(
          updatedSettings.map((updated) => [updated.key, updated.value]),
        ),
      }));
      toast.success("تنظیمات سایت ذخیره شد");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "ذخیره تنظیمات ناموفق بود",
      );
    } finally {
      setSavingKey(null);
    }
  }

  function renderInput(setting: SiteSettingResponse) {
    const value = drafts[setting.key] ?? "";

    if (setting.type === "ImageUrl") {
      const isLogo = setting.key === "site.logoUrl";
      const token = getToken();
      return (
        <SharedUploader
          accept={
            isLogo
              ? ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]
              : ["image/png", "image/jpeg", "image/webp"]
          }
          aspectRatio={isLogo ? "1 / 1" : "16 / 9"}
          cropAspectRatio={isLogo ? 1 : 16 / 9}
          enableCrop={!isLogo}
          enablePreview
          existingFiles={
            value
              ? [
                  {
                    id: setting.key,
                    url: value,
                    name: imageLabels[setting.key] ?? setting.label,
                    alt: imageLabels[setting.key] ?? setting.label,
                  },
                ]
              : []
          }
          extraFormFields={{ key: setting.key }}
          fieldName="file"
          headers={token ? { Authorization: `Bearer ${token}` } : undefined}
          hideFileDetails
          hideInlineStatus
          labels={{
            title: imageLabels[setting.key] ?? setting.label,
            description: isLogo
              ? "لوگوی سایت را انتخاب و آپلود کنید."
              : "تصویر سایت را انتخاب و آپلود کنید.",
            browseText: "انتخاب تصویر",
            uploadText: "آپلود",
            uploadingText: "در حال آپلود...",
            successText: "تصویر آپلود و ذخیره شد",
            previewText: "پیش‌نمایش",
            existingEmptyText: "تصویری ثبت نشده است.",
          }}
          maxFileSizeMb={5}
          maxFiles={1}
          multiple={false}
          onUploadSuccess={(uploaded) => {
            const updated = uploaded as unknown as SiteSettingResponse;
            setSettings((current) =>
              current.map((item) =>
                item.key === updated.key ? updated : item,
              ),
            );
            setDrafts((current) => ({
              ...current,
              [updated.key]: updated.value,
            }));
          }}
          showExistingFiles
          uploadUrl="/api/backend/admin/site-settings/upload"
          useToastNotifications
          variant="square"
        />
      );
    }

    if (setting.type === "LongText") {
      return (
        <KoochTextarea
          className="font-bold leading-7"
          onChange={(event) =>
            setDrafts((current) => ({
              ...current,
              [setting.key]: event.target.value,
            }))
          }
          value={value}
        />
      );
    }

    if (setting.type === "Boolean") {
      return (
        <KoochSelect
          onChange={(event) =>
            setDrafts((current) => ({
              ...current,
              [setting.key]: event.target.value,
            }))
          }
          value={value}
        >
          <option value="true">فعال</option>
          <option value="false">غیرفعال</option>
        </KoochSelect>
      );
    }

    return (
      <KoochInput
        className="font-bold"
        dir="rtl"
        onChange={(event) =>
          setDrafts((current) => ({
            ...current,
            [setting.key]: event.target.value,
          }))
        }
        type={inputType(setting.type)}
        max={
          commissionSettingKeys.includes(
            setting.key as (typeof commissionSettingKeys)[number],
          )
            ? 100
            : undefined
        }
        min={
          setting.type === "Number"
            ? priceSettingKeys.includes(
                setting.key as (typeof priceSettingKeys)[number],
              ) ||
              commissionSettingKeys.includes(
                setting.key as (typeof commissionSettingKeys)[number],
              )
              ? 0
              : 1
            : undefined
        }
        step={
          commissionSettingKeys.includes(
            setting.key as (typeof commissionSettingKeys)[number],
          )
            ? "0.01"
            : undefined
        }
        value={value}
      />
    );
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          description="تنظیمات عمومی، برند، تصاویر و مقادیر مرکزی سایت را مدیریت کنید."
          eyebrow=""
          title="تنظیمات سایت"
        />
        {loading && (
          <KoochCard variant="elevated">
            <p className="text-sm text-muted-foreground">
              در حال بارگذاری تنظیمات...
            </p>
          </KoochCard>
        )}
        {Object.entries(groupedSettings).map(([group, items]) => (
          <KoochCard key={group} variant="elevated">
            <h2 className="text-xl font-black text-foreground">
              {groupLabels[group] ?? group}
            </h2>
            <div className="mt-5 grid gap-5">
              {items.map((setting) => (
                <div
                  className="grid gap-3 rounded-lg border border-border bg-muted p-4"
                  key={setting.key}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <label
                        className="font-black text-foreground"
                        htmlFor={setting.key}
                      >
                        {settingDisplayLabels[setting.key] ??
                          imageLabels[setting.key] ??
                          setting.label}
                      </label>
                      <p
                        className="mt-1 text-xs font-semibold text-muted-foreground"
                        dir="ltr"
                      >
                        {setting.key}
                      </p>
                      {setting.description && (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {setting.description}
                        </p>
                      )}
                    </div>
                    <KoochButton
                      disabled={savingKey === setting.key}
                      loading={savingKey === setting.key}
                      onClick={() => save(setting)}
                      size="sm"
                      type="button"
                    >
                      ذخیره
                    </KoochButton>
                  </div>
                  <div id={setting.key}>{renderInput(setting)}</div>
                </div>
              ))}
            </div>
          </KoochCard>
        ))}
      </main>
    </AdminLayout>
  );
}
