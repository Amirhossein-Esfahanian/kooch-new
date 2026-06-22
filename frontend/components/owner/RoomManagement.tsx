"use client";

import { useEffect, useMemo, useState } from "react";
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
  totalInventory: number;
  floorNumber: string;
  stairCount: string;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  notes: string;
  bedConfigurations: { bedTypeId: number; quantity: number }[];
  amenityIds: number[];
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const emptyRoomType: RoomTypeDraft = {
  name: "",
  englishName: "",
  description: "",
  maxAdults: 2,
  maxChildren: 0,
  totalInventory: 1,
  floorNumber: "",
  stairCount: "",
  hasWindow: null,
  hasPrivateBathroom: null,
  notes: "",
  bedConfigurations: [],
  amenityIds: [],
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

export function RoomManagement({ propertyId }: { propertyId: number }) {
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [images, setImages] = useState<PropertyImageResponse[]>([]);
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [roomTypeDraft, setRoomTypeDraft] =
    useState<RoomTypeDraft>(emptyRoomType);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const roomAmenityOptions = useMemo(
    () => amenities.filter((item) => item.scope !== "Property"),
    [amenities],
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
      .catch((caught: Error) => setError(caught.message))
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

  function editRoomType(roomType: RoomTypeResponse) {
    setRoomTypeDraft({
      id: roomType.id,
      name: roomType.name,
      englishName: roomType.englishName ?? "",
      description: roomType.description,
      maxAdults: roomType.maxAdults,
      maxChildren: roomType.maxChildren,
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
    });
  }

  function updateBed(
    index: number,
    patch: Partial<{ bedTypeId: number; quantity: number }>,
  ) {
    const next = [...roomTypeDraft.bedConfigurations];
    next[index] = { ...next[index], ...patch };
    setRoomTypeDraft((current) => ({ ...current, bedConfigurations: next }));
  }

  async function saveRoomType() {
    if (!roomTypeDraft.name.trim()) {
      setError("نام فارسی اتاق را وارد کنید.");
      return;
    }

    const totalInventory = Math.max(1, roomTypeDraft.totalInventory);
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: roomTypeDraft.name.trim(),
        englishName: roomTypeDraft.englishName.trim() || null,
        description: roomTypeDraft.description.trim() || roomTypeDraft.name.trim(),
        maxAdults: Math.max(1, roomTypeDraft.maxAdults),
        maxChildren: Math.max(0, roomTypeDraft.maxChildren),
        inventoryMode: roomInventoryMode(totalInventory),
        totalInventory,
        basePrice: null,
        notes: roomTypeDraft.notes.trim() || null,
        floorNumber: nullableNumber(roomTypeDraft.floorNumber),
        stairCount: nullableNumber(roomTypeDraft.stairCount),
        hasWindow: roomTypeDraft.hasWindow,
        hasPrivateBathroom: roomTypeDraft.hasPrivateBathroom,
        bedConfigurations: roomTypeDraft.bedConfigurations.filter(
          (bed) => bed.bedTypeId && bed.quantity > 0,
        ),
        amenityIds: roomTypeDraft.amenityIds,
        isActive: true,
      };

      const saved = await apiRequest<RoomTypeResponse>(
        roomTypeDraft.id
          ? `/owner/room-types/${roomTypeDraft.id}`
          : `/owner/properties/${propertyId}/room-types`,
        {
          method: roomTypeDraft.id ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      if (roomTypeDraft.id) setRoomTypeDraft(emptyRoomType);
      else editRoomType(saved);
      await loadRoomTypes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "اتاق ذخیره نشد.");
    } finally {
      setSaving(false);
    }
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
              هر ردیف یک واحد قابل فروش است؛ موجودی ۱ مثل اتاق نام‌دار عمل می‌کند و موجودی بیشتر مثل دسته اتاق هتل.
            </p>
          </div>
          {roomTypeDraft.id && (
            <button
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold"
              onClick={() => setRoomTypeDraft(emptyRoomType)}
              type="button"
            >
              فرم جدید
            </button>
          )}
        </div>

        <div className="mt-5 grid gap-5">
          <div>
            <h3 className="font-black">اطلاعات پایه</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">
                نام فارسی
                <input
                  className={inputClass}
                  onChange={(event) =>
                    setRoomTypeDraft({ ...roomTypeDraft, name: event.target.value })
                  }
                  value={roomTypeDraft.name}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                نام انگلیسی
                <input
                  className={inputClass}
                  dir="ltr"
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      englishName: event.target.value,
                    })
                  }
                  value={roomTypeDraft.englishName}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold md:col-span-2">
                توضیح
                <textarea
                  className={inputClass}
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      description: event.target.value,
                    })
                  }
                  rows={3}
                  value={roomTypeDraft.description}
                />
              </label>
            </div>
          </div>

          <div>
            <h3 className="font-black">ظرفیت و موجودی</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <label className="grid gap-1 text-sm font-bold">
                ظرفیت بزرگسال
                <input
                  className={inputClass}
                  min="1"
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      maxAdults: Number(event.target.value),
                    })
                  }
                  type="number"
                  value={roomTypeDraft.maxAdults}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                ظرفیت کودک
                <input
                  className={inputClass}
                  min="0"
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      maxChildren: Number(event.target.value),
                    })
                  }
                  type="number"
                  value={roomTypeDraft.maxChildren}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                موجودی کل
                <input
                  className={inputClass}
                  min="1"
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      totalInventory: Number(event.target.value),
                    })
                  }
                  type="number"
                  value={roomTypeDraft.totalInventory}
                />
              </label>
            </div>
          </div>

          <div>
            <h3 className="font-black">ویژگی‌های فیزیکی</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">
                طبقه
                <input
                  className={inputClass}
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      floorNumber: event.target.value,
                    })
                  }
                  type="number"
                  value={roomTypeDraft.floorNumber}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                تعداد پله
                <input
                  className={inputClass}
                  min="0"
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      stairCount: event.target.value,
                    })
                  }
                  type="number"
                  value={roomTypeDraft.stairCount}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                پنجره
                <select
                  className={inputClass}
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      hasWindow:
                        event.target.value === ""
                          ? null
                          : event.target.value === "true",
                    })
                  }
                  value={roomTypeDraft.hasWindow === null ? "" : String(roomTypeDraft.hasWindow)}
                >
                  <option value="">ثبت نشده</option>
                  <option value="true">دارد</option>
                  <option value="false">ندارد</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-bold">
                سرویس بهداشتی اختصاصی
                <select
                  className={inputClass}
                  onChange={(event) =>
                    setRoomTypeDraft({
                      ...roomTypeDraft,
                      hasPrivateBathroom:
                        event.target.value === ""
                          ? null
                          : event.target.value === "true",
                    })
                  }
                  value={
                    roomTypeDraft.hasPrivateBathroom === null
                      ? ""
                      : String(roomTypeDraft.hasPrivateBathroom)
                  }
                >
                  <option value="">ثبت نشده</option>
                  <option value="true">دارد</option>
                  <option value="false">ندارد</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-bold md:col-span-2">
                یادداشت اتاق
                <textarea
                  className={inputClass}
                  onChange={(event) =>
                    setRoomTypeDraft({ ...roomTypeDraft, notes: event.target.value })
                  }
                  rows={3}
                  value={roomTypeDraft.notes}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <strong>ترکیب تخت</strong>
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
              onClick={() =>
                setRoomTypeDraft((current) => ({
                  ...current,
                  bedConfigurations: [
                    ...current.bedConfigurations,
                    { bedTypeId: bedTypes[0]?.id ?? 0, quantity: 1 },
                  ],
                }))
              }
              type="button"
            >
              افزودن تخت
            </button>
          </div>
          {roomTypeDraft.bedConfigurations.map((bed, index) => (
            <div className="grid gap-2 md:grid-cols-[1fr_120px_auto]" key={index}>
              <select
                className={inputClass}
                onChange={(event) =>
                  updateBed(index, { bedTypeId: Number(event.target.value) })
                }
                value={bed.bedTypeId}
              >
                {bedTypes.map((bedType) => (
                  <option key={bedType.id} value={bedType.id}>
                    {bedTypeLabel(bedType.slug, bedType.name)}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                min="1"
                onChange={(event) =>
                  updateBed(index, { quantity: Number(event.target.value) })
                }
                type="number"
                value={bed.quantity}
              />
              <button
                className="text-sm font-bold text-red-700"
                onClick={() =>
                  setRoomTypeDraft((current) => ({
                    ...current,
                    bedConfigurations: current.bedConfigurations.filter(
                      (_, candidate) => candidate !== index,
                    ),
                  }))
                }
                type="button"
              >
                حذف
              </button>
            </div>
          ))}
        </div>

        <fieldset className="mt-5">
          <legend className="mb-2 font-black">امکانات اتاق</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {roomAmenityOptions.map((amenity) => (
              <label
                className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-bold"
                key={amenity.id}
              >
                <input
                  checked={roomTypeDraft.amenityIds.includes(amenity.id)}
                  className="h-4 w-4 accent-blue-600"
                  onChange={(event) =>
                    setRoomTypeDraft((current) => ({
                      ...current,
                      amenityIds: event.target.checked
                        ? [...current.amenityIds, amenity.id]
                        : current.amenityIds.filter((id) => id !== amenity.id),
                    }))
                  }
                  type="checkbox"
                />
                {amenity.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 rounded-2xl border border-slate-200 p-4">
          <div>
            <h3 className="font-black">تصاویر اتاق</h3>
            <p className="mt-1 text-sm text-slate-500">
              برای بارگذاری تصویر، ابتدا اتاق را ذخیره کنید. تصاویر این بخش به همین اتاق متصل می‌شوند.
            </p>
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
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              پس از ذخیره اتاق، مدیریت تصاویر فعال می‌شود.
            </p>
          )}
        </div>

        <button
          className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60"
          disabled={saving}
          onClick={saveRoomType}
          type="button"
        >
          {roomTypeDraft.id ? "ذخیره تغییرات اتاق" : "افزودن اتاق"}
        </button>
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
              booleanLabel(
                roomType.hasPrivateBathroom,
                "سرویس اختصاصی",
                "سرویس مشترک",
              ),
            ].filter(Boolean);

            return (
              <article
                className="rounded-2xl border border-slate-200 p-4"
                key={roomType.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black">{roomType.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {roomType.maxAdults + roomType.maxChildren} نفر ·{" "}
                      {roomType.totalInventory === 1
                        ? "یک واحد اختصاصی"
                        : `موجودی کل ${roomType.totalInventory}`}
                    </p>
                    {roomType.bedConfigurations.length > 0 && (
                      <p className="mt-2 text-sm text-slate-600">
                        {roomType.bedConfigurations
                          .map(
                            (bed) =>
                              `${bed.quantity} × ${bedTypeLabel(
                                bed.bedTypeSlug,
                                bed.bedTypeName,
                              )}`,
                          )
                          .join("، ")}
                      </p>
                    )}
                    {details.length > 0 && (
                      <p className="mt-2 text-sm font-semibold text-slate-700">
                        {details.join(" · ")}
                      </p>
                    )}
                    {roomType.notes && (
                      <p className="mt-2 text-sm text-slate-500">
                        {roomType.notes}
                      </p>
                    )}
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
                  <button
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
                    onClick={() => editRoomType(roomType)}
                    type="button"
                  >
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
    </div>
  );
}
