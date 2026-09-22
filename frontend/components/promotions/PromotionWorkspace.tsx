"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiRequest,
  PropertyResponse,
  PromotionResponse,
  PromotionType,
  PromotionWeekday,
  RoomTypeResponse,
} from "@/lib/owner-api";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import { KoochWeekdaySelector } from "@/components/KoochWeekdaySelector";
import { useSiteCurrencyLabel } from "@/lib/currency";
import { KoochIcon } from "../KoochIcon";

const promotionTypes: { value: PromotionType; label: string }[] = [
  { value: "PercentageDiscount", label: "تخفیف درصدی" },
  { value: "FixedAmountDiscount", label: "تخفیف مبلغ ثابت" },
  { value: "LastMinute", label: "لحظه آخری" },
  { value: "Informational", label: "اطلاع‌رسانی" },
];

const weekdays: { value: PromotionWeekday; label: string }[] = [
  { value: "Saturday", label: "شنبه‌ها" },
  { value: "Sunday", label: "یکشنبه‌ها" },
  { value: "Monday", label: "دوشنبه‌ها" },
  { value: "Tuesday", label: "سه‌شنبه‌ها" },
  { value: "Wednesday", label: "چهارشنبه‌ها" },
  { value: "Thursday", label: "پنجشنبه‌ها" },
  { value: "Friday", label: "جمعه‌ها" },
];

type WizardStep = 1 | 2 | 3 | 4;

type FieldErrorKey =
  | "title"
  | "percentage"
  | "amount"
  | "lastMinuteDays"
  | "dates"
  | "weekdays"
  | "roomTypeIds"
  | "minimumStayNights"
  | "minimumGuests"
  | "publicDescription"
  | "badgeColor";

type FieldErrors = Partial<Record<FieldErrorKey, string>>;

const wizardSteps: { step: WizardStep; label: string }[] = [
  { step: 1, label: "اطلاعات اصلی" },
  { step: 2, label: "زمان و شرایط" },
  { step: 3, label: "محتوا و ظاهر" },
  { step: 4, label: "بازبینی و تأیید" },
];

const promotionDefaultIcons: Record<PromotionType, string> = {
  PercentageDiscount: "🏷️",
  FixedAmountDiscount: "🎁",
  LastMinute: "⚡",
  Informational: "✨",
};

const emojiOptions = [
  { value: "🏷️", label: "تخفیف" },
  { value: "🎁", label: "هدیه" },
  { value: "⚡", label: "لحظه آخری" },
  { value: "✨", label: "پیشنهاد ویژه" },
  { value: "💰", label: "تخفیف مالی" },
  { value: "🌟", label: "ویژه" },
  { value: "🔥", label: "پیشنهاد داغ" },
  { value: "🏨", label: "اقامت" },
  { value: "🌙", label: "شب بیشتر" },
  { value: "🍽️", label: "پذیرایی" },
  { value: "🎫", label: "پکیج" },
  { value: "❤️", label: "محبوب" },
];

const badgeColorPresets = [
  { value: "", label: "پیش‌فرض" },
  { value: "#2563eb", label: "آبی" },
  { value: "#16a34a", label: "سبز" },
  { value: "#7c3aed", label: "بنفش" },
  { value: "#ea580c", label: "نارنجی" },
  { value: "#dc2626", label: "قرمز" },
];

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

function normalizeIntegerInput(value: string) {
  const normalizedDigits = value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

  return normalizedDigits.replace(/[^0-9]/g, "");
}

function formatGroupedIntegerInput(value: string) {
  if (!/^\d+$/.test(value)) return value;
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatPromotionDate(value: string) {
  if (!value) return "—";
  return new Date(`${value}T12:00:00`).toLocaleDateString("fa-IR");
}

function getBadgeTextColor(backgroundColor: string) {
  if (!hexColorPattern.test(backgroundColor)) return "#ffffff";

  const red = Number.parseInt(backgroundColor.slice(1, 3), 16);
  const green = Number.parseInt(backgroundColor.slice(3, 5), 16);
  const blue = Number.parseInt(backgroundColor.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.62 ? "#111827" : "#ffffff";
}

function hexToRgba(color: string, alpha: number) {
  if (!hexColorPattern.test(color)) return undefined;

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function promotionValueLabel(
  promotion: PromotionResponse,
  currencyLabel: string,
) {
  if (
    promotion.type === "PercentageDiscount" &&
    promotion.percentage !== null
  ) {
    return `${promotion.percentage.toLocaleString("fa-IR")}٪`;
  }

  if (
    promotion.type === "FixedAmountDiscount" &&
    promotion.amount !== null
  ) {
    return `${promotion.amount.toLocaleString("fa-IR")} ${currencyLabel}`;
  }

  if (promotion.type === "LastMinute") {
    const parts = [
      promotion.percentage !== null
        ? `${promotion.percentage.toLocaleString("fa-IR")}٪`
        : "",
      promotion.lastMinuteDays !== null
        ? `تا ${promotion.lastMinuteDays.toLocaleString("fa-IR")} روز مانده`
        : "",
    ].filter(Boolean);

    return parts.join(" · ");
  }

  return "—";
}

function InlineFieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p className="text-xs font-semibold text-destructive" role="alert">
      {message}
    </p>
  );
}

function FieldHelpPopover({ help }: { help: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <span className="relative inline-flex shrink-0" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={open ? "بستن توضیح" : "نمایش توضیح"}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-primary bg-transparent p-0 text-[10px] font-bold leading-none text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        type="button"
      >
        i
      </button>

      {open && (
        <span
          className="absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover px-3 py-2 text-right text-xs font-normal leading-5 text-popover-foreground shadow-lg"
          role="note"
        >
          {help}
        </span>
      )}
    </span>
  );
}

function FieldHelpLabel({
  children,
  help,
  required = false,
}: {
  children: ReactNode;
  help: string;
  required?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span>
        {children}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            {" "}
            *
          </span>
        )}
      </span>

      <FieldHelpPopover help={help} />
    </span>
  );
}

type Draft = {
  propertyId: number | null;
  title: string;
  internalDescription: string;
  publicDescription: string;
  optionalIcon: string;
  badgeColor: string;
  minimumStayNights: string;
  minimumGuests: string;
  startDate: string;
  endDate: string;
  weekdays: PromotionWeekday[];
  roomTypeIds: number[];
  type: PromotionType;
  percentage: string;
  amount: string;
  lastMinuteDays: string;
  isActive: boolean;
  isPublished: boolean;
};

const dateControlClass =
  "h-9 px-3 py-1.5 text-xs font-medium text-foreground/80 transition";
const today = () => new Date().toISOString().slice(0, 10);

function emptyDraft(propertyId: number | null = null): Draft {
  return {
    propertyId,
    title: "",
    internalDescription: "",
    publicDescription: "",
    optionalIcon: "",
    badgeColor: "",
    minimumStayNights: "",
    minimumGuests: "",
    startDate: today(),
    endDate: today(),
    weekdays: weekdays.map((day) => day.value),
    roomTypeIds: [],
    type: "PercentageDiscount",
    percentage: "",
    amount: "",
    lastMinuteDays: "3",
    isActive: true,
    isPublished: false,
  };
}

const typeLabel = (type: PromotionType) =>
  promotionTypes.find((item) => item.value === type)?.label ?? type;

export function PromotionWorkspace({
  propertyId,
  admin = false,
}: {
  propertyId?: number;
  admin?: boolean;
}) {
  const currencyLabel = useSiteCurrencyLabel();
  const [promotions, setPromotions] = useState<PromotionResponse[]>([]);
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [rooms, setRooms] = useState<RoomTypeResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<PromotionType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [propertyFilter, setPropertyFilter] = useState<number | "all">("all");
  const [editing, setEditing] = useState<PromotionResponse | null>(null);
  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(propertyId ?? null),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<WizardStep>(1);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [customColorMode, setCustomColorMode] = useState(false);
  const [expandedPromotionId, setExpandedPromotionId] = useState<number | null>(
    null,
  );
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const apiBase = admin
    ? "/admin/promotions"
    : `/owner/properties/${propertyId}/promotions`;
  const loadPromotions = useCallback(async () => {
    setPromotions(await apiRequest<PromotionResponse[]>(apiBase));
  }, [apiBase]);

  useEffect(() => {
    Promise.all([
      loadPromotions(),
      admin
        ? apiRequest<PropertyResponse[]>("/admin/properties").then(
            setProperties,
          )
        : Promise.resolve(),
      propertyId
        ? apiRequest<RoomTypeResponse[]>(
            `/owner/properties/${propertyId}/room-types`,
          ).then(setRooms)
        : Promise.resolve(),
    ])
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, [admin, loadPromotions, propertyId]);

  useEffect(() => {
    if (!admin || !draft.propertyId) {
      if (admin) setRooms([]);
      return;
    }
    apiRequest<RoomTypeResponse[]>(
      `/owner/properties/${draft.propertyId}/room-types`,
    )
      .then(setRooms)
      .catch((error: Error) => toast.error(error.message));
  }, [admin, draft.propertyId]);

  const filtered = useMemo(
    () =>
      promotions.filter((promotion) => {
        const query = search.trim().toLocaleLowerCase();
        return (
          (!query ||
            `${promotion.title} ${promotion.propertyName} ${promotion.internalDescription ?? ""}`
              .toLocaleLowerCase()
              .includes(query)) &&
          (typeFilter === "all" || promotion.type === typeFilter) &&
          (statusFilter === "all" ||
            promotion.isActive === (statusFilter === "active")) &&
          (propertyFilter === "all" || promotion.propertyId === propertyFilter)
        );
      }),
    [promotions, propertyFilter, search, statusFilter, typeFilter],
  );

  const hasActiveFilters =
    search.trim().length > 0 ||
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    (admin && propertyFilter !== "all");

  function resetFilters() {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
    setPropertyFilter("all");
  }

  function openNew() {
    const selectedProperty = admin
      ? null
      : (propertyId ??
        (propertyFilter !== "all"
          ? propertyFilter
          : (properties[0]?.id ?? null)));
    setEditing(null);
    setDraft(emptyDraft(selectedProperty));
    setCurrentStep(1);
    setMaxReachedStep(1);
    setFieldErrors({});
    setCustomColorMode(false);
    setModalOpen(true);
  }

  function openEdit(promotion: PromotionResponse) {
    if (!promotion.canEdit || (!admin && promotion.source === "Admin")) {
      toast.error(
        "پروموشن‌های مدیریتی فقط قابل فعال‌سازی، غیرفعال‌سازی یا کپی هستند",
      );
      return;
    }
    setEditing(promotion);
    setDraft({
      propertyId: promotion.propertyId,
      title: promotion.title,
      internalDescription: promotion.internalDescription ?? "",
      publicDescription: promotion.publicDescription ?? "",
      optionalIcon: promotion.optionalIcon ?? "",
      badgeColor: promotion.badgeColor ?? "",
      minimumStayNights: promotion.minimumStayNights?.toString() ?? "",
      minimumGuests: promotion.minimumGuests?.toString() ?? "",
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      weekdays: promotion.weekdays,
      roomTypeIds: promotion.roomTypes.map((room) => room.id),
      type: promotion.type,
      percentage: promotion.percentage?.toString() ?? "",
      amount: promotion.amount?.toString() ?? "",
      lastMinuteDays: promotion.lastMinuteDays?.toString() ?? "3",
      isActive: promotion.isActive,
      isPublished: promotion.isPublished,
    });
    setCurrentStep(1);
    setMaxReachedStep(4);
    setFieldErrors({});
    setCustomColorMode(
      Boolean(promotion.badgeColor) &&
        !badgeColorPresets.some(
          (option) => option.value === promotion.badgeColor,
        ),
    );
    setModalOpen(true);
  }

  function validateStep(step: WizardStep): FieldErrors {
    const errors: FieldErrors = {};

    if (step === 1) {
      if (!draft.title.trim()) {
        errors.title = "عنوان پروموشن الزامی است.";
      }

      if (
        draft.type === "PercentageDiscount" ||
        draft.type === "LastMinute"
      ) {
        const value = Number(draft.percentage);
        if (
          !draft.percentage.trim() ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 100
        ) {
          errors.percentage = "درصد تخفیف باید بین صفر تا صد باشد.";
        }
      }

      if (draft.type === "FixedAmountDiscount") {
        const amount = Number(draft.amount);
        if (
          !draft.amount.trim() ||
          !Number.isFinite(amount) ||
          amount < 0
        ) {
          errors.amount = "مبلغ تخفیف معتبر نیست.";
        } else {
          const selectedRooms = rooms.filter((room) =>
            draft.roomTypeIds.includes(room.id),
          );
          if (
            selectedRooms.some(
              (room) => room.basePrice !== null && amount > room.basePrice,
            )
          ) {
            errors.amount =
              "مبلغ تخفیف نمی‌تواند از نرخ پایه اتاق بیشتر باشد.";
          }
        }
      }

      if (draft.type === "LastMinute") {
        const days = Number(draft.lastMinuteDays);
        if (
          !draft.lastMinuteDays.trim() ||
          !Number.isInteger(days) ||
          days < 0
        ) {
          errors.lastMinuteDays =
            "تعداد روزهای باقی‌مانده برای پروموشن لحظه آخری معتبر نیست.";
        }
      }
    }

    if (step === 2) {
      if (draft.startDate > draft.endDate) {
        errors.dates = "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.";
      }

      if (!draft.weekdays.length) {
        errors.weekdays = "حداقل یک روز هفته را انتخاب کنید.";
      }

      if (!admin && !draft.roomTypeIds.length) {
        errors.roomTypeIds = "حداقل یک اتاق را انتخاب کنید.";
      }

      if (draft.minimumStayNights) {
        const nights = Number(draft.minimumStayNights);
        if (!Number.isInteger(nights) || nights < 0) {
          errors.minimumStayNights = "حداقل تعداد شب معتبر نیست.";
        }
      }

      if (draft.minimumGuests) {
        const guests = Number(draft.minimumGuests);
        if (!Number.isInteger(guests) || guests < 0) {
          errors.minimumGuests = "حداقل تعداد مهمان معتبر نیست.";
        }
      }
    }

    if (step === 3) {
      if (
        draft.type === "Informational" &&
        !draft.publicDescription.trim()
      ) {
        errors.publicDescription =
          "توضیحات عمومی برای پروموشن اطلاع‌رسانی الزامی است.";
      }

      if (
        customColorMode &&
        !hexColorPattern.test(draft.badgeColor)
      ) {
        errors.badgeColor = "کد رنگ باید به‌صورت کامل مثل #2563eb باشد.";
      }
    }

    return errors;
  }

  function firstInvalidStep(errors: FieldErrors): WizardStep {
    const keys = Object.keys(errors) as FieldErrorKey[];

    if (
      keys.some((key) =>
        ["title", "percentage", "amount", "lastMinuteDays"].includes(key),
      )
    ) {
      return 1;
    }

    if (
      keys.some((key) =>
        [
          "dates",
          "weekdays",
          "roomTypeIds",
          "minimumStayNights",
          "minimumGuests",
        ].includes(key),
      )
    ) {
      return 2;
    }

    return 3;
  }

  function goToNextStep() {
    const errors = validateStep(currentStep);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const nextStep = Math.min(4, currentStep + 1) as WizardStep;
    setFieldErrors({});
    setMaxReachedStep((step) =>
      Math.max(step, nextStep) as WizardStep,
    );
    setCurrentStep(nextStep);
  }

  function goToPreviousStep() {
    setFieldErrors({});
    setCurrentStep((step) => Math.max(1, step - 1) as WizardStep);
  }

  function goToWizardStep(step: WizardStep) {
    const canNavigate = editing !== null || step <= maxReachedStep;
    if (!canNavigate || step === currentStep) return;

    setFieldErrors({});
    setCurrentStep(step);
  }

  function validate() {
    const errors: FieldErrors = {
      ...validateStep(1),
      ...validateStep(2),
      ...validateStep(3),
    };

    return errors;
  }

  async function savePromotion() {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      const invalidStep = firstInvalidStep(validationErrors);
      setFieldErrors(validationErrors);
      setMaxReachedStep((step) =>
        Math.max(step, invalidStep) as WizardStep,
      );
      setCurrentStep(invalidStep);
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      const payload = {
        ...draft,
        percentage:
          draft.type === "PercentageDiscount" || draft.type === "LastMinute"
            ? Number(draft.percentage)
            : null,
        amount:
          draft.type === "FixedAmountDiscount" ? Number(draft.amount) : null,
        lastMinuteDays:
          draft.type === "LastMinute" ? Number(draft.lastMinuteDays) : null,
        minimumStayNights: draft.minimumStayNights
          ? Number(draft.minimumStayNights)
          : null,
        minimumGuests: draft.minimumGuests ? Number(draft.minimumGuests) : null,
        sortOrder: editing?.sortOrder ?? promotions.length,
      };
      await apiRequest<PromotionResponse>(
        editing ? `${apiBase}/${editing.id}` : apiBase,
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      await loadPromotions();
      setModalOpen(false);
      toast.success(editing ? "پروموشن ویرایش شد" : "پروموشن ایجاد شد");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ذخیره پروموشن انجام نشد",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggle(promotion: PromotionResponse) {
    try {
      if (!admin && promotion.isLibraryTemplate) {
        await apiRequest(`${apiBase}/library/${promotion.id}/activate`, {
          method: "POST",
        });
        await loadPromotions();
        toast.success("پروموشن مدیریتی فعال شد");
        return;
      }
      await apiRequest(`${apiBase}/${promotion.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !promotion.isActive }),
      });
      setPromotions((current) =>
        current.map((item) =>
          item.id === promotion.id
            ? { ...item, isActive: !item.isActive }
            : item,
        ),
      );
      toast.success(
        promotion.isActive ? "پروموشن غیرفعال شد" : "پروموشن فعال شد",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تغییر وضعیت انجام نشد",
      );
    }
  }

  async function duplicate(promotion: PromotionResponse) {
    try {
      await apiRequest(`${apiBase}/${promotion.id}/duplicate`, {
        method: "POST",
      });
      await loadPromotions();
      toast.success("یک کپی غیرفعال از پروموشن ساخته شد");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "کپی پروموشن انجام نشد",
      );
    }
  }

  async function remove(promotion: PromotionResponse) {
    try {
      await apiRequest(`${apiBase}/${promotion.id}`, { method: "DELETE" });
      setPromotions((current) =>
        current.filter((item) => item.id !== promotion.id),
      );
      toast.success("پروموشن حذف شد");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "حذف پروموشن انجام نشد",
      );
    }
  }

  async function drop(targetId: number) {
    if (draggedId === null || draggedId === targetId) return;
    const sourceIndex = promotions.findIndex((item) => item.id === draggedId);
    const targetIndex = promotions.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reordered = [...promotions];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setPromotions(reordered);
    setDraggedId(null);
    try {
      await apiRequest(`${apiBase}/sort-order`, {
        method: "PUT",
        body: JSON.stringify({
          promotionIds: reordered.map((item) => item.id),
        }),
      });
      toast.success("ترتیب پروموشن‌ها ذخیره شد");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ذخیره ترتیب انجام نشد",
      );
      await loadPromotions();
    }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <KoochCard variant="elevated">
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <KoochButton
              className="w-full shrink-0 sm:w-auto"
              onClick={openNew}
              type="button"
            >
              <KoochIcon name="plus"></KoochIcon>
              پروموشن جدید
            </KoochButton>
            <KoochInput
              className="min-w-0 flex-1"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجو در پروموشن‌ها"
              type="search"
              value={search}
            />

            {hasActiveFilters && (
              <KoochButton
                className="w-full shrink-0 sm:w-auto"
                onClick={resetFilters}
                size="sm"
                type="button"
                variant="outline"
              >
                حذف فیلترها
              </KoochButton>
            )}
          </div>

          <div
            className={`grid gap-3 ${
              admin ? "md:grid-cols-3" : "md:grid-cols-2"
            }`}
          >
            {admin && (
              <div className="min-w-0">
                <KoochSelect
                  onChange={(event) =>
                    setPropertyFilter(
                      event.target.value === "all"
                        ? "all"
                        : Number(event.target.value),
                    )
                  }
                  value={propertyFilter}
                >
                  <option value="all">همه اقامتگاه‌ها</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </KoochSelect>
              </div>
            )}

            <div className="min-w-0">
              <KoochSelect
                onChange={(event) =>
                  setTypeFilter(event.target.value as PromotionType | "all")
                }
                value={typeFilter}
              >
                <option value="all">همه انواع</option>
                {promotionTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </KoochSelect>
            </div>

            <div className="min-w-0">
              <KoochSelect
                onChange={(event) =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
                value={statusFilter}
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="active">فعال</option>
                <option value="inactive">غیرفعال</option>
              </KoochSelect>
            </div>
          </div>

        </div>
      </KoochCard>

      {loading && (
        <KoochCard className="text-center" padding="lg" variant="elevated">
          <p className="text-sm text-muted-foreground">
            در حال بارگذاری پروموشن‌ها...
          </p>
        </KoochCard>
      )}
      {!loading && !filtered.length && (
        <KoochCard
          className="border-dashed text-center"
          padding="lg"
          variant="elevated"
        >
          <p className="text-sm text-muted-foreground">
            {promotions.length === 0
              ? "هنوز پروموشنی ثبت نشده است."
              : "پروموشنی با این فیلتر پیدا نشد."}
          </p>
        </KoochCard>
      )}
      {!loading && filtered.length > 0 && (
        <section
          aria-label="فهرست پروموشن‌ها"
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <div className="hidden border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-semibold text-muted-foreground lg:grid lg:grid-cols-[minmax(220px,2fr)_minmax(120px,1fr)_minmax(140px,1fr)_minmax(150px,1.2fr)_auto] lg:items-center lg:gap-4">
            <span>
              پروموشن ({filtered.length.toLocaleString("fa-IR")})
            </span>
            <span>وضعیت</span>
            <span>{admin ? "اقامتگاه" : "منبع"}</span>
            <span>بازه اجرا</span>
            <span className="w-8" aria-hidden="true" />
          </div>

          {filtered.map((promotion, index) => {
            const expanded = expandedPromotionId === promotion.id;
            const weekdayLabels = promotion.weekdays
              .map(
                (day) =>
                  weekdays.find((item) => item.value === day)?.label,
              )
              .filter(Boolean)
              .join("، ");

            return (
              <article
                className={`${index > 0 ? "border-t border-border" : ""} ${
                  promotion.isActive ? "" : "opacity-75"
                }`}
                draggable={!promotion.isLibraryTemplate}
                key={promotion.id}
                onDragOver={(event) =>
                  !promotion.isLibraryTemplate && event.preventDefault()
                }
                onDragStart={() =>
                  !promotion.isLibraryTemplate && setDraggedId(promotion.id)
                }
                onDrop={() =>
                  !promotion.isLibraryTemplate && drop(promotion.id)
                }
              >
                <button
                  aria-expanded={expanded}
                  className="grid w-full gap-3 px-4 py-3 text-right transition hover:bg-muted/35 lg:grid-cols-[minmax(220px,2fr)_minmax(120px,1fr)_minmax(140px,1fr)_minmax(150px,1.2fr)_auto] lg:items-center lg:gap-4"
                  onClick={() =>
                    setExpandedPromotionId((current) =>
                      current === promotion.id ? null : promotion.id,
                    )
                  }
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="truncate text-sm font-bold text-foreground">
                        {promotion.title}
                      </strong>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {typeLabel(promotion.type)}
                      </span>
                      {promotion.isLibraryTemplate && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          کتابخانه
                        </span>
                      )}
                    </span>

                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground lg:hidden">
                      <span>
                        {promotionValueLabel(promotion, currencyLabel)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatPromotionDate(promotion.startDate)} تا{" "}
                        {formatPromotionDate(promotion.endDate)}
                      </span>
                    </span>
                  </span>

                  <span className="flex flex-wrap items-center gap-1.5">
                    {!promotion.isLibraryTemplate && (
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                          promotion.isActive
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {promotion.isActive ? "فعال" : "غیرفعال"}
                      </span>
                    )}

                    {admin && promotion.source === "Admin" && (
                      <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                        {promotion.isPublished
                          ? "منتشر شده"
                          : "منتشر نشده"}
                      </span>
                    )}

                    {!admin && (
                      <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                        {promotion.source === "Admin"
                          ? "کتابخانه"
                          : "اختصاصی"}
                      </span>
                    )}
                  </span>

                  <span className="truncate text-xs text-muted-foreground">
                    {admin
                      ? promotion.propertyName
                      : promotion.source === "Admin"
                        ? "قالب مدیریتی"
                        : "پروموشن اقامتگاه"}
                  </span>

                  <span className="hidden text-xs leading-5 text-muted-foreground lg:block">
                    {formatPromotionDate(promotion.startDate)}
                    <span className="mx-1">تا</span>
                    {formatPromotionDate(promotion.endDate)}
                  </span>

                  <span
                    aria-hidden="true"
                    className={`grid h-8 w-8 place-items-center rounded-lg border border-border bg-background text-sm text-muted-foreground transition-transform ${
                      expanded ? "rotate-180" : ""
                    }`}
                  >
                    ⌄
                  </span>
                </button>

                {expanded && (
                  <div
                    className="border-y border-primary/15 bg-[var(--theme-primary-soft)] px-4 py-3"
                    style={
                      promotion.badgeColor &&
                      hexColorPattern.test(promotion.badgeColor)
                        ? {
                            backgroundColor: hexToRgba(
                              promotion.badgeColor,
                              0.06,
                            ),
                            borderColor: hexToRgba(
                              promotion.badgeColor,
                              0.16,
                            ),
                          }
                        : undefined
                    }
                  >
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
                      <div className="grid content-start gap-4">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border/70 pb-2 text-xs">
                          <span className="text-muted-foreground">
                            شروع:
                            <strong className="mr-1.5 font-semibold text-foreground">
                              {formatPromotionDate(promotion.startDate)}
                            </strong>
                          </span>
                          <span className="text-muted-foreground">
                            پایان:
                            <strong className="mr-1.5 font-semibold text-foreground">
                              {formatPromotionDate(promotion.endDate)}
                            </strong>
                          </span>
                        </div>

                        <dl className="grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 xl:grid-cols-3">
                          <div>
                            <dt className="text-[11px] text-muted-foreground">
                              نوع و مقدار
                            </dt>
                            <dd className="mt-1 font-semibold text-foreground">
                              {typeLabel(promotion.type)}
                              {promotionValueLabel(
                                promotion,
                                currencyLabel,
                              ) !== "—" &&
                                ` · ${promotionValueLabel(
                                  promotion,
                                  currencyLabel,
                                )}`}
                            </dd>
                          </div>

                          <div>
                            <dt className="text-[11px] text-muted-foreground">
                              روزهای اجرا
                            </dt>
                            <dd className="mt-1 leading-5 text-foreground/80">
                              {weekdayLabels || "—"}
                            </dd>
                          </div>

                          <div>
                            <dt className="text-[11px] text-muted-foreground">
                              شرایط اقامت
                            </dt>
                            <dd className="mt-1 leading-5 text-foreground/80">
                              {promotion.minimumStayNights
                                ? `حداقل ${promotion.minimumStayNights.toLocaleString(
                                    "fa-IR",
                                  )} شب`
                                : "بدون حداقل شب"}
                              {" · "}
                              {promotion.minimumGuests
                                ? `حداقل ${promotion.minimumGuests.toLocaleString(
                                    "fa-IR",
                                  )} مهمان`
                                : "بدون حداقل مهمان"}
                            </dd>
                          </div>

                          <div>
                            <dt className="text-[11px] text-muted-foreground">
                              اتاق‌های انتخاب‌شده
                            </dt>
                            <dd className="mt-1 font-semibold text-foreground">
                              {promotion.roomTypes.length.toLocaleString(
                                "fa-IR",
                              )}{" "}
                              اتاق
                            </dd>
                          </div>

                          <div>
                            <dt className="text-[11px] text-muted-foreground">
                              ایجادکننده
                            </dt>
                            <dd className="mt-1 text-foreground/80">
                              {promotion.createdBy}
                            </dd>
                          </div>

                          <div>
                            <dt className="text-[11px] text-muted-foreground">
                              منبع
                            </dt>
                            <dd className="mt-1 text-foreground/80">
                              {promotion.source === "Admin"
                                ? "Admin Promotion"
                                : "Owner Promotion"}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="grid content-start gap-3">
                        <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                          <p className="text-[11px] font-semibold text-muted-foreground">
                            توضیحات عمومی
                          </p>
                          <p className="mt-1 text-xs leading-5 text-foreground/80">
                            {promotion.publicDescription || "—"}
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                          <p className="text-[11px] font-semibold text-muted-foreground">
                            توضیحات داخلی
                          </p>
                          <p className="mt-1 text-xs leading-5 text-foreground/80">
                            {promotion.internalDescription || "—"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 xl:col-span-2">
                        <div className="flex flex-wrap gap-1.5">
                          {promotion.canEdit &&
                            !(!admin &&
                              promotion.source === "Admin") && (
                              <KoochButton
                                onClick={() => openEdit(promotion)}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                ویرایش
                              </KoochButton>
                            )}

                          <KoochButton
                            onClick={() => toggle(promotion)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {promotion.isLibraryTemplate
                              ? "فعال‌سازی"
                              : promotion.isActive
                                ? "غیرفعال کردن"
                                : "فعال کردن"}
                          </KoochButton>

                          <KoochButton
                            onClick={() => duplicate(promotion)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {!admin && promotion.source === "Admin"
                              ? "کپی خصوصی"
                              : "کپی"}
                          </KoochButton>

                          {(admin || promotion.source === "Owner") && (
                            <KoochConfirmDialog
                              cancelText="انصراف"
                              confirmText="حذف"
                              description={`آیا از حذف پروموشن «${promotion.title}» مطمئن هستید؟ این عملیات قابل بازگشت نیست.`}
                              onConfirm={() => remove(promotion)}
                              title="حذف پروموشن"
                              trigger={
                                <KoochButton
                                  size="sm"
                                  type="button"
                                  variant="destructive"
                                >
                                  حذف
                                </KoochButton>
                              }
                              variant="destructive"
                            />
                          )}
                        </div>

                        {!promotion.isLibraryTemplate && (
                          <p className="text-[10px] text-muted-foreground">
                            ☰ برای تغییر ترتیب، ردیف را بکشید.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      <KoochDialog
        closeDisabled={saving}
        footer={
          <>
            <KoochButton
              disabled={saving}
              onClick={() => setModalOpen(false)}
              type="button"
              variant="outline"
            >
              لغو
            </KoochButton>

            {currentStep > 1 && (
              <KoochButton
                disabled={saving}
                onClick={goToPreviousStep}
                type="button"
                variant="outline"
              >
                بازگشت
              </KoochButton>
            )}

            {currentStep < 4 ? (
              <KoochButton
                disabled={saving}
                onClick={goToNextStep}
                type="button"
                variant="primary"
              >
                ادامه
              </KoochButton>
            ) : (
              <KoochButton
                disabled={saving}
                loading={saving}
                onClick={() => void savePromotion()}
                type="button"
                variant="primary"
              >
                {admin && draft.isPublished
                  ? "تأیید و انتشار"
                  : "تأیید و ذخیره"}
              </KoochButton>
            )}
          </>
        }
        onOpenChange={(open) => {
          if (!open && !saving) {
            setModalOpen(false);
            setFieldErrors({});
            setCustomColorMode(false);
          }
        }}
        open={modalOpen}
        size="lg"
        title={
          admin
            ? editing
              ? "ویرایش قالب پروموشن"
              : "قالب پروموشن جدید"
            : editing
              ? "ویرایش پروموشن"
              : "پروموشن جدید"
        }
      >
        <form
          className="grid gap-5"
          id="promotion-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <div>
            <div className="grid gap-3 sm:hidden">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-muted-foreground">
                    مرحله {currentStep.toLocaleString("fa-IR")} از ۴
                  </p>
                  <p className="mt-1 text-sm font-bold text-foreground">
                    {wizardSteps.find((item) => item.step === currentStep)?.label}
                  </p>
                </div>
                <div
                  aria-hidden="true"
                  className="h-2 w-28 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${currentStep * 25}%` }}
                  />
                </div>
              </div>

              <div
                aria-label="مراحل ثبت پروموشن"
                className="grid grid-cols-4 gap-2"
              >
                {wizardSteps.map((item) => {
                  const isCurrent = item.step === currentStep;
                  const canNavigate =
                    editing !== null || item.step <= maxReachedStep;

                  return (
                    <button
                      aria-current={isCurrent ? "step" : undefined}
                      className={`grid min-w-0 justify-items-center gap-1 rounded-lg px-1 py-1.5 transition ${
                        isCurrent
                          ? "bg-primary/10 text-primary"
                          : canNavigate
                            ? "text-foreground hover:bg-muted"
                            : "cursor-not-allowed text-muted-foreground/50"
                      }`}
                      disabled={!canNavigate}
                      key={item.step}
                      onClick={() => goToWizardStep(item.step)}
                      type="button"
                    >
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold ${
                          isCurrent
                            ? "border-primary bg-primary text-primary-foreground"
                            : canNavigate
                              ? "border-border bg-background"
                              : "border-border/60 bg-muted/40"
                        }`}
                      >
                        {item.step.toLocaleString("fa-IR")}
                      </span>
                      <span className="max-w-full truncate text-[9px] font-semibold">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <ol
              aria-label="مراحل ثبت پروموشن"
              className="relative hidden grid-cols-4 sm:grid"
            >
              {wizardSteps.map((item, index) => {
                const isCurrent = item.step === currentStep;
                const isComplete = item.step < currentStep;
                const isUpcoming = item.step > currentStep;
                const canNavigate =
                  editing !== null || item.step <= maxReachedStep;

                return (
                  <li
                    aria-current={isCurrent ? "step" : undefined}
                    className="relative min-w-0 px-2 text-center"
                    key={item.step}
                  >
                    {index < wizardSteps.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={`absolute top-4 z-0 h-px ${
                          isComplete ? "bg-primary" : "bg-border"
                        }`}
                        style={{
                          left: "calc(-50% + 16px)",
                          right: "calc(50% + 16px)",
                        }}
                      />
                    )}

                    <button
                      className={`relative z-10 mx-auto flex w-fit flex-col items-center rounded-lg px-2 py-1 transition ${
                        canNavigate
                          ? "cursor-pointer hover:bg-muted/60"
                          : "cursor-not-allowed"
                      }`}
                      disabled={!canNavigate}
                      onClick={() => goToWizardStep(item.step)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-extrabold shadow-sm transition ${
                          isCurrent
                            ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/10"
                            : isComplete
                              ? "border-primary bg-primary text-primary-foreground"
                              : canNavigate
                                ? "border-border bg-background text-muted-foreground"
                                : "border-border/60 bg-muted/40 text-muted-foreground/50"
                        }`}
                      >
                        {isComplete ? "✓" : item.step.toLocaleString("fa-IR")}
                      </span>

                      <span
                        className={`mt-1.5 block max-w-28 text-[11px] font-bold leading-4 ${
                          isCurrent
                            ? "text-primary"
                            : !canNavigate
                              ? "text-muted-foreground/50"
                              : isUpcoming
                                ? "text-muted-foreground"
                                : "text-foreground"
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {admin && (
            <div className="rounded-xl border border-border bg-muted px-3 py-2.5 text-xs font-normal leading-5 text-muted-foreground">
              این مورد به‌عنوان قالب مدیریتی ساخته می‌شود و در مرحله آخر
              می‌توانید درباره انتشار آن در کتابخانه مالک‌ها تصمیم بگیرید.
            </div>
          )}

          {Object.keys(fieldErrors).length > 0 && (
            <div
              aria-live="polite"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs font-semibold text-destructive"
            >
              لطفاً موارد مشخص‌شده در این مرحله را اصلاح کنید.
            </div>
          )}

          {currentStep === 1 && (
            <section aria-labelledby="promotion-step-main" className="grid gap-4">
              <div>
                <h3
                  className="text-base font-bold text-foreground"
                  id="promotion-step-main"
                >
                  اطلاعات اصلی
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  عنوان، نوع و مقدار اصلی پروموشن را مشخص کنید.
                </p>
              </div>

              <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                <span>
                  عنوان پروموشن
                  <span aria-hidden="true" className="text-destructive">
                    {" "}
                    *
                  </span>
                </span>
                <KoochInput
                      className="text-xs font-medium text-foreground/80"
                  aria-invalid={Boolean(fieldErrors.title)}
                  maxLength={150}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="مثلاً تخفیف پاییزی اقامت"
                  required
                  value={draft.title}
                />
                <InlineFieldError message={fieldErrors.title} />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                  نوع پروموشن
                  <KoochSelect
                    className="text-xs font-medium text-foreground/80"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        type: event.target.value as PromotionType,
                      }))
                    }
                    value={draft.type}
                  >
                    {promotionTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </KoochSelect>
                </label>

                {(draft.type === "PercentageDiscount" ||
                  draft.type === "LastMinute") && (
                  <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                    درصد تخفیف
                    <KoochInput
                      className="text-xs font-medium text-foreground/80"
                      aria-invalid={Boolean(fieldErrors.percentage)}
                      inputMode="decimal"
                      max="100"
                      min="0"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          percentage: event.target.value,
                        }))
                      }
                      placeholder="مثلاً ۱۵"
                      step="0.1"
                      type="number"
                      value={draft.percentage}
                    />
                    <InlineFieldError message={fieldErrors.percentage} />
                  </label>
                )}

                {draft.type === "FixedAmountDiscount" && (
                  <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                    مبلغ تخفیف ({currencyLabel})
                    <KoochInput
                      className="text-xs font-medium text-foreground/80"
                      aria-invalid={Boolean(fieldErrors.amount)}
                      inputMode="numeric"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          amount: normalizeIntegerInput(event.target.value),
                        }))
                      }
                      pattern="[0-9]*"
                      placeholder="مثلاً 1,500,000"
                      type="text"
                      value={formatGroupedIntegerInput(draft.amount)}
                    />
                    <InlineFieldError message={fieldErrors.amount} />
                  </label>
                )}

                {draft.type === "LastMinute" && (
                  <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                    حداکثر روز مانده تا ورود
                    <KoochInput
                      className="text-xs font-medium text-foreground/80"
                      aria-invalid={Boolean(fieldErrors.lastMinuteDays)}
                      inputMode="numeric"
                      min="0"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lastMinuteDays: normalizeIntegerInput(
                            event.target.value,
                          ),
                        }))
                      }
                      step="1"
                      type="number"
                      value={draft.lastMinuteDays}
                    />
                    <p className="text-xs font-normal leading-5 text-muted-foreground">
                      این پیشنهاد فقط تا این تعداد روز مانده به ورود اعمال
                      می‌شود.
                    </p>
                    <InlineFieldError message={fieldErrors.lastMinuteDays} />
                  </label>
                )}
              </div>

              {draft.type === "Informational" && (
                <div className="rounded-xl border border-border bg-muted px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                  این نوع پروموشن تخفیف عددی ندارد و برای نمایش پیشنهادهایی
                  مانند «گشت رایگان» یا «ناهار رایگان» استفاده می‌شود.
                </div>
              )}
            </section>
          )}

          {currentStep === 2 && (
            <section
              aria-labelledby="promotion-step-conditions"
              className="grid gap-5"
            >
              <div>
                <h3
                  className="text-base font-bold text-foreground"
                  id="promotion-step-conditions"
                >
                  زمان و شرایط اجرا
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  بازه زمانی و شرایط لازم برای اعمال پروموشن را تعیین کنید.
                </p>
              </div>

              <div>
                <KoochDatePicker
                  calendarType="jalali"
                  controlClassName={dateControlClass}
                  labels={{
                    start: "تاریخ شروع",
                    end: "تاریخ پایان",
                    rangeTitle: "انتخاب بازه پروموشن",
                  }}
                  autoConfirmOnComplete
                  dialogBodyClassName="px-4 py-3 sm:px-5"
                  dialogContentClassName="h-auto max-h-[90vh]"
                  labelsAbove
                  mode="range"
                  openOnDialog
                  onChange={(nextValue) =>
                    setDraft((current) => ({
                      ...current,
                      startDate: nextValue.startDate ?? current.startDate,
                      endDate: nextValue.endDate ?? current.endDate,
                    }))
                  }
                  placeholderEnd="انتخاب تاریخ پایان"
                  placeholderStart="انتخاب تاریخ شروع"
                  value={{
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                  }}
                />
                <div className="mt-2">
                  <InlineFieldError message={fieldErrors.dates} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                  حداقل شب اقامت
                  <KoochInput
                      className="text-xs font-medium text-foreground/80"
                    aria-invalid={Boolean(fieldErrors.minimumStayNights)}
                    inputMode="numeric"
                    min="0"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        minimumStayNights: normalizeIntegerInput(
                          event.target.value,
                        ),
                      }))
                    }
                    placeholder="بدون محدودیت"
                    step="1"
                    type="number"
                    value={draft.minimumStayNights}
                  />
                  <InlineFieldError message={fieldErrors.minimumStayNights} />
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                  حداقل مهمان
                  <KoochInput
                      className="text-xs font-medium text-foreground/80"
                    aria-invalid={Boolean(fieldErrors.minimumGuests)}
                    inputMode="numeric"
                    min="0"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        minimumGuests: normalizeIntegerInput(
                          event.target.value,
                        ),
                      }))
                    }
                    placeholder="بدون محدودیت"
                    step="1"
                    type="number"
                    value={draft.minimumGuests}
                  />
                  <InlineFieldError message={fieldErrors.minimumGuests} />
                </label>
              </div>

              <KoochWeekdaySelector
                error={fieldErrors.weekdays}
                onChange={(nextWeekdays) => {
                  setFieldErrors((current) => ({
                    ...current,
                    weekdays: undefined,
                  }));
                  setDraft((current) => ({
                    ...current,
                    weekdays: nextWeekdays,
                  }));
                }}
                label={null}
                options={weekdays}
                required
                value={draft.weekdays}
              />

              {!admin && (
                <fieldset className="grid gap-3">
                  <legend className="text-xs font-semibold text-muted-foreground">اتاق‌های منتخب</legend>
                  <div className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2">
                    {rooms.map((room) => {
                      const selected = draft.roomTypeIds.includes(room.id);

                      return (
                        <label
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                            selected
                              ? "border-primary bg-background text-foreground"
                              : "border-border bg-background/60 text-muted-foreground"
                          }`}
                          key={room.id}
                        >
                          <input
                            checked={selected}
                            onChange={() =>
                              setDraft((current) => ({
                                ...current,
                                roomTypeIds: current.roomTypeIds.includes(
                                  room.id,
                                )
                                  ? current.roomTypeIds.filter(
                                      (id) => id !== room.id,
                                    )
                                  : [...current.roomTypeIds, room.id],
                              }))
                            }
                            type="checkbox"
                          />
                          {room.name}
                        </label>
                      );
                    })}
                    {!rooms.length && (
                      <p className="text-sm text-muted-foreground">
                        اتاق فعالی برای این اقامتگاه وجود ندارد.
                      </p>
                    )}
                  </div>
                  <InlineFieldError message={fieldErrors.roomTypeIds} />
                </fieldset>
              )}
            </section>
          )}

          {currentStep === 3 && (
            <section
              aria-labelledby="promotion-step-content"
              className="grid gap-5"
            >
              <div>
                <h3
                  className="text-base font-bold text-foreground"
                  id="promotion-step-content"
                >
                  محتوا و ظاهر
                </h3>
              </div>

              <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                <FieldHelpLabel
                  help="این متن برای مهمان نمایش داده می‌شود."
                  required={draft.type === "Informational"}
                >
                  توضیحات عمومی
                </FieldHelpLabel>
                <KoochTextarea
                  aria-invalid={Boolean(fieldErrors.publicDescription)}
                  className="resize-y text-xs font-medium text-foreground/80"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      publicDescription: event.target.value,
                    }))
                  }
                  placeholder="متنی که مهمان در کارت یا صفحه پروموشن می‌بیند."
                  rows={3}
                  style={{ minHeight: 92 }}
                  value={draft.publicDescription}
                />
                <InlineFieldError message={fieldErrors.publicDescription} />
              </label>

              <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                <FieldHelpLabel help="فقط در پنل مدیریت استفاده می‌شود و به مهمان نمایش داده نمی‌شود.">
                  توضیحات داخلی
                </FieldHelpLabel>
                <KoochTextarea
                  className="resize-y text-xs font-medium text-foreground/80"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      internalDescription: event.target.value,
                    }))
                  }
                  placeholder="یادداشت داخلی برای مدیران و مالکان"
                  rows={2}
                  style={{ minHeight: 76 }}
                  value={draft.internalDescription}
                />
              </label>

              <fieldset className="grid gap-3">
                <legend className="text-xs font-semibold text-muted-foreground">آیکن پروموشن</legend>
                <p className="text-xs leading-5 text-muted-foreground">
                  اگر «پیش‌فرض» را انتخاب کنید، آیکن متناسب با نوع پروموشن
                  استفاده می‌شود.
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  <button
                    aria-pressed={!draft.optionalIcon}
                    className={`min-h-16 rounded-xl border px-2 py-2 text-center transition ${
                      !draft.optionalIcon
                        ? "border-primary bg-muted"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        optionalIcon: "",
                      }))
                    }
                    type="button"
                  >
                    <span className="block text-xl">
                      {promotionDefaultIcons[draft.type]}
                    </span>
                    <span className="mt-1 block text-[11px] font-bold text-muted-foreground">
                      پیش‌فرض
                    </span>
                  </button>

                  {emojiOptions.map((option) => (
                    <button
                      aria-label={option.label}
                      aria-pressed={draft.optionalIcon === option.value}
                      className={`min-h-16 rounded-xl border px-2 py-2 text-center transition ${
                        draft.optionalIcon === option.value
                          ? "border-primary bg-muted"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                      key={option.value}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          optionalIcon: option.value,
                        }))
                      }
                      type="button"
                    >
                      <span className="block text-xl">{option.value}</span>
                      <span className="mt-1 block text-[11px] font-bold text-muted-foreground">
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="grid gap-3">
                <legend className="text-xs font-semibold text-muted-foreground">رنگ نشان</legend>
                <div className="flex flex-wrap gap-2">
                  {badgeColorPresets.map((option) => {
                    const selected = draft.badgeColor === option.value;

                    return (
                      <button
                        aria-pressed={selected}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
                          selected
                            ? "border-primary bg-muted text-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-muted"
                        }`}
                        key={option.label}
                        onClick={() => {
                          setCustomColorMode(false);
                          setDraft((current) => ({
                            ...current,
                            badgeColor: option.value,
                          }));
                        }}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 rounded-full border border-border"
                          style={{
                            backgroundColor:
                              option.value || "var(--theme-primary)",
                          }}
                        />
                        {option.label}
                      </button>
                    );
                  })}

                  <button
                    aria-pressed={customColorMode}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
                      customColorMode
                        ? "border-primary bg-muted text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                    onClick={() => {
                      setCustomColorMode(true);
                      setDraft((current) => ({
                        ...current,
                        badgeColor: hexColorPattern.test(current.badgeColor)
                          ? current.badgeColor
                          : "#2563eb",
                      }));
                    }}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="h-5 w-5 rounded-full border border-border"
                      style={{
                        background:
                          "conic-gradient(from 90deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)",
                      }}
                    />
                    رنگ دلخواه
                  </button>
                </div>

                {customColorMode && (
                    <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
                      <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                        انتخاب رنگ
                        <input
                          aria-label="انتخاب رنگ دلخواه"
                          className="h-10 w-20 cursor-pointer rounded-lg border border-border bg-background p-1"
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              badgeColor: event.target.value,
                            }))
                          }
                          type="color"
                          value={
                            hexColorPattern.test(draft.badgeColor)
                              ? draft.badgeColor
                              : "#2563eb"
                          }
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                        کد رنگ
                        <KoochInput
                      className="text-xs font-medium text-foreground/80"
                          dir="ltr"
                          maxLength={7}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(value)) {
                              setDraft((current) => ({
                                ...current,
                                badgeColor: value,
                              }));
                            }
                          }}
                          placeholder="#2563eb"
                          value={draft.badgeColor}
                        />
                      </label>
                      <InlineFieldError message={fieldErrors.badgeColor} />
                    </div>
                  )}
              </fieldset>

              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <p className="mb-3 text-xs font-bold text-muted-foreground">
                  پیش‌نمایش
                </p>
                <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-4">
                  <span
                    aria-hidden="true"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-xl"
                  >
                    {draft.optionalIcon || promotionDefaultIcons[draft.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-foreground">
                        {draft.title.trim() || "عنوان پروموشن"}
                      </strong>
                      <span
                        className="rounded-full bg-[var(--theme-primary-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--theme-primary-text)]"
                        style={
                          draft.badgeColor
                            ? {
                                backgroundColor: draft.badgeColor,
                                color: getBadgeTextColor(draft.badgeColor),
                              }
                            : undefined
                        }
                      >
                        {typeLabel(draft.type)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      {draft.publicDescription.trim() ||
                        "توضیحات عمومی پروموشن در این بخش نمایش داده می‌شود."}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <section
              aria-labelledby="promotion-step-review"
              className="grid gap-5"
            >
              <div>
                <h3
                  className="text-base font-bold text-foreground"
                  id="promotion-step-review"
                >
                  بازبینی و تأیید
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  قبل از ذخیره، اطلاعات نهایی پروموشن را بررسی کنید.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-xs font-bold text-muted-foreground">
                    عنوان
                  </p>
                  <p className="mt-1 font-bold text-foreground">
                    {draft.title || "—"}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-xs font-bold text-muted-foreground">
                    نوع و مقدار
                  </p>
                  <p className="mt-1 font-bold text-foreground">
                    {typeLabel(draft.type)}
                    {draft.type === "PercentageDiscount" &&
                      ` — ${draft.percentage}٪`}
                    {draft.type === "FixedAmountDiscount" &&
                      ` — ${formatGroupedIntegerInput(draft.amount)} ${currencyLabel}`}
                    {draft.type === "LastMinute" &&
                      ` — ${draft.percentage}٪، حداکثر ${draft.lastMinuteDays} روز مانده`}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-xs font-bold text-muted-foreground">
                    بازه اجرا
                  </p>
                  <p className="mt-1 font-bold text-foreground">
                    {formatPromotionDate(draft.startDate)} تا{" "}
                    {formatPromotionDate(draft.endDate)}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-xs font-bold text-muted-foreground">
                    روزهای اجرا
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-foreground">
                    {draft.weekdays
                      .map(
                        (day) =>
                          weekdays.find((item) => item.value === day)?.label,
                      )
                      .filter(Boolean)
                      .join("، ") || "—"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-bold text-muted-foreground">
                  شرایط
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-lg bg-muted px-3 py-1.5 font-semibold">
                    {draft.minimumStayNights
                      ? `حداقل ${draft.minimumStayNights} شب`
                      : "بدون حداقل شب"}
                  </span>
                  <span className="rounded-lg bg-muted px-3 py-1.5 font-semibold">
                    {draft.minimumGuests
                      ? `حداقل ${draft.minimumGuests} مهمان`
                      : "بدون حداقل مهمان"}
                  </span>
                  {!admin && (
                    <span className="rounded-lg bg-muted px-3 py-1.5 font-semibold">
                      {draft.roomTypeIds.length.toLocaleString("fa-IR")} اتاق
                      منتخب
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-bold text-muted-foreground">
                  نمایش برای مهمان
                </p>
                <div className="mt-3 flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-xl"
                  >
                    {draft.optionalIcon || promotionDefaultIcons[draft.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-foreground">{draft.title}</strong>
                      <span
                        className="rounded-full bg-[var(--theme-primary-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--theme-primary-text)]"
                        style={
                          draft.badgeColor
                            ? {
                                backgroundColor: draft.badgeColor,
                                color: getBadgeTextColor(draft.badgeColor),
                              }
                            : undefined
                        }
                      >
                        {typeLabel(draft.type)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {draft.publicDescription.trim() ||
                        "توضیح عمومی ثبت نشده است."}
                    </p>
                  </div>
                </div>
              </div>

              {draft.internalDescription.trim() && (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-xs font-bold text-muted-foreground">
                    یادداشت داخلی
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground">
                    {draft.internalDescription}
                  </p>
                </div>
              )}

              <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4">
                <label className="flex items-start gap-3">
                  <input
                    checked={draft.isActive}
                    className="mt-1"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-foreground/85">
                      پروموشن فعال باشد
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      تعیین می‌کند این پروموشن پس از ذخیره قابل استفاده باشد یا
                      خیر.
                    </span>
                  </span>
                </label>

                {admin && (
                  <label className="flex items-start gap-3 border-t border-border pt-3">
                    <input
                      checked={draft.isPublished}
                      className="mt-1"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          isPublished: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <span className="block text-xs font-semibold text-foreground/85">
                        انتشار در کتابخانه مالک‌ها
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        در صورت انتشار، مالکان می‌توانند این قالب را در
                        کتابخانه پروموشن‌ها مشاهده و استفاده کنند.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </section>
          )}
        </form>
      </KoochDialog>
    </div>
  );
}
