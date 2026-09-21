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

function validateGenericSetting(setting: SiteSettingResponse, value: string) {
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

  if (Object.keys(errors).length === 0 && parsed.minPrice > parsed.maxPrice) {
    errors.maxPrice = "حداکثر قیمت باید بزرگ‌تر یا مساوی حداقل قیمت باشد";
  }

  return {
    errors,
    parsed: Object.keys(errors).length === 0 ? parsed : null,
  };
}

function findScrollContainer(element: HTMLElement) {
  let parent = element.parentElement;

  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }

  return window;
}

function sectionScrollOffset(navigation: HTMLElement) {
  return navigation.getBoundingClientRect().height + 8;
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
  const [savingSectionIds, setSavingSectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const savingSectionIdsRef = useRef<Set<string>>(new Set());
  const [pricingBounds, setPricingBounds] =
    useState<PricingBoundsResponse | null>(null);
  const [pricingBoundsDraft, setPricingBoundsDraft] =
    useState<PricingBoundsDraft>({ minPrice: "", maxPrice: "" });
  const [pricingBoundsLoading, setPricingBoundsLoading] = useState(true);
  const [pricingBoundsError, setPricingBoundsError] = useState<string | null>(
    null,
  );
  const genericLoadPendingRef = useRef(false);
  const sectionNavRef = useRef<HTMLElement>(null);
  const sectionNavSentinelRef = useRef<HTMLDivElement>(null);
  const programmaticSectionRef = useRef<string | null>(null);
  const [sectionNavStuck, setSectionNavStuck] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string>(
    siteSettingsSections[0].id,
  );

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

    apiRequest<PricingBoundsResponse>("/admin/site-settings/pricing-bounds")
      .then((bounds) => {
        setPricingBounds(bounds);
        setPricingBoundsDraft(toPricingBoundsDraft(bounds));
        setPricingBoundsError(null);
      })
      .catch((caught: Error) =>
        setPricingBoundsError(caught.message || "محدوده قیمت بارگذاری نشد"),
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
  const visibleSections = useMemo(
    () =>
      sectionedSettings.filter(
        (section) =>
          section.includesPricingBounds ||
          (genericInventoryAvailable && section.items.length > 0),
      ),
    [genericInventoryAvailable, sectionedSettings],
  );
  const visibleSectionIds = useMemo(
    () => visibleSections.map((section) => section.id),
    [visibleSections],
  );

  useEffect(() => {
    const sentinel = sectionNavSentinelRef.current;
    const navigation = sectionNavRef.current;
    if (!sentinel || !navigation || visibleSectionIds.length === 0) return;

    const scrollContainer = findScrollContainer(sentinel);
    const updateNavigationState = () => {
      const containerElement =
        scrollContainer === window ? null : (scrollContainer as HTMLElement);
      const viewportTop = containerElement
        ? containerElement.getBoundingClientRect().top
        : 0;
      const viewportHeight = containerElement
        ? containerElement.clientHeight
        : window.innerHeight;
      const offset = sectionScrollOffset(navigation);
      const availableHeight = Math.max(0, viewportHeight - offset);
      const activationLine =
        viewportTop + offset + Math.min(220, Math.max(72, availableHeight * 0.35));
      const scrollingElement =
        scrollContainer === window
          ? document.scrollingElement ?? document.documentElement
          : containerElement;
      const currentScroll = scrollingElement?.scrollTop ?? 0;
      const maximumScroll = Math.max(
        0,
        (scrollingElement?.scrollHeight ?? 0) -
          (scrollingElement?.clientHeight ?? viewportHeight),
      );
      const atScrollEnd = maximumScroll - currentScroll <= 2;

      setSectionNavStuck(
        sentinel.getBoundingClientRect().top <= viewportTop,
      );

      let nextActiveSection = visibleSectionIds[0];
      for (const sectionId of visibleSectionIds) {
        const section = document.getElementById(sectionId);
        if (!section) continue;

        section.style.scrollMarginTop = `${offset}px`;
        if (section.getBoundingClientRect().top <= activationLine) {
          nextActiveSection = sectionId;
        }
      }

      // Short final sections may never reach the activation line. At the real
      // bottom of the scroll area, the final visible section is authoritative.
      if (atScrollEnd) {
        nextActiveSection = visibleSectionIds[visibleSectionIds.length - 1];
      }

      const targetId = programmaticSectionRef.current;
      if (targetId) {
        const targetExists =
          visibleSectionIds.includes(
            targetId as (typeof visibleSectionIds)[number],
          ) && Boolean(document.getElementById(targetId));
        if (targetExists) {
          setActiveSectionId(targetId);
          return;
        }
        programmaticSectionRef.current = null;
      }

      setActiveSectionId(nextActiveSection);
    };

    const interruptNavigation = () => {
      if (!programmaticSectionRef.current) return;
      programmaticSectionRef.current = null;
      updateNavigationState();
    };
    const interruptNavigationWithKeyboard = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      ) {
        interruptNavigation();
      }
    };

    updateNavigationState();
    scrollContainer.addEventListener("scroll", updateNavigationState, {
      passive: true,
    });
    scrollContainer.addEventListener("wheel", interruptNavigation, { passive: true });
    scrollContainer.addEventListener("touchmove", interruptNavigation, { passive: true });
    scrollContainer.addEventListener("pointerdown", interruptNavigation, { passive: true });
    window.addEventListener("keydown", interruptNavigationWithKeyboard);
    window.addEventListener("resize", updateNavigationState);
    const navigationResizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateNavigationState);
    navigationResizeObserver?.observe(navigation);

    return () => {
      navigationResizeObserver?.disconnect();
      scrollContainer.removeEventListener("scroll", updateNavigationState);
      scrollContainer.removeEventListener("wheel", interruptNavigation);
      scrollContainer.removeEventListener("touchmove", interruptNavigation);
      scrollContainer.removeEventListener("pointerdown", interruptNavigation);
      window.removeEventListener("keydown", interruptNavigationWithKeyboard);
      window.removeEventListener("resize", updateNavigationState);
    };
  }, [visibleSectionIds]);

  function navigateToSection(
    event: React.MouseEvent<HTMLAnchorElement>,
    sectionId: string,
  ) {
    event.preventDefault();
    const section = document.getElementById(sectionId);
    if (!section) return;

    if (sectionNavRef.current) {
      section.style.scrollMarginTop = `${sectionScrollOffset(sectionNavRef.current)}px`;
    }
    programmaticSectionRef.current = sectionId;
    setActiveSectionId(sectionId);
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView?.({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
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

  const pricingBoundsValidation = validatePricingBounds(pricingBoundsDraft);
  const pricingBoundsDirty =
    pricingBounds !== null &&
    (pricingBoundsValidation.parsed !== null
      ? pricingBoundsValidation.parsed.minPrice !== pricingBounds.minPrice ||
        pricingBoundsValidation.parsed.maxPrice !== pricingBounds.maxPrice
      : pricingBoundsDraft.minPrice !== String(pricingBounds.minPrice) ||
        pricingBoundsDraft.maxPrice !== String(pricingBounds.maxPrice));

  function updatePricingBound(key: keyof PricingBoundsDraft, value: string) {
    setPricingBoundsDraft((current) => ({ ...current, [key]: value }));
    setPricingBoundsError(null);
  }

  function dirtySettingsForSection(items: SiteSettingResponse[]) {
    return items.filter(
      (setting) =>
        setting.type !== "ImageUrl" &&
        isGenericSettingDirty(setting, drafts[setting.key] ?? ""),
    );
  }

  function sectionHasValidationError(
    items: SiteSettingResponse[],
    includesPricingBounds: boolean,
  ) {
    const genericError = items.some(
      (setting) =>
        setting.type !== "ImageUrl" &&
        Boolean(validateGenericSetting(setting, drafts[setting.key] ?? "")),
    );
    const pricingError =
      includesPricingBounds &&
      pricingBoundsDirty &&
      pricingBoundsValidation.parsed === null;

    return genericError || pricingError;
  }

  function sectionChangeCount(
    items: SiteSettingResponse[],
    includesPricingBounds: boolean,
  ) {
    return (
      dirtySettingsForSection(items).length +
      (includesPricingBounds && pricingBoundsDirty ? 1 : 0)
    );
  }

  function sectionHasSaveableContent(
    items: SiteSettingResponse[],
    includesPricingBounds: boolean,
  ) {
    return (
      includesPricingBounds ||
      items.some((setting) => setting.type !== "ImageUrl")
    );
  }

  async function saveSection(
    sectionId: string,
    items: SiteSettingResponse[],
    includesPricingBounds: boolean,
  ) {
    if (savingSectionIdsRef.current.has(sectionId)) return;

    const dirtySettings = dirtySettingsForSection(items);
    const shouldSavePricing = includesPricingBounds && pricingBoundsDirty;
    const parsedPricing = pricingBoundsValidation.parsed;

    if (dirtySettings.length === 0 && !shouldSavePricing) return;

    if (
      sectionHasValidationError(items, includesPricingBounds) ||
      (shouldSavePricing && !parsedPricing)
    ) {
      toast.error("مقادیر این بخش را بررسی کنید.");
      return;
    }

    savingSectionIdsRef.current.add(sectionId);
    setSavingSectionIds((current) => new Set(current).add(sectionId));
    if (shouldSavePricing) setPricingBoundsError(null);

    type SectionSaveResult =
      | {
          kind: "setting";
          updated: SiteSettingResponse;
          submittedValue: string;
        }
      | {
          kind: "pricing";
          updated: PricingBoundsResponse;
          submittedValue: PricingBoundsResponse;
        };

    const tasks: Promise<SectionSaveResult>[] = dirtySettings.map((setting) => {
      const submittedValue = drafts[setting.key] ?? "";
      return updateSetting(setting.key, submittedValue).then((response) => ({
        kind: "setting" as const,
        submittedValue,
        updated: {
          ...response,
          value:
            typeof response.value === "string"
              ? response.value
              : submittedValue,
        },
      }));
    });

    let pricingTaskIndex: number | null = null;
    if (shouldSavePricing && parsedPricing) {
      pricingTaskIndex = tasks.length;
      const submittedValue = { ...parsedPricing };
      tasks.push(
        apiRequest<PricingBoundsResponse>(
          "/admin/site-settings/pricing-bounds",
          {
            method: "PUT",
            body: JSON.stringify(submittedValue),
          },
        ).then((updated) => ({
          kind: "pricing" as const,
          updated,
          submittedValue,
        })),
      );
    }

    try {
      const results = await Promise.allSettled(tasks);
      const fulfilled = results
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<SectionSaveResult> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);
      const updatedSettings = fulfilled.filter(
        (
          result,
        ): result is Extract<SectionSaveResult, { kind: "setting" }> =>
          result.kind === "setting",
      );
      const updatedPricing = fulfilled.find(
        (
          result,
        ): result is Extract<SectionSaveResult, { kind: "pricing" }> =>
          result.kind === "pricing",
      );

      if (updatedSettings.length > 0) {
        setSettings((current) =>
          current.map(
            (item) =>
              updatedSettings.find(
                (result) => result.updated.key === item.key,
              )?.updated ?? item,
          ),
        );
        setDrafts((current) => {
          const next = { ...current };
          updatedSettings.forEach((result) => {
            if (current[result.updated.key] === result.submittedValue) {
              next[result.updated.key] = result.updated.value;
            }
          });
          return next;
        });
      }

      if (updatedPricing) {
        setPricingBounds(updatedPricing.updated);
        setPricingBoundsDraft((current) => {
          const unchangedSinceSubmit =
            Number(current.minPrice) === updatedPricing.submittedValue.minPrice &&
            Number(current.maxPrice) === updatedPricing.submittedValue.maxPrice;
          return unchangedSinceSubmit
            ? toPricingBoundsDraft(updatedPricing.updated)
            : current;
        });
        setPricingBoundsError(null);
      }

      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );

      if (
        pricingTaskIndex !== null &&
        results[pricingTaskIndex]?.status === "rejected"
      ) {
        const failure = results[pricingTaskIndex] as PromiseRejectedResult;
        setPricingBoundsError(
          failure.reason instanceof Error
            ? failure.reason.message
            : "ذخیره محدوده قیمت ناموفق بود",
        );
      }

      if (rejected.length > 0) {
        const firstFailure = rejected[0].reason;
        toast.error(
          firstFailure instanceof Error
            ? firstFailure.message
            : "بخشی از تغییرات این بخش ذخیره نشد.",
        );
      } else {
        toast.success("تغییرات این بخش ذخیره شد");
      }
    } finally {
      savingSectionIdsRef.current.delete(sectionId);
      setSavingSectionIds((current) => {
        const next = new Set(current);
        next.delete(sectionId);
        return next;
      });
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
      const immediateSaveDescription = isLogo
        ? "پس از انتخاب فایل معتبر، تصویر به‌صورت خودکار بارگذاری و ذخیره می‌شود."
        : "پس از انتخاب و تأیید برش تصویر، فایل به‌صورت خودکار بارگذاری و ذخیره می‌شود.";

      return (
        <div className={isLogo ? "max-w-[176px]" : "max-w-lg"}>
          <SharedUploader
            accept={
              isLogo
                ? ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]
                : ["image/png", "image/jpeg", "image/webp"]
            }
            autoUpload
            allowDeleteExisting={isLogo || setting.key === "home.heroBackgroundUrl"}
            embedded
            onDeleteExisting={
              isLogo || setting.key === "home.heroBackgroundUrl"
                ? async () => {
                    const updated = await apiRequest<SiteSettingResponse>(
                      `/admin/site-settings/${encodeURIComponent(setting.key)}/image`,
                      { method: "DELETE" },
                    );
                    setSettings((current) =>
                      current.map((item) => item.key === updated.key ? updated : item),
                    );
                    setDrafts((current) => ({ ...current, [updated.key]: updated.value }));
                    toast.success("تصویر حذف شد");
                  }
                : undefined
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
              description: immediateSaveDescription,
              browseText: "انتخاب تصویر",
              uploadText: "آپلود",
              uploadingText: "در حال آپلود...",
              successText: "تصویر آپلود و ذخیره شد",
              previewText: "پیش‌نمایش",
              existingEmptyText: "تصویری ثبت نشده است.",
              addPhotoText: "افزودن عکس",
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
          <p className="text-xs leading-5 text-muted-foreground">
            {immediateSaveDescription}
          </p>
        </div>
      );
    }

    if (setting.type === "LongText") {
      return (
        <KoochTextarea
          aria-describedby={accessibility?.describedBy}
          className="leading-7"
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
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          دقیقه
        </span>
      </div>
    ) : (
      numberInput
    );
  }

  function renderPricingBoundsFields() {
    if (pricingBoundsLoading) {
      return (
        <div className="md:col-span-2">
          <p className="text-sm text-muted-foreground">
            در حال بارگذاری محدوده قیمت...
          </p>
        </div>
      );
    }

    if (pricingBounds === null) {
      return (
        <div className="md:col-span-2">
          <KoochAlert
            title="محدوده قیمت بارگذاری نشد"
            variant="destructive"
          >
            {pricingBoundsError ?? "دوباره تلاش کنید."}
          </KoochAlert>
        </div>
      );
    }

    return (
      <>
        <div className="min-w-0">
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
                updatePricingBound("minPrice", event.target.value)
              }
              required
              step="any"
              type="number"
              value={pricingBoundsDraft.minPrice}
            />
          </KoochField>
        </div>
        <div className="min-w-0">
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
                updatePricingBound("maxPrice", event.target.value)
              }
              required
              step="any"
              type="number"
              value={pricingBoundsDraft.maxPrice}
            />
          </KoochField>
        </div>
        {pricingBoundsError && (
          <div className="md:col-span-3">
            <KoochAlert
              title="ذخیره محدوده قیمت انجام نشد"
              variant="destructive"
            >
              {pricingBoundsError}
            </KoochAlert>
          </div>
        )}
      </>
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
    const describedBy =
      [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
    const fieldWidthClass = isImage
      ? ""
      : setting.type === "Number" || setting.type === "Boolean"
        ? "w-full"
        : "w-full";

    return (
      <div className="min-w-0" key={setting.key}>
        <div className={`grid content-start gap-2 ${fieldWidthClass}`}>
          <label
            className="text-sm font-medium leading-6 text-foreground"
            htmlFor={isImage ? undefined : controlId}
          >
            {settingDisplayLabels[setting.key] ??
              imageLabels[setting.key] ??
              setting.label}
          </label>

          <div className="min-w-0">
            {renderInput(setting, {
              controlId,
              describedBy,
              error,
            })}
            {setting.description && (
              <p
                className="mt-1.5 text-xs leading-5 text-muted-foreground"
                id={descriptionId}
              >
                {setting.description}
              </p>
            )}
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
      </div>
    );
  }

  function renderSettingByKey(
    items: SiteSettingResponse[],
    key: string,
  ) {
    const setting = items.find((item) => item.key === key);
    return setting ? renderSetting(setting) : null;
  }

  function renderSectionFields(
    id: string,
    items: SiteSettingResponse[],
    includesPricingBounds: boolean,
  ) {
    if (id === "identity-and-brand") {
      return (
        <div className="grid gap-8 md:grid-cols-2 md:gap-x-12">
          <div className="grid content-start gap-7">
            {renderSettingByKey(items, "site.name")}
            {renderSettingByKey(items, "site.footerText")}
          </div>
          <div className="min-w-0">
            {renderSettingByKey(items, "site.logoUrl")}
          </div>
        </div>
      );
    }

    if (id === "homepage") {
      return (
        <div className="grid gap-8 md:grid-cols-2 md:gap-x-12 md:gap-y-10">
          <div className="grid content-start gap-7">
            {renderSettingByKey(items, "home.heroTitle")}
            {renderSettingByKey(items, "home.heroSubtitle")}
          </div>
          <div className="min-w-0">
            {renderSettingByKey(items, "home.heroBackgroundUrl")}
          </div>
          <div className="grid content-start gap-7">
            {renderSettingByKey(items, "home.searchButtonText")}
            {renderSettingByKey(items, "home.popularSectionTitle")}
          </div>
          <div className="min-w-0">
            {renderSettingByKey(items, "home.popularSectionSubtitle")}
          </div>
        </div>
      );
    }

    const desktopColumns =
      id === "images-and-uploads" ||
      id === "pricing-and-currency" ||
      id === "seo" ||
      id === "commissions"
        ? "md:grid-cols-3"
        : "md:grid-cols-2";

    return (
      <div className={`grid gap-x-8 gap-y-7 ${desktopColumns}`}>
        {genericInventoryAvailable && items.map(renderSetting)}
        {includesPricingBounds && renderPricingBoundsFields()}
      </div>
    );
  }

  function renderSectionCard({
    id,
    title,
    description,
    items,
    includesPricingBounds = false,
    showCommissionNotice = false,
  }: {
    id: string;
    title: string;
    description: string;
    items: SiteSettingResponse[];
    includesPricingBounds?: boolean;
    showCommissionNotice?: boolean;
  }) {
    const changeCount = sectionChangeCount(items, includesPricingBounds);
    const hasValidationError = sectionHasValidationError(
      items,
      includesPricingBounds,
    );
    const isSaving = savingSectionIds.has(id);
    const hasSaveableContent = sectionHasSaveableContent(
      items,
      includesPricingBounds,
    );

    return (
      <KoochCard id={id} key={id} variant="elevated">
        <div className="grid gap-1.5">
          <h2 className="text-lg font-semibold leading-7 text-foreground sm:text-xl">
            {title}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>

        {showCommissionNotice && (
          <p className="mt-4 rounded-lg bg-muted px-3 py-2.5 text-sm leading-6 text-muted-foreground">
            این تنظیمات برای جریان‌های کمیسیون آینده آماده شده‌اند و در حال
            حاضر در محاسبات رزروهای فعال اعمال نمی‌شوند.
          </p>
        )}

        <div className="mt-5 border-t border-border pt-5">
          {renderSectionFields(id, items, includesPricingBounds)}
        </div>

        {hasSaveableContent && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            {changeCount > 0 && (
              <p
                aria-live="polite"
                className="text-xs font-medium text-foreground"
              >
                {`${changeCount} تغییر ذخیره‌نشده`}
              </p>
            )}
            <KoochButton
              disabled={
                changeCount === 0 || hasValidationError || isSaving
              }
              loading={isSaving}
              onClick={() =>
                void saveSection(id, items, includesPricingBounds)
              }
              size="sm"
              type="button"
            >
              ذخیره تغییرات
            </KoochButton>
          </div>
        )}
      </KoochCard>
    );
  }

  return (
    <AdminLayout requiredPlatformPermission="ManageSettings">
      <main className="w-full">
        <div className="mx-auto grid w-full max-w-[1480px] gap-6 px-4 pt-4 sm:px-5 sm:pt-5 lg:px-6 lg:pt-6">
          <KoochPageHeader
            appearance="plain"
            description="تنظیمات عمومی، برند، تصاویر و مقادیر مرکزی سایت را مدیریت کنید."
            eyebrow="پنل مدیریت"
            title="تنظیمات سایت"
          />
          <div
            aria-hidden="true"
            className="h-px"
            ref={sectionNavSentinelRef}
          />
        </div>
        <nav
          aria-label="بخش‌های تنظیمات سایت"
          className={`sticky top-0 z-30 w-full transition-colors ${
            sectionNavStuck ? "bg-card shadow-sm" : "bg-transparent"
          }`}
          ref={sectionNavRef}
        >
          <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-5 lg:px-6">
            <div
              className={`flex flex-nowrap items-center gap-1.5 overflow-x-auto border bg-card sm:gap-2 ${
                sectionNavStuck
                  ? "rounded-none border-transparent"
                  : "rounded-lg border-border"
              }`}
            >
              {visibleSections.map((section) => (
                <a
                  aria-current={
                    activeSectionId === section.id ? "location" : undefined
                  }
                  className={`relative inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-3 py-1.5 text-sm font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    activeSectionId === section.id
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  href={`#${section.id}`}
                  key={section.id}
                  onClick={(event) => navigateToSection(event, section.id)}
                >
                  {section.title}
                  {activeSectionId === section.id && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 bottom-0 h-0.5 bg-primary"
                    />
                  )}
                </a>
              ))}
            </div>
          </div>
        </nav>
        <div className="mx-auto grid w-full max-w-[1480px] gap-6 px-4 pb-4 pt-6 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6">
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
          {visibleSections.map((section) =>
            renderSectionCard({
              id: section.id,
              title: section.title,
              description: section.description,
              items: section.items,
              includesPricingBounds: section.includesPricingBounds,
              showCommissionNotice: section.id === "commissions",
            }),
          )}
          {genericInventoryAvailable &&
            unmappedSettings.length > 0 &&
            renderSectionCard({
              id: "other-settings",
              title: "سایر تنظیمات",
              description:
                "تنظیمات جدیدی که هنوز در بخش‌های اصلی دسته‌بندی نشده‌اند.",
              items: unmappedSettings,
            })}
        </div>
      </main>
    </AdminLayout>
  );
}
