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
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

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
  const [error, setError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
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

  useEffect(() => {
    if (!wizardOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) closeWizard();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [wizardOpen, saving]);

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

  function closeWizard() {
    setWizardOpen(false);
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
            <p className="mt-1 text-sm text-slate-500">فیلدهای ستاره‌دار برای ساخت پیش‌نویس الزامی هستند.</p>
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
            <p className="mt-1 text-sm text-slate-500">اطلاعات فیزیکی و قوانین نفر اضافه را مشخص کنید.</p>
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
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-bold">
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
          <p className="mt-1 text-sm text-slate-500">امکانات مرتبط با اتاق را انتخاب کنید. سرویس اختصاصی از همین امکانات تشخیص داده می‌شود.</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {roomAmenityOptions.map((amenity) => (
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-bold" key={amenity.id}>
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
              <p className="mt-1 text-sm text-slate-500">اگر چیدمان تخت مشخص است، اینجا اضافه کنید.</p>
            </div>
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
              onClick={() => patchDraft({ bedConfigurations: [...roomTypeDraft.bedConfigurations, { bedTypeId: bedTypes[0]?.id ?? 0, quantity: 1 }] })}
              type="button"
            >
              افزودن تخت
            </button>
          </div>
          {roomTypeDraft.bedConfigurations.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">هنوز تختی اضافه نشده است.</p>
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
          <p className="mt-1 text-sm text-slate-500">تصاویر این بخش به همین اتاق متصل می‌شوند. این مرحله آخر است.</p>
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
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">ابتدا مرحله اول را تکمیل کنید تا پیش‌نویس اتاق ذخیره شود.</p>
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
                  <button className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700" onClick={() => editRoomType(roomType)} type="button">
                    ویرایش اتاق
                  </button>
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

      {wizardOpen && (
        <div className="fixed inset-0 z-50" dir="rtl">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" />
          <section className="absolute inset-x-0 bottom-0 max-h-[94vh] w-full overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:inset-0 sm:m-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 className="text-xl font-black">
                  {wizardMode === "create" ? "افزودن اتاق" : "ویرایش اتاق"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {roomTypeDraft.id && !roomTypeDraft.isActive ? "این اتاق فعلاً پیش‌نویس است." : "اطلاعات اتاق را مرحله‌به‌مرحله تکمیل کنید."}
                </p>
              </div>
              <button aria-label="بستن" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-xl text-slate-600 hover:bg-slate-50" disabled={saving} onClick={closeWizard} type="button">
                X
              </button>
            </div>

            <div className="border-b border-slate-100 px-5 py-4">
              <div className="grid gap-2 md:grid-cols-5">
                {wizardSteps.map((step, index) => (
                  <button
                    className={`rounded-xl border px-3 py-2 text-sm font-black transition ${
                      index === activeStep
                        ? "border-blue-600 bg-blue-600 text-white shadow-md"
                        : index < activeStep
                          ? "border-blue-100 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-500"
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

            <div className="max-h-[calc(94vh-230px)] overflow-y-auto p-5 sm:max-h-[calc(90vh-230px)]">
              {renderStep()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-5">
              <button className="rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 disabled:opacity-50" disabled={saving || activeStep === 0} onClick={() => setActiveStep((current) => Math.max(0, current - 1))} type="button">
                مرحله قبل
              </button>
              <div className="flex flex-wrap gap-3">
                <button className="rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 disabled:opacity-60" disabled={saving} onClick={closeWizard} type="button">
                  لغو
                </button>
                {activeStep < wizardSteps.length - 1 ? (
                  <button className="rounded-xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60" disabled={saving} onClick={goNext} type="button">
                    {saving ? "در حال ذخیره..." : activeStep === 0 ? "ذخیره پیش‌نویس و ادامه" : "مرحله بعد"}
                  </button>
                ) : (
                  <button className="rounded-xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60" disabled={saving} onClick={activateRoom} type="button">
                    {saving ? "در حال فعال‌سازی..." : "فعال‌سازی اتاق"}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
