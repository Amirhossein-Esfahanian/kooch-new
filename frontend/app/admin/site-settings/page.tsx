"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochField,
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import { KoochAlert } from "@/components/KoochAlert";
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

type PricingBoundsResponse = {
  minPrice: number;
  maxPrice: number;
};

type PricingBoundsDraft = {
  minPrice: string;
  maxPrice: string;
};

type PricingBoundsErrors = Partial<Record<keyof PricingBoundsDraft, string>>;

type GenericFieldAccessibility = {
  controlId: string;
  describedBy?: string;
  error?: string;
};

const siteSettingsSections = [
  {
    id: "identity-and-brand",
    title: "هویت و برند",
    description: "نام، لوگو و اطلاعات پایه نمایش سایت",
    settingKeys: ["site.name", "site.logoUrl", "site.footerText"],
  },
  {
    id: "homepage",
    title: "صفحه اصلی",
    description: "محتوا و تصویر بخش‌های اصلی صفحه نخست",
    settingKeys: [
      "home.heroTitle",
      "home.heroSubtitle",
      "home.heroBackgroundUrl",
      "home.searchButtonText",
      "home.popularSectionTitle",
      "home.popularSectionSubtitle",
    ],
  },
  {
    id: "images-and-uploads",
    title: "تصاویر و بارگذاری",
    description: "محدودیت‌ها و رفتار پردازش تصاویر اقامتگاه",
    settingKeys: [
      "image.maxFileSizeMb",
      "image.minWidth",
      "image.minHeight",
      "image.maxImagesPerProperty",
      "image.enableWebpConversion",
    ],
  },
  {
    id: "pricing-and-currency",
    title: "قیمت‌گذاری و نمایش مبلغ",
    description: "حدود قیمت‌گذاری و نحوه نمایش واحد پول",
    settingKeys: ["pricing.currencyLabel"],
    includesPricingBounds: true,
  },
  {
    id: "seo",
    title: "سئو",
    description: "عنوان و توضیحات پیش‌فرض برای موتورهای جستجو",
    settingKeys: ["site.defaultSeoTitle", "site.defaultSeoDescription"],
  },
  {
    id: "commissions",
    title: "کمیسیون‌ها",
    description: "تنظیمات آماده‌سازی‌شده برای مدل‌های کمیسیون آینده",
    settingKeys: [
      "ReservationCommissionPercent",
      "ReferralCommissionPercent",
      "CommissionType3Percent",
    ],
  },
] as const;

const knownSiteSettingKeys = new Set<string>(
  siteSettingsSections.flatMap((section) => section.settingKeys),
);

const imageLabels: Record<string, string> = {
  "site.logoUrl": "لوگوی سایت",
  "home.heroBackgroundUrl": "تصویر پس‌زمینه صفحه اصلی",
};

const settingDisplayLabels: Record<string, string> = {
  ReservationCommissionPercent: "کمیسیون رزرو عادی",
  ReferralCommissionPercent: "کمیسیون رزرو از لینک پذیرش",
  CommissionType3Percent: "کمیسیون رزرو از لینک اختصاصی اقامتگاه",
  "reservation.freeChildMaxAge": "حداکثر سن کودک رایگان",
  "reservation.halfPriceChildMinAge": "حداقل سن کودک نیم‌بها",
  "reservation.halfPriceChildMaxAge": "حداکثر سن کودک نیم‌بها",
  "reservation.halfPriceChildRate": "درصد کودک نیم‌بها",
};

const commissionSettingKeys = [
  "ReservationCommissionPercent",
  "ReferralCommissionPercent",
  "CommissionType3Percent",
] as const;
const reservationDeadlineSettingKeys = [
  "reservation.paymentWindowMinutes",
  "reservation.ownerApprovalWindowMinutes",
  "reservation.ownerApprovalReminderIntervalMinutes",
] as const;

function inputType(type: SiteSettingType) {
  if (type === "Color") return "color";
  if (type === "Number") return "number";
  return "text";
}

function genericControlId(setting: SiteSettingResponse) {
  const safeKey = setting.key.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `site-setting-${setting.id}-${safeKey}`;
}

function validateGenericSetting(
  setting: SiteSettingResponse,
  value: string,
) {
  if (setting.type !== "Number") return undefined;

  if (value.trim() === "" || !Number.isFinite(Number(value))) {
    return "یک عدد معتبر وارد کنید";
  }

  const numberValue = Number(value);
  if (
    commissionSettingKeys.includes(
      setting.key as (typeof commissionSettingKeys)[number],
    )
  ) {
    return numberValue < 0 || numberValue > 100
      ? "درصد کمیسیون باید بین ۰ تا ۱۰۰ باشد"
      : undefined;
  }

  if (
    reservationDeadlineSettingKeys.includes(
      setting.key as (typeof reservationDeadlineSettingKeys)[number],
    )
  ) {
    return !Number.isInteger(numberValue) ||
      numberValue < 1 ||
      numberValue > 10080
      ? "مهلت رزرو باید یک عدد صحیح بین ۱ دقیقه و ۷ روز باشد"
      : undefined;
  }

  return numberValue < 1 ? "مقدار باید حداقل ۱ باشد" : undefined;
}

function parseBooleanValue(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function isGenericSettingDirty(
  setting: SiteSettingResponse,
  draftValue: string,
) {
  if (setting.type === "ImageUrl") return false;

  if (setting.type === "Number") {
    const persistedIsNumeric =
      setting.value.trim() !== "" && Number.isFinite(Number(setting.value));
    const draftIsNumeric =
      draftValue.trim() !== "" && Number.isFinite(Number(draftValue));

    return persistedIsNumeric && draftIsNumeric
      ? Number(setting.value) !== Number(draftValue)
      : setting.value !== draftValue;
  }

  if (setting.type === "Boolean") {
    const persistedBoolean = parseBooleanValue(setting.value);
    const draftBoolean = parseBooleanValue(draftValue);

    return persistedBoolean !== null && draftBoolean !== null
      ? persistedBoolean !== draftBoolean
      : setting.value !== draftValue;
  }

  return setting.value !== draftValue;
}

function toPricingBoundsDraft(
  bounds: PricingBoundsResponse,
): PricingBoundsDraft {
  return {
    minPrice: String(bounds.minPrice),
    maxPrice: String(bounds.maxPrice),
  };
}

function validatePricingBounds(draft: PricingBoundsDraft) {
  const errors: PricingBoundsErrors = {};
  const parsed: PricingBoundsResponse = {
    minPrice: Number(draft.minPrice),
    maxPrice: Number(draft.maxPrice),
  };

  for (const key of ["minPrice", "maxPrice"] as const) {
    if (draft[key].trim() === "") {
      errors[key] = "این مقدار الزامی است";
    } else if (!Number.isFinite(parsed[key])) {
      errors[key] = "یک عدد معتبر وارد کنید";
    } else if (parsed[key] < 0) {
      errors[key] = "مقدار نمی‌تواند منفی باشد";
    }
  }

  if (
    Object.keys(errors).length === 0 &&
    parsed.minPrice > parsed.maxPrice
  ) {
    errors.maxPrice = "حداکثر قیمت باید بزرگ‌تر یا مساوی حداقل قیمت باشد";
  }

  return {
    errors,
    parsed: Object.keys(errors).length === 0 ? parsed : null,
  };
}

export default function AdminSiteSettingsPage() {
  const {
    authenticated,
    loading: sessionLoading,
    workspaces,
  } = useAuthSession();
  const hasAdminWorkspace = workspaces.includes("admin");
  const [settings, setSettings] = useState<SiteSettingResponse[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  const [pricingBounds, setPricingBounds] =
    useState<PricingBoundsResponse | null>(null);
  const [pricingBoundsDraft, setPricingBoundsDraft] =
    useState<PricingBoundsDraft>({ minPrice: "", maxPrice: "" });
  const [pricingBoundsLoading, setPricingBoundsLoading] = useState(true);
  const [pricingBoundsSaving, setPricingBoundsSaving] = useState(false);
  const [pricingBoundsError, setPricingBoundsError] = useState<string | null>(
    null,
  );
  const genericLoadPendingRef = useRef(false);

  const loadGenericSettings = useCallback(async () => {
    if (genericLoadPendingRef.current) return;

    genericLoadPendingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const items = await apiRequest<SiteSettingResponse[]>(
        "/admin/site-settings",
      );
      setSettings(items);
      setDrafts(
        Object.fromEntries(items.map((item) => [item.key, item.value])),
      );
    } catch {
      setLoadError("دریافت تنظیمات سایت انجام نشد.");
    } finally {
      genericLoadPendingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionLoading || !authenticated || !hasAdminWorkspace) return;

    void loadGenericSettings();
  }, [authenticated, hasAdminWorkspace, loadGenericSettings, sessionLoading]);

  useEffect(() => {
    if (sessionLoading || !authenticated || !hasAdminWorkspace) return;

    apiRequest<PricingBoundsResponse>(
      "/admin/site-settings/pricing-bounds",
    )
      .then((bounds) => {
        setPricingBounds(bounds);
        setPricingBoundsDraft(toPricingBoundsDraft(bounds));
        setPricingBoundsError(null);
      })
      .catch((caught: Error) =>
        setPricingBoundsError(
          caught.message || "محدوده قیمت بارگذاری نشد",
        ),
      )
      .finally(() => setPricingBoundsLoading(false));
  }, [authenticated, hasAdminWorkspace, sessionLoading]);

  const sectionedSettings = useMemo(() => {
    return siteSettingsSections.map((section) => ({
      ...section,
      includesPricingBounds:
        "includesPricingBounds" in section && section.includesPricingBounds,
      items: settings.filter((setting) =>
        section.settingKeys.some((key) => key === setting.key),
      ),
    }));
  }, [settings]);

  const unmappedSettings = useMemo(
    () => settings.filter((setting) => !knownSiteSettingKeys.has(setting.key)),
    [settings],
  );

  const genericInventoryAvailable = !loading && loadError === null;
  const visibleSections = sectionedSettings.filter(
    (section) =>
      section.includesPricingBounds ||
      (genericInventoryAvailable && section.items.length > 0),
  );

  async function updateSetting(key: string, value: string) {
    return apiRequest<SiteSettingResponse>(
      `/admin/site-settings/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: JSON.stringify({ value }),
      },
    );
  }

  async function save(setting: SiteSettingResponse) {
    const draftValue = drafts[setting.key] ?? "";
    if (
      savingKeys.has(setting.key) ||
      validateGenericSetting(setting, draftValue) ||
      !isGenericSettingDirty(setting, draftValue)
    ) {
      return;
    }

    setSavingKeys((current) => new Set(current).add(setting.key));
    try {
      const response = await updateSetting(setting.key, draftValue);
      const updatedSettings = [
        {
          ...response,
          value:
            typeof response.value === "string" ? response.value : draftValue,
        },
      ];

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
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(setting.key);
        return next;
      });
    }
  }

  const pricingBoundsValidation = validatePricingBounds(pricingBoundsDraft);
  const pricingBoundsDirty =
    pricingBounds !== null &&
    pricingBoundsValidation.parsed !== null &&
    (pricingBoundsValidation.parsed.minPrice !== pricingBounds.minPrice ||
      pricingBoundsValidation.parsed.maxPrice !== pricingBounds.maxPrice);

  function updatePricingBound(
    key: keyof PricingBoundsDraft,
    value: string,
  ) {
    setPricingBoundsDraft((current) => ({ ...current, [key]: value }));
    setPricingBoundsError(null);
  }

  async function savePricingBounds() {
    const { parsed } = validatePricingBounds(pricingBoundsDraft);
    if (!parsed || !pricingBoundsDirty || pricingBoundsSaving) return;

    setPricingBoundsSaving(true);
    setPricingBoundsError(null);
    try {
      const updated = await apiRequest<PricingBoundsResponse>(
        "/admin/site-settings/pricing-bounds",
        {
          method: "PUT",
          body: JSON.stringify(parsed),
        },
      );
      setPricingBounds(updated);
      setPricingBoundsDraft(toPricingBoundsDraft(updated));
      toast.success("محدوده قیمت ذخیره شد");
    } catch (caught) {
      setPricingBoundsError(
        caught instanceof Error
          ? caught.message
          : "ذخیره محدوده قیمت ناموفق بود",
      );
    } finally {
      setPricingBoundsSaving(false);
    }
  }

  function renderInput(
    setting: SiteSettingResponse,
    accessibility?: GenericFieldAccessibility,
  ) {
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
          autoUpload
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
              ? "پس از انتخاب فایل معتبر، تصویر به‌صورت خودکار بارگذاری و ذخیره می‌شود."
              : "پس از انتخاب و تأیید برش تصویر، فایل به‌صورت خودکار بارگذاری و ذخیره می‌شود.",
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
          aria-describedby={accessibility?.describedBy}
          className="font-bold leading-7"
          error={accessibility?.error}
          id={accessibility?.controlId}
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
          aria-describedby={accessibility?.describedBy}
          error={accessibility?.error}
          id={accessibility?.controlId}
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

    const numberInput = (
      <KoochInput
        aria-describedby={accessibility?.describedBy}
        className="font-bold"
        dir="rtl"
        error={accessibility?.error}
        id={accessibility?.controlId}
        onChange={(event) =>
          setDrafts((current) => ({
            ...current,
            [setting.key]: event.target.value,
          }))
        }
        type={inputType(setting.type)}
        max={
          reservationDeadlineSettingKeys.includes(
            setting.key as (typeof reservationDeadlineSettingKeys)[number],
          )
            ? 10080
            : commissionSettingKeys.includes(
                  setting.key as (typeof commissionSettingKeys)[number],
                )
              ? 100
              : undefined
        }
        min={
          setting.type === "Number"
            ? commissionSettingKeys.includes(
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

    return reservationDeadlineSettingKeys.includes(
      setting.key as (typeof reservationDeadlineSettingKeys)[number],
    ) ? (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">{numberInput}</div>
        <span className="shrink-0 text-sm font-bold text-muted-foreground">
          دقیقه
        </span>
      </div>
    ) : (
      numberInput
    );
  }

  function renderSetting(setting: SiteSettingResponse) {
    const isImage = setting.type === "ImageUrl";
    const controlId = genericControlId(setting);
    const descriptionId = setting.description
      ? `${controlId}-description`
      : undefined;
    const error = isImage
      ? undefined
      : validateGenericSetting(setting, drafts[setting.key] ?? "");
    const errorId = error ? `${controlId}-error` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") ||
      undefined;
    const isDirty = isGenericSettingDirty(
      setting,
      drafts[setting.key] ?? "",
    );
    const isSaving = savingKeys.has(setting.key);

    return (
      <div
        className="grid gap-3 rounded-lg border border-border bg-muted p-4"
        key={setting.key}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <label
              className="font-bold text-foreground"
              htmlFor={isImage ? undefined : controlId}
            >
              {settingDisplayLabels[setting.key] ??
                imageLabels[setting.key] ??
                setting.label}
            </label>
            {setting.description && (
              <p
                className="mt-2 text-sm leading-6 text-muted-foreground"
                id={descriptionId}
              >
                {setting.description}
              </p>
            )}
          </div>
          {setting.type !== "ImageUrl" && (
            <KoochButton
              disabled={!isDirty || Boolean(error) || isSaving}
              loading={isSaving}
              onClick={() => save(setting)}
              size="sm"
              type="button"
            >
              ذخیره
            </KoochButton>
          )}
        </div>
        <div>
          {renderInput(setting, {
            controlId,
            describedBy,
            error,
          })}
          {error && (
            <p
              aria-atomic="true"
              className="mt-2 text-xs font-medium text-destructive"
              id={errorId}
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <AdminLayout requiredPlatformPermission="ManageSettings">
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          appearance="plain"
          description="تنظیمات عمومی، برند، تصاویر و مقادیر مرکزی سایت را مدیریت کنید."
          eyebrow="پنل مدیریت"
          title="تنظیمات سایت"
        />
        <nav aria-label="بخش‌های تنظیمات سایت">
          <KoochCard
            className="flex flex-wrap items-center gap-2"
            padding="sm"
          >
            {visibleSections.map((section) => (
              <a
                className="inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                href={`#${section.id}`}
                key={section.id}
              >
                {section.title}
              </a>
            ))}
          </KoochCard>
        </nav>
        {loading && (
          <KoochCard aria-live="polite" role="status" variant="elevated">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none"
              />
              <p>در حال بارگذاری تنظیمات...</p>
            </div>
          </KoochCard>
        )}
        {!loading && loadError && (
          <KoochAlert
            title="دریافت تنظیمات سایت انجام نشد"
            variant="destructive"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>اتصال را بررسی کنید و دوباره تلاش کنید.</p>
              <KoochButton
                disabled={loading}
                loading={loading}
                onClick={loadGenericSettings}
                size="sm"
                type="button"
                variant="outline"
              >
                تلاش دوباره
              </KoochButton>
            </div>
          </KoochAlert>
        )}
        {!loading && !loadError && settings.length === 0 && (
          <KoochCard
            className="border-dashed text-center"
            padding="lg"
            variant="elevated"
          >
            <p className="text-sm text-muted-foreground">
              تنظیمی برای نمایش وجود ندارد.
            </p>
          </KoochCard>
        )}
        {visibleSections.map((section) => (
          <KoochCard
            className="scroll-mt-24"
            id={section.id}
            key={section.id}
            variant="elevated"
          >
            <div className="grid gap-1">
              <h2 className="text-xl font-semibold text-foreground">
                {section.title}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {section.description}
              </p>
            </div>
            <div className="mt-5 grid gap-5">
              {section.includesPricingBounds && (
                <div className="grid gap-4 rounded-lg border border-border bg-muted p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <h3 className="font-semibold text-foreground">
                        محدوده قیمت روزانه
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">
                        حداقل و حداکثر قیمت مجاز را به‌صورت یکپارچه تنظیم کنید.
                      </p>
                    </div>
                    <KoochButton
                      disabled={
                        pricingBoundsLoading ||
                        pricingBoundsSaving ||
                        !pricingBoundsDirty
                      }
                      loading={pricingBoundsSaving}
                      onClick={savePricingBounds}
                      size="sm"
                      type="button"
                    >
                      ذخیره محدوده قیمت
                    </KoochButton>
                  </div>

                  {pricingBoundsLoading ? (
                    <p className="text-sm text-muted-foreground">
                      در حال بارگذاری محدوده قیمت...
                    </p>
                  ) : pricingBounds === null ? (
                    <KoochAlert
                      title="محدوده قیمت بارگذاری نشد"
                      variant="destructive"
                    >
                      {pricingBoundsError ?? "دوباره تلاش کنید."}
                    </KoochAlert>
                  ) : (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <KoochField
                          error={pricingBoundsValidation.errors.minPrice}
                          label="حداقل قیمت روزانه"
                          required
                        >
                          <KoochInput
                            dir="ltr"
                            error={pricingBoundsValidation.errors.minPrice}
                            inputMode="decimal"
                            min={0}
                            onChange={(event) =>
                              updatePricingBound(
                                "minPrice",
                                event.target.value,
                              )
                            }
                            required
                            step="any"
                            type="number"
                            value={pricingBoundsDraft.minPrice}
                          />
                        </KoochField>
                        <KoochField
                          error={pricingBoundsValidation.errors.maxPrice}
                          label="حداکثر قیمت روزانه"
                          required
                        >
                          <KoochInput
                            dir="ltr"
                            error={pricingBoundsValidation.errors.maxPrice}
                            inputMode="decimal"
                            min={0}
                            onChange={(event) =>
                              updatePricingBound(
                                "maxPrice",
                                event.target.value,
                              )
                            }
                            required
                            step="any"
                            type="number"
                            value={pricingBoundsDraft.maxPrice}
                          />
                        </KoochField>
                      </div>
                      {pricingBoundsError && (
                        <KoochAlert
                          title="ذخیره محدوده قیمت انجام نشد"
                          variant="destructive"
                        >
                          {pricingBoundsError}
                        </KoochAlert>
                      )}
                    </>
                  )}
                </div>
              )}
              {genericInventoryAvailable &&
                section.id === "commissions" && (
                <p className="rounded-lg border border-border bg-muted p-3 text-sm leading-6 text-muted-foreground">
                  این تنظیمات برای جریان‌های کمیسیون آینده آماده شده‌اند و در حال
                  حاضر در محاسبات رزروهای فعال اعمال نمی‌شوند.
                </p>
              )}
              {genericInventoryAvailable && section.items.map(renderSetting)}
            </div>
          </KoochCard>
        ))}
        {genericInventoryAvailable && unmappedSettings.length > 0 && (
          <KoochCard variant="elevated">
            <div className="grid gap-1">
              <h2 className="text-xl font-semibold text-foreground">
                سایر تنظیمات
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                تنظیمات جدیدی که هنوز در بخش‌های اصلی دسته‌بندی نشده‌اند.
              </p>
            </div>
            <div className="mt-5 grid gap-5">
              {unmappedSettings.map(renderSetting)}
            </div>
          </KoochCard>
        )}
      </main>
    </AdminLayout>
  );
}
