"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AmenityResponse,
  apiRequest,
  BedTypeResponse,
  bedTypeLabel,
  PropertyImageResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog, KoochDialogButton } from "@/components/KoochDialog";
import { PropertyImageManager } from "@/components/owner/PropertyImageManager";

interface RoomTypeDraft {
  id?: number;
  name: string;
  englishName: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  totalInventory: number;
  floorNumber: string;
  stairCount: string;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  notes: string;
  bedConfigurations: { bedTypeId: number; quantity: number }[];
  amenityIds: number[];
  isActive: boolean;
}

type WizardMode = "create" | "edit";

const wizardSteps = [
  "اطلاعات اصلی",
  "ویژگی‌ها",
  "امکانات",
  "تخت‌ها / چیدمان",
  "تصاویر",
] as const;

const inputClass =
  "min-h-11 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2.5 text-sm text-[var(--theme-text)] outline-none transition placeholder:text-[var(--theme-muted-text)] focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950/60";

const emptyRoomType: RoomTypeDraft = {
  name: "",
  englishName: "",
  description: "",
  maxAdults: 2,
  maxChildren: 0,
  allowExtraGuest: false,
  maxExtraGuests: 0,
  totalInventory: 1,
  floorNumber: "",
  stairCount: "",
  hasWindow: null,
  hasPrivateBathroom: null,
  notes: "",
  bedConfigurations: [],
  amenityIds: [],
  isActive: false,
};

function nullableNumber(value: string) {
  return value === "" ? null : Number(value);
}

function roomInventoryMode(totalInventory: number) {
  return totalInventory <= 1 ? "NamedRooms" : "TypeBasedInventory";
}

function booleanLabel(value: boolean | null, trueLabel: string, falseLabel: string) {
  if (value === null) return "";
  return value ? trueLabel : falseLabel;
}

function roomTypeToDraft(roomType: RoomTypeResponse): RoomTypeDraft {
  return {
    id: roomType.id,
    name: roomType.name,
    englishName: roomType.englishName ?? "",
    description: roomType.description,
    maxAdults: roomType.maxAdults,
    maxChildren: roomType.maxChildren,
    allowExtraGuest: roomType.allowExtraGuest,
    maxExtraGuests: roomType.maxExtraGuests,
    totalInventory: Math.max(1, roomType.totalInventory),
    floorNumber: roomType.floorNumber == null ? "" : String(roomType.floorNumber),
    stairCount: roomType.stairCount == null ? "" : String(roomType.stairCount),
    hasWindow: roomType.hasWindow,
    hasPrivateBathroom: roomType.hasPrivateBathroom,
    notes: roomType.notes ?? "",
    bedConfigurations: roomType.bedConfigurations.map((bed) => ({
      bedTypeId: bed.bedTypeId,
      quantity: bed.quantity,
    })),
    amenityIds: roomType.amenities.map((amenity) => amenity.amenityId),
    isActive: roomType.isActive,
  };
}

export function RoomManagement({ propertyId }: { propertyId: number }) {
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [images, setImages] = useState<PropertyImageResponse[]>([]);
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [roomTypeDraft, setRoomTypeDraft] = useState<RoomTypeDraft>(emptyRoomType);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingRoomTypeId, setDeletingRoomTypeId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>("create");
  const [activeStep, setActiveStep] = useState(0);

  const roomAmenityOptions = useMemo(
    () => amenities.filter((item) => item.scope !== "Property"),
    [amenities],
  );

  const privateBathroomAmenity = useMemo(
    () => roomAmenityOptions.find((item) => item.slug === "private-bathroom"),
    [roomAmenityOptions],
  );

  useEffect(() => {
    Promise.all([
      apiRequest<BedTypeResponse[]>("/bed-types"),
      apiRequest<AmenityResponse[]>("/amenities"),
      loadRoomTypes(),
      loadImages(),
    ])
      .then(([beds, amenityItems]) => {
        setBedTypes(beds);
        setAmenities(amenityItems);
      })
      .catch((caught: Error) => {
        setError(caught.message);
        toast.error(caught.message);
      })
      .finally(() => setLoading(false));
  }, [propertyId]);

  async function loadRoomTypes() {
    const items = await apiRequest<RoomTypeResponse[]>(
      `/owner/properties/${propertyId}/room-types`,
    );
    setRoomTypes(items);
    return items;
  }

  async function loadImages() {
    const items = await apiRequest<PropertyImageResponse[]>(
      `/owner/properties/${propertyId}/images`,
    );
    setImages(items);
    return items;
  }

  function openCreateWizard() {
    setRoomTypeDraft(emptyRoomType);
    setWizardMode("create");
    setActiveStep(0);
    setError("");
    setWizardOpen(true);
  }

  function editRoomType(roomType: RoomTypeResponse) {
    setRoomTypeDraft(roomTypeToDraft(roomType));
    setWizardMode("edit");
    setActiveStep(0);
    setError("");
    setWizardOpen(true);
  }

  function openTestDialog(roomType: RoomTypeResponse) {
    setRoomTypeDraft(roomTypeToDraft(roomType));
    setWizardMode("edit");
    setActiveStep(0);
    setError("");
    setTestDialogOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
    setRoomTypeDraft(emptyRoomType);
    setActiveStep(0);
    setError("");
  }

  function closeTestDialog() {
    setTestDialogOpen(false);
    setRoomTypeDraft(emptyRoomType);
    setActiveStep(0);
    setError("");
  }

  function patchDraft(patch: Partial<RoomTypeDraft>) {
    setRoomTypeDraft((current) => ({ ...current, ...patch }));
  }

  function updateBed(index: number, patch: Partial<{ bedTypeId: number; quantity: number }>) {
    setRoomTypeDraft((current) => {
      const next = [...current.bedConfigurations];
      next[index] = { ...next[index], ...patch };
      return { ...current, bedConfigurations: next };
    });
  }

  function inferPrivateBathroom(amenityIds: number[]) {
    return privateBathroomAmenity ? amenityIds.includes(privateBathroomAmenity.id) : roomTypeDraft.hasPrivateBathroom;
  }

  function validateStep(step: number, finalActivation = false) {
    if (step === 0 || finalActivation) {
      if (!roomTypeDraft.name.trim()) return "نام اتاق الزامی است.";
      if (roomTypeDraft.totalInventory < 1) return "تعداد موجودی باید حداقل ۱ باشد.";
      if (roomTypeDraft.maxAdults < 1) return "ظرفیت بزرگسال باید حداقل ۱ باشد.";
      if (roomTypeDraft.maxChildren < 0) return "ظرفیت کودک معتبر نیست.";
    }
    if ((step === 1 || finalActivation) && roomTypeDraft.allowExtraGuest && roomTypeDraft.maxExtraGuests < 1) {
      return "حداکثر تعداد نفر اضافه را وارد کنید.";
    }
    if (finalActivation && !roomTypeDraft.description.trim()) {
      return "توضیح اتاق برای فعال‌سازی الزامی است.";
    }
    return "";
  }

  function buildPayload(isActive: boolean) {
    const totalInventory = Math.max(1, roomTypeDraft.totalInventory);
    const amenityIds = [...new Set(roomTypeDraft.amenityIds)];
    return {
      name: roomTypeDraft.name.trim(),
      englishName: roomTypeDraft.englishName.trim() || null,
      description: roomTypeDraft.description.trim() || roomTypeDraft.name.trim(),
      maxAdults: Math.max(1, roomTypeDraft.maxAdults),
      maxChildren: Math.max(0, roomTypeDraft.maxChildren),
      allowExtraGuest: roomTypeDraft.allowExtraGuest,
      maxExtraGuests: roomTypeDraft.allowExtraGuest ? Math.max(0, roomTypeDraft.maxExtraGuests) : 0,
      inventoryMode: roomInventoryMode(totalInventory),
      totalInventory,
      basePrice: null,
      notes: roomTypeDraft.notes.trim() || null,
      floorNumber: nullableNumber(roomTypeDraft.floorNumber),
      stairCount: nullableNumber(roomTypeDraft.stairCount),
      hasWindow: roomTypeDraft.hasWindow,
      hasPrivateBathroom: inferPrivateBathroom(amenityIds),
      bedConfigurations: roomTypeDraft.bedConfigurations.filter(
        (bed) => bed.bedTypeId && bed.quantity > 0,
      ),
      amenityIds,
      isActive,
    };
  }

  async function saveDraftRoom() {
    const validationError = validateStep(0);
    if (validationError) {
      toast.error(validationError);
      return null;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await apiRequest<RoomTypeResponse>(
        roomTypeDraft.id
          ? `/owner/room-types/${roomTypeDraft.id}`
          : `/owner/properties/${propertyId}/room-types`,
        {
          method: roomTypeDraft.id ? "PUT" : "POST",
          body: JSON.stringify(buildPayload(roomTypeDraft.id ? roomTypeDraft.isActive : false)),
        },
      );
      setRoomTypeDraft(roomTypeToDraft(saved));
      await Promise.all([loadRoomTypes(), loadImages()]);
      if (wizardMode === "create" && !roomTypeDraft.id) toast.success("پیش‌نویس اتاق ذخیره شد");
      return saved;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "پیش‌نویس اتاق ذخیره نشد.";
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function goNext() {
    const validationError = validateStep(activeStep);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (activeStep === 0) {
      const saved = await saveDraftRoom();
      if (!saved) return;
    }

    setActiveStep((current) => Math.min(current + 1, wizardSteps.length - 1));
  }

  async function activateRoom() {
    const validationError = validateStep(activeStep, true);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const endpoint = roomTypeDraft.id
        ? `/owner/room-types/${roomTypeDraft.id}`
        : `/owner/properties/${propertyId}/room-types`;
      const saved = await apiRequest<RoomTypeResponse>(endpoint, {
        method: roomTypeDraft.id ? "PUT" : "POST",
        body: JSON.stringify(buildPayload(true)),
      });
      setRoomTypeDraft(roomTypeToDraft(saved));
      await Promise.all([loadRoomTypes(), loadImages()]);
      toast.success("اتاق فعال شد");
      closeWizard();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "فعال‌سازی اتاق انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveTestDialog() {
    const validationError = validateStep(activeStep, true);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const endpoint = roomTypeDraft.id
        ? `/owner/room-types/${roomTypeDraft.id}`
        : `/owner/properties/${propertyId}/room-types`;
      const saved = await apiRequest<RoomTypeResponse>(endpoint, {
        method: roomTypeDraft.id ? "PUT" : "POST",
        body: JSON.stringify(buildPayload(roomTypeDraft.id ? roomTypeDraft.isActive : false)),
      });
      setRoomTypeDraft(roomTypeToDraft(saved));
      await Promise.all([loadRoomTypes(), loadImages()]);
      toast.success("ذخیره آزمایشی انجام شد");
      closeTestDialog();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "ذخیره آزمایشی انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoomType(roomType: RoomTypeResponse) {
    if (!window.confirm(`آیا از حذف اتاق «${roomType.name}» مطمئن هستید؟`)) return;

    setDeletingRoomTypeId(roomType.id);
    setError("");
    try {
      await apiRequest<void>(`/owner/room-types/${roomType.id}`, { method: "DELETE" });
      await Promise.all([loadRoomTypes(), loadImages()]);
      toast.success("اتاق حذف شد");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "حذف اتاق انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setDeletingRoomTypeId(null);
    }
  }

  function toggleAmenity(amenity: AmenityResponse, checked: boolean) {
    setRoomTypeDraft((current) => {
      const amenityIds = checked
        ? [...current.amenityIds, amenity.id]
        : current.amenityIds.filter((id) => id !== amenity.id);
      return {
        ...current,
        amenityIds,
        hasPrivateBathroom: amenity.slug === "private-bathroom" ? checked : current.hasPrivateBathroom,
      };
    });
  }

  function renderStep() {
    if (activeStep === 0) {
      return (
        <div className="grid gap-5">
          <div>
            <h3 className="font-black">اطلاعات اصلی</h3>
            <p className="mt-1 text-sm text-[var(--theme-muted-text)]">فیلدهای ستاره‌دار برای ساخت پیش‌نویس الزامی هستند.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-bold">
              نام اتاق / عنوان <span className="text-red-600">*</span>
              <input className={inputClass} onChange={(event) => patchDraft({ name: event.target.value })} value={roomTypeDraft.name} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              نام انگلیسی
              <input className={inputClass} dir="ltr" onChange={(event) => patchDraft({ englishName: event.target.value })} value={roomTypeDraft.englishName} />
            </label>
            <label className="grid gap-1 text-sm font-bold md:col-span-2">
              توضیح
              <textarea className={inputClass} onChange={(event) => patchDraft({ description: event.target.value })} rows={4} value={roomTypeDraft.description} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              تعداد موجودی / TotalInventory <span className="text-red-600">*</span>
              <input className={inputClass} min="1" onChange={(event) => patchDraft({ totalInventory: Number(event.target.value) })} type="number" value={roomTypeDraft.totalInventory} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              ظرفیت بزرگسال <span className="text-red-600">*</span>
              <input className={inputClass} min="1" onChange={(event) => patchDraft({ maxAdults: Number(event.target.value) })} type="number" value={roomTypeDraft.maxAdults} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              ظرفیت کودک
              <input className={inputClass} min="0" onChange={(event) => patchDraft({ maxChildren: Number(event.target.value) })} type="number" value={roomTypeDraft.maxChildren} />
            </label>
          </div>
        </div>
      );
    }

    if (activeStep === 1) {
      return (
        <div className="grid gap-5">
          <div>
            <h3 className="font-black">ویژگی‌ها</h3>
            <p className="mt-1 text-sm text-[var(--theme-muted-text)]">اطلاعات فیزیکی و قوانین نفر اضافه را مشخص کنید.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-bold">
              طبقه
              <input className={inputClass} onChange={(event) => patchDraft({ floorNumber: event.target.value })} type="number" value={roomTypeDraft.floorNumber} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              تعداد پله
              <input className={inputClass} min="0" onChange={(event) => patchDraft({ stairCount: event.target.value })} type="number" value={roomTypeDraft.stairCount} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              پنجره دارد
              <select
                className={inputClass}
                onChange={(event) => patchDraft({ hasWindow: event.target.value === "" ? null : event.target.value === "true" })}
                value={roomTypeDraft.hasWindow === null ? "" : String(roomTypeDraft.hasWindow)}
              >
                <option value="">ثبت نشده</option>
                <option value="true">دارد</option>
                <option value="false">ندارد</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-3 text-sm font-bold">
              <input
                checked={roomTypeDraft.allowExtraGuest}
                className="h-4 w-4 accent-blue-600"
                onChange={(event) => patchDraft({ allowExtraGuest: event.target.checked, maxExtraGuests: event.target.checked ? roomTypeDraft.maxExtraGuests : 0 })}
                type="checkbox"
              />
              آیا نفر اضافه مجاز است؟
            </label>
            {roomTypeDraft.allowExtraGuest && (
              <label className="grid gap-1 text-sm font-bold">
                حداکثر تعداد نفر اضافه <span className="text-red-600">*</span>
                <input className={inputClass} min="1" onChange={(event) => patchDraft({ maxExtraGuests: Number(event.target.value) })} type="number" value={roomTypeDraft.maxExtraGuests} />
              </label>
            )}
            <label className="grid gap-1 text-sm font-bold md:col-span-2">
              یادداشت‌ها
              <textarea className={inputClass} onChange={(event) => patchDraft({ notes: event.target.value })} rows={4} value={roomTypeDraft.notes} />
            </label>
          </div>
        </div>
      );
    }

    if (activeStep === 2) {
      return (
        <fieldset>
          <legend className="font-black">امکانات اتاق</legend>
          <p className="mt-1 text-sm text-[var(--theme-muted-text)]">امکانات مرتبط با اتاق را انتخاب کنید. سرویس اختصاصی از همین امکانات تشخیص داده می‌شود.</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {roomAmenityOptions.map((amenity) => (
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-3 text-sm font-bold" key={amenity.id}>
                <input
                  checked={roomTypeDraft.amenityIds.includes(amenity.id)}
                  className="h-4 w-4 accent-blue-600"
                  onChange={(event) => toggleAmenity(amenity, event.target.checked)}
                  type="checkbox"
                />
                {amenity.name}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    if (activeStep === 3) {
      return (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-black">تخت‌ها / چیدمان</h3>
              <p className="mt-1 text-sm text-[var(--theme-muted-text)]">اگر چیدمان تخت مشخص است، اینجا اضافه کنید.</p>
            </div>
            <button
              className="min-h-11 rounded-xl border border-[var(--theme-border)] px-3 py-2 text-sm font-bold text-[var(--theme-text)] transition hover:bg-[var(--theme-surface-muted)]"
              onClick={() => patchDraft({ bedConfigurations: [...roomTypeDraft.bedConfigurations, { bedTypeId: bedTypes[0]?.id ?? 0, quantity: 1 }] })}
              type="button"
            >
              افزودن تخت
            </button>
          </div>
          {roomTypeDraft.bedConfigurations.length === 0 && (
            <p className="rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-5 text-center text-sm text-[var(--theme-muted-text)]">هنوز تختی اضافه نشده است.</p>
          )}
          {roomTypeDraft.bedConfigurations.map((bed, index) => (
            <div className="grid gap-2 md:grid-cols-[1fr_120px_auto]" key={index}>
              <select className={inputClass} onChange={(event) => updateBed(index, { bedTypeId: Number(event.target.value) })} value={bed.bedTypeId}>
                {bedTypes.map((bedType) => (
                  <option key={bedType.id} value={bedType.id}>
                    {bedTypeLabel(bedType.slug, bedType.name)}
                  </option>
                ))}
              </select>
              <input className={inputClass} min="1" onChange={(event) => updateBed(index, { quantity: Number(event.target.value) })} type="number" value={bed.quantity} />
              <button
                className="text-sm font-bold text-red-700"
                onClick={() => patchDraft({ bedConfigurations: roomTypeDraft.bedConfigurations.filter((_, candidate) => candidate !== index) })}
                type="button"
              >
                حذف
              </button>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="grid gap-4">
        <div>
          <h3 className="font-black">تصاویر اتاق</h3>
          <p className="mt-1 text-sm text-[var(--theme-muted-text)]">تصاویر این بخش به همین اتاق متصل می‌شوند. این مرحله آخر است.</p>
        </div>
        {roomTypeDraft.id ? (
          <PropertyImageManager
            fixedRoomTypeId={roomTypeDraft.id}
            images={images}
            onImagesChange={setImages}
            propertyId={propertyId}
            roomTypes={roomTypes}
          />
        ) : (
          <p className="rounded-xl bg-[var(--theme-surface-muted)] p-4 text-sm text-[var(--theme-muted-text)]">ابتدا مرحله اول را تکمیل کنید تا پیش‌نویس اتاق ذخیره شود.</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">مدیریت اتاق‌ها</h2>
            <p className="mt-1 text-sm text-slate-500">
              اتاق‌ها را از طریق ویزارد مرحله‌ای ایجاد یا ویرایش کنید. اتاق‌های پیش‌نویس فعال و قابل رزرو نیستند.
            </p>
          </div>
          <button className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700" onClick={openCreateWizard} type="button">
            افزودن اتاق
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">اتاق‌های ثبت‌شده</h2>
        {loading && (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            در حال بارگذاری اتاق‌ها...
          </p>
        )}
        <div className="mt-5 grid gap-4">
          {roomTypes.map((roomType) => {
            const details = [
              roomType.floorNumber != null ? `طبقه ${roomType.floorNumber}` : "",
              roomType.stairCount != null ? `${roomType.stairCount} پله` : "",
              booleanLabel(roomType.hasWindow, "دارای پنجره", "بدون پنجره"),
              booleanLabel(roomType.hasPrivateBathroom, "سرویس اختصاصی", "سرویس مشترک"),
            ].filter(Boolean);

            return (
              <article className="rounded-2xl border border-slate-200 p-4" key={roomType.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black">{roomType.name}</h3>
                      {!roomType.isActive && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">
                          پیش‌نویس
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {roomType.maxAdults + roomType.maxChildren} نفر ·{" "}
                      {roomType.totalInventory === 1 ? "یک واحد اختصاصی" : `موجودی کل ${roomType.totalInventory}`}
                    </p>
                    {roomType.allowExtraGuest && (
                      <p className="mt-1 text-sm font-semibold text-slate-600">
                        نفر اضافه مجاز: {roomType.maxExtraGuests}
                      </p>
                    )}
                    {roomType.bedConfigurations.length > 0 && (
                      <p className="mt-2 text-sm text-slate-600">
                        {roomType.bedConfigurations
                          .map((bed) => `${bed.quantity} × ${bedTypeLabel(bed.bedTypeSlug, bed.bedTypeName)}`)
                          .join("، ")}
                      </p>
                    )}
                    {details.length > 0 && (
                      <p className="mt-2 text-sm font-semibold text-slate-700">
                        {details.join(" · ")}
                      </p>
                    )}
                    {roomType.notes && <p className="mt-2 text-sm text-slate-500">{roomType.notes}</p>}
                    {images.some((image) => image.roomTypeId === roomType.id) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {images
                          .filter((image) => image.roomTypeId === roomType.id)
                          .slice(0, 4)
                          .map((image) => (
                            <img
                              alt={image.altText || image.caption || roomType.name}
                              className="h-[120px] w-[160px] rounded-xl object-cover"
                              key={image.id}
                              src={image.url}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="rounded-xl border border-[var(--theme-border)] px-3 py-2 text-sm font-bold text-[var(--theme-text)] transition hover:bg-[var(--theme-surface-muted)]" onClick={() => editRoomType(roomType)} type="button">
                      ویرایش اتاق
                    </button>
                    <KoochButton
                      onClick={() => openTestDialog(roomType)}
                      size="sm"
                      variant="outline"
                    >
                      تست دیالوگ جدید
                    </KoochButton>
                    <button
                      className="rounded-xl border border-red-300 px-3 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/30"
                      disabled={deletingRoomTypeId === roomType.id}
                      onClick={() => deleteRoomType(roomType)}
                      type="button"
                    >
                      {deletingRoomTypeId === roomType.id ? "در حال حذف..." : "حذف"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {!loading && roomTypes.length === 0 && (
          <p className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            هنوز اتاقی ثبت نشده است.
          </p>
        )}
      </section>

      <KoochDialog
        closeDisabled={saving}
        description={
          roomTypeDraft.id && !roomTypeDraft.isActive
            ? "این اتاق فعلاً پیش‌نویس است."
            : "اطلاعات اتاق را مرحله‌به‌مرحله تکمیل کنید."
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <KoochDialogButton
              disabled={saving || activeStep === 0}
              onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
            >
              قبلی
            </KoochDialogButton>
            <div className="flex flex-wrap gap-3">
              <KoochDialogButton disabled={saving} onClick={closeWizard}>
                لغو
              </KoochDialogButton>
              {activeStep < wizardSteps.length - 1 ? (
                <KoochDialogButton disabled={saving} onClick={goNext} variant="primary">
                  {saving ? "در حال ذخیره..." : activeStep === 0 ? "ذخیره و بعدی" : "بعدی"}
                </KoochDialogButton>
              ) : (
                <KoochDialogButton disabled={saving} onClick={activateRoom} variant="primary">
                  {saving ? "در حال فعال‌سازی..." : "فعال‌سازی اتاق"}
                </KoochDialogButton>
              )}
            </div>
          </div>
        }
        onOpenChange={(open) => {
          if (!open && !saving) closeWizard();
        }}
        open={wizardOpen}
        size="xl"
        title={wizardMode === "create" ? "افزودن اتاق" : "ویرایش اتاق"}
      >
        <div className="mb-5 border-b border-[var(--theme-border)] pb-4">
          <div className="grid gap-2 md:grid-cols-5">
            {wizardSteps.map((step, index) => (
              <button
                className={`min-h-10 rounded-md border px-3 py-2 text-xs font-semibold transition ${
                  index === activeStep
                    ? "border-blue-600 bg-blue-600 text-white shadow-md"
                    : index < activeStep
                      ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
                      : "border-[var(--theme-border)] bg-[var(--theme-surface-muted)] text-[var(--theme-muted-text)] hover:text-[var(--theme-text)]"
                }`}
                disabled={saving || (index > 0 && !roomTypeDraft.id)}
                key={step}
                onClick={() => setActiveStep(index)}
                type="button"
              >
                <span className="ml-1 inline-grid h-5 w-5 place-items-center rounded-full bg-white/20 text-xs">{index + 1}</span>
                {step}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </p>
        )}
        {renderStep()}
      </KoochDialog>
      <KoochDialog
        description="این مسیر فقط برای تست بصری و تجربه کاربری است؛ مودال قبلی بدون تغییر باقی مانده است."
        footer={
          <>
            <KoochButton
              disabled={saving}
              onClick={closeTestDialog}
              variant="outline"
            >
              لغو
            </KoochButton>
            <KoochButton
              disabled={saving}
              loading={saving}
              onClick={saveTestDialog}
              variant="primary"
            >
              ذخیره آزمایشی
            </KoochButton>
          </>
        }
        onOpenChange={(open) => {
          if (!open && !saving) closeTestDialog();
        }}
        open={testDialogOpen}
        size="lg"
        title="ویرایش اتاق در دیالوگ جدید"
      >
        <div className="mb-5 border-b border-[var(--theme-border)] pb-4">
          <div className="grid gap-2 md:grid-cols-5">
            {wizardSteps.map((step, index) => (
              <button
                className={`min-h-10 rounded-md border px-3 py-2 text-xs font-semibold transition ${
                  index === activeStep
                    ? "border-blue-600 bg-blue-600 text-white shadow-md"
                    : "border-[var(--theme-border)] bg-[var(--theme-surface-muted)] text-[var(--theme-muted-text)] hover:text-[var(--theme-text)]"
                }`}
                disabled={saving || (index > 0 && !roomTypeDraft.id)}
                key={step}
                onClick={() => setActiveStep(index)}
                type="button"
              >
                {step}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </p>
        )}
        {renderStep()}
      </KoochDialog>
    </div>
  );
}
