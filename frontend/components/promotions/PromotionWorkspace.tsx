"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";

const promotionTypes: { value: PromotionType; label: string }[] = [
  { value: "PercentageDiscount", label: "تخفیف درصدی" },
  { value: "FixedAmountDiscount", label: "تخفیف مبلغ ثابت" },
  { value: "LastMinute", label: "لحظه آخری" },
  { value: "Informational", label: "اطلاع‌رسانی" },
];

const weekdays: { value: PromotionWeekday; label: string }[] = [
  { value: "Saturday", label: "شنبه" },
  { value: "Sunday", label: "یکشنبه" },
  { value: "Monday", label: "دوشنبه" },
  { value: "Tuesday", label: "سه‌شنبه" },
  { value: "Wednesday", label: "چهارشنبه" },
  { value: "Thursday", label: "پنجشنبه" },
  { value: "Friday", label: "جمعه" },
];

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
  "h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
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

  function openNew() {
    const selectedProperty = admin
      ? null
      : (propertyId ??
        (propertyFilter !== "all"
          ? propertyFilter
          : (properties[0]?.id ?? null)));
    setEditing(null);
    setDraft(emptyDraft(selectedProperty));
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
    setModalOpen(true);
  }

  function validate() {
    if (!admin && !draft.propertyId) return "اقامتگاه را انتخاب کنید";
    if (!draft.title.trim()) return "عنوان پروموشن الزامی است";
    if (draft.type === "Informational" && !draft.publicDescription.trim())
      return "توضیحات پروموشن اطلاع‌رسانی الزامی است";
    if (draft.startDate > draft.endDate)
      return "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد";
    if (!draft.weekdays.length) return "حداقل یک روز هفته را انتخاب کنید";
    if (!admin && !draft.roomTypeIds.length)
      return "حداقل یک اتاق را انتخاب کنید";
    if (draft.type === "PercentageDiscount" || draft.type === "LastMinute") {
      const value = Number(draft.percentage);
      if (!Number.isFinite(value) || value < 0 || value > 100)
        return "درصد تخفیف باید بین صفر تا صد باشد";
    }
    if (draft.type === "FixedAmountDiscount") {
      const amount = Number(draft.amount);
      if (!Number.isFinite(amount) || amount < 0)
        return "مبلغ تخفیف معتبر نیست";
      const selectedRooms = rooms.filter((room) =>
        draft.roomTypeIds.includes(room.id),
      );
      if (
        selectedRooms.some(
          (room) => room.basePrice !== null && amount > room.basePrice,
        )
      )
        return "مبلغ تخفیف نمی‌تواند از نرخ پایه اتاق بیشتر باشد";
    }
    if (
      draft.type === "LastMinute" &&
      (!Number.isInteger(Number(draft.lastMinuteDays)) ||
        Number(draft.lastMinuteDays) < 0)
    )
      return "تعداد روزهای لحظه آخری معتبر نیست";
    if (
      draft.minimumStayNights &&
      (!Number.isInteger(Number(draft.minimumStayNights)) ||
        Number(draft.minimumStayNights) < 0)
    )
      return "حداقل تعداد شب معتبر نیست";
    if (
      draft.minimumGuests &&
      (!Number.isInteger(Number(draft.minimumGuests)) ||
        Number(draft.minimumGuests) < 0)
    )
      return "حداقل تعداد مهمان معتبر نیست";
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) return toast.error(validationError);
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
    if (!window.confirm(`پروموشن «${promotion.title}» حذف شود؟`)) return;
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
        <div className="flex flex-wrap items-center gap-3">
          <KoochButton onClick={openNew} type="button">
            + پروموشن جدید
          </KoochButton>
          <KoochInput
            className="min-w-52 flex-1"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="جستجو در پروموشن‌ها"
            type="search"
            value={search}
          />
          {admin && (
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
          )}
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
      </KoochCard>

      {loading && (
        <KoochCard className="text-center" padding="lg" variant="elevated">
          <p className="text-sm text-muted-foreground">
          در حال بارگذاری پروموشن‌ها...
          </p>
        </KoochCard>
      )}
      {!loading && !filtered.length && (
        <KoochCard className="border-dashed text-center" padding="lg" variant="elevated">
          <p className="text-sm text-muted-foreground">
            پروموشنی با این فیلتر پیدا نشد.
          </p>
        </KoochCard>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {filtered.map((promotion) => (
          <KoochCard
            className={`transition ${promotion.isLibraryTemplate ? "" : "cursor-grab active:cursor-grabbing"} ${promotion.isActive ? "border-primary" : "opacity-75"}`}
            draggable={!promotion.isLibraryTemplate}
            key={promotion.id}
            onDragOver={(event) =>
              !promotion.isLibraryTemplate && event.preventDefault()
            }
            onDragStart={() =>
              !promotion.isLibraryTemplate && setDraggedId(promotion.id)
            }
            onDrop={() => !promotion.isLibraryTemplate && drop(promotion.id)}
            variant="elevated"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-black text-foreground">
                    {promotion.title}
                  </h3>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-black text-muted-foreground">
                    {promotion.source === "Admin"
                      ? "Admin Promotion"
                      : "Owner Promotion"}
                  </span>
                  {admin && promotion.source === "Admin" && (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-black text-muted-foreground">
                      {promotion.isPublished ? "منتشر شده" : "پیش‌نویس"}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs font-bold text-[var(--theme-primary-text)]">
                  {typeLabel(promotion.type)}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${promotion.isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {promotion.isLibraryTemplate
                  ? "کتابخانه"
                  : promotion.isActive
                    ? "فعال"
                    : "غیرفعال"}
              </span>
            </div>
            {admin && (
              <p className="mt-3 text-sm font-bold text-muted-foreground">
                {promotion.propertyName}
              </p>
            )}
            {promotion.publicDescription && (
              <p className="mt-3 rounded-xl bg-muted p-3 text-sm leading-6 text-muted-foreground">
                {promotion.publicDescription}
              </p>
            )}
            <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">بازه اجرا</dt>
                <dd>
                  {new Date(promotion.startDate).toLocaleDateString("fa-IR")} تا{" "}
                  {new Date(promotion.endDate).toLocaleDateString("fa-IR")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">روزهای هفته</dt>
                <dd>
                  {promotion.weekdays
                    .map(
                      (day) =>
                        weekdays.find((item) => item.value === day)?.label,
                    )
                    .join("، ")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">اتاق‌های انتخاب‌شده</dt>
                <dd>{promotion.roomTypes.length} اتاق</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">ایجادکننده</dt>
                <dd>{promotion.createdBy}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              {promotion.canEdit &&
                !(!admin && promotion.source === "Admin") && (
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
                {!admin && promotion.source === "Admin" ? "کپی خصوصی" : "کپی"}
              </KoochButton>
              {(admin || promotion.source === "Owner") && (
                <KoochButton
                  onClick={() => remove(promotion)}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  حذف
                </KoochButton>
              )}
              {!promotion.isLibraryTemplate && (
                <span className="mr-auto self-center text-xs text-muted-foreground">
                  ☰ برای مرتب‌سازی بکشید
                </span>
              )}
            </div>
          </KoochCard>
        ))}
      </div>

      <KoochDialog
        closeDisabled={saving}
        footer={
          <>
            <KoochButton
              disabled={saving}
              onClick={() => setModalOpen(false)}
              variant="outline"
            >
              لغو
            </KoochButton>
            <KoochButton
              disabled={saving}
              form="promotion-form"
              loading={saving}
              type="submit"
              variant="primary"
            >
              ذخیره
            </KoochButton>
          </>
        }
        onOpenChange={(open) => {
          if (!open && !saving) setModalOpen(false);
        }}
        open={modalOpen}
        size="lg"
        title={editing ? "ویرایش پروموشن" : "پروموشن جدید"}
      >
        <form className="grid gap-4" id="promotion-form" onSubmit={submit}>
<div className="grid gap-4 sm:grid-cols-2">
          {admin && (
            <div className="rounded-xl border border-border bg-muted p-3 text-sm font-bold text-muted-foreground sm:col-span-2">
              این پروموشن به عنوان قالب مدیریتی قابل انتشار در کتابخانه
              مالک‌ها ساخته می‌شود.
            </div>
          )}
          <label className="grid gap-2 text-sm font-bold sm:col-span-2">
            عنوان
            <KoochInput
              maxLength={150}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              required
              value={draft.title}
            />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            نوع پروموشن
            <KoochSelect
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
            <label className="grid gap-2 text-sm font-bold">
              درصد تخفیف
              <KoochInput
                max="100"
                min="0"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    percentage: event.target.value,
                  }))
                }
                type="number"
                value={draft.percentage}
              />
            </label>
          )}
          {draft.type === "FixedAmountDiscount" && (
            <label className="grid gap-2 text-sm font-bold">
              مبلغ تخفیف
              <KoochInput
                min="0"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                type="number"
                value={draft.amount}
              />
            </label>
          )}
          {draft.type === "LastMinute" && (
            <label className="grid gap-2 text-sm font-bold">
              حداکثر روز مانده تا ورود
              <KoochInput
                min="0"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lastMinuteDays: event.target.value,
                  }))
                }
                type="number"
                value={draft.lastMinuteDays}
              />
            </label>
          )}
          <div className="sm:col-span-2">
            <KoochDatePicker
              calendarType="jalali"
              controlClassName={dateControlClass}
              labels={{ start: "تاریخ شروع", end: "تاریخ پایان", rangeTitle: "انتخاب بازه پروموشن" }}
              labelsAbove
              mode="range"
              onChange={(nextValue) =>
                setDraft((current) => ({
                  ...current,
                  startDate: nextValue.startDate ?? current.startDate,
                  endDate: nextValue.endDate ?? current.endDate,
                }))
              }
              placeholderEnd="انتخاب تاریخ پایان"
              placeholderStart="انتخاب تاریخ شروع"
              value={{ startDate: draft.startDate, endDate: draft.endDate }}
            />
          </div>
          <label className="grid gap-2 text-sm font-bold sm:col-span-2">
            توضیحات داخلی
            <KoochTextarea
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  internalDescription: event.target.value,
                }))
              }
              rows={2}
              value={draft.internalDescription}
            />
          </label>
          <label className="grid gap-2 text-sm font-bold sm:col-span-2">
            توضیحات عمومی
            <KoochTextarea
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  publicDescription: event.target.value,
                }))
              }
              rows={2}
              value={draft.publicDescription}
            />
          </label>
          {draft.type === "Informational" && (
            <div className="rounded-xl border border-border bg-muted p-3 text-sm font-bold leading-6 text-muted-foreground sm:col-span-2">
              مثال: با ۳ شب اقامت، گشت رایگان · با ۲ شب اقامت، ناهار رایگان
            </div>
          )}
          <label className="grid gap-2 text-sm font-bold">
            آیکن اختیاری
            <KoochInput
              maxLength={20}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  optionalIcon: event.target.value,
                }))
              }
              placeholder="🎁"
              value={draft.optionalIcon}
            />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            رنگ بج
            <KoochInput
              maxLength={40}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  badgeColor: event.target.value,
                }))
              }
              placeholder="#2563eb"
              value={draft.badgeColor}
            />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            حداقل شب اقامت
            <KoochInput
              min="0"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  minimumStayNights: event.target.value,
                }))
              }
              type="number"
              value={draft.minimumStayNights}
            />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            حداقل مهمان
            <KoochInput
              min="0"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  minimumGuests: event.target.value,
                }))
              }
              type="number"
              value={draft.minimumGuests}
            />
          </label>
        </div>
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-black">روزهای هفته</legend>
          <div className="flex flex-wrap gap-2">
            {weekdays.map((day) => (
              <label
                className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-bold ${draft.weekdays.includes(day.value) ? "border-primary bg-muted text-foreground" : "border-border text-muted-foreground"}`}
                key={day.value}
              >
                <input
                  checked={draft.weekdays.includes(day.value)}
                  className="sr-only"
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      weekdays: current.weekdays.includes(day.value)
                        ? current.weekdays.filter(
                            (item) => item !== day.value,
                          )
                        : [...current.weekdays, day.value],
                    }))
                  }
                  type="checkbox"
                />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>
        {!admin && (
          <fieldset className="mt-5">
            <legend className="mb-2 text-sm font-black">
              اتاق‌های منتخب
            </legend>
            <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border border-border bg-background p-3 sm:grid-cols-2">
              {rooms.map((room) => (
                <label
                  className="flex items-center gap-2 text-sm font-bold"
                  key={room.id}
                >
                  <input
                    checked={draft.roomTypeIds.includes(room.id)}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        roomTypeIds: current.roomTypeIds.includes(room.id)
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
              ))}
              {!rooms.length && (
                <p className="text-sm text-muted-foreground">
                  اتاق فعالی برای این اقامتگاه وجود ندارد.
                </p>
              )}
            </div>
          </fieldset>
        )}
        <label className="mt-5 flex items-center gap-2 text-sm font-bold">
          <input
            checked={draft.isActive}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                isActive: event.target.checked,
              }))
            }
            type="checkbox"
          />
          پروموشن فعال باشد
        </label>
        {admin && (
          <label className="mt-3 flex items-center gap-2 text-sm font-bold">
            <input
              checked={draft.isPublished}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  isPublished: event.target.checked,
                }))
              }
              type="checkbox"
            />
            انتشار در کتابخانه مالک‌ها
          </label>
        )}

        </form>
      </KoochDialog>
    </div>
  );
}
