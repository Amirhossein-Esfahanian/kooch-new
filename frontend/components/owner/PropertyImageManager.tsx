"use client";

import { useMemo, useState } from "react";
import {
  apiRequest,
  PropertyImageResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";

interface PropertyImageManagerProps {
  images: PropertyImageResponse[];
  roomTypes?: RoomTypeResponse[];
  fixedRoomTypeId?: number | null;
  onImagesChange: (images: PropertyImageResponse[]) => void;
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const imageTags = [
  { value: "exterior", label: "نمای بیرونی" },
  { value: "courtyard", label: "حیاط" },
  { value: "lobby", label: "لابی" },
  { value: "room", label: "اتاق" },
  { value: "bathroom", label: "حمام" },
  { value: "breakfast", label: "صبحانه" },
  { value: "restaurant", label: "رستوران" },
  { value: "amenities", label: "امکانات" },
  { value: "other", label: "سایر" },
];

function imageScopeLabel(image: PropertyImageResponse, roomTypes: RoomTypeResponse[]) {
  if (!image.roomTypeId) return "تصویر عمومی اقامتگاه";
  return roomTypes.find((roomType) => roomType.id === image.roomTypeId)?.name ?? "اتاق";
}

export function PropertyImageManager({
  images,
  roomTypes = [],
  fixedRoomTypeId,
  onImagesChange,
}: PropertyImageManagerProps) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const visibleImages = useMemo(() => {
    if (fixedRoomTypeId === undefined) return images;
    return images.filter((image) =>
      fixedRoomTypeId === null
        ? image.roomTypeId == null && image.roomId == null
        : image.roomTypeId === fixedRoomTypeId,
    );
  }, [fixedRoomTypeId, images]);

  async function patchImage(
    image: PropertyImageResponse,
    patch: Partial<PropertyImageResponse>,
  ) {
    setSavingId(image.id);
    setError("");
    try {
      const updated = await apiRequest<PropertyImageResponse>(
        `/owner/property-images/${image.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            url: image.url,
            altText: patch.altText ?? image.altText,
            caption: patch.caption ?? image.caption,
            tag: patch.tag ?? image.tag,
            roomTypeId:
              patch.roomTypeId === undefined ? image.roomTypeId : patch.roomTypeId,
            roomId: null,
            sortOrder: patch.sortOrder ?? image.sortOrder,
            isCover: patch.isCover ?? image.isCover,
            isGallery: patch.isGallery ?? image.isGallery,
          }),
        },
      );
      onImagesChange(
        images.map((item) => {
          if (item.id === updated.id) return updated;
          const sameScope =
            item.propertyId === updated.propertyId &&
            item.roomTypeId === updated.roomTypeId &&
            item.roomId == null;
          return updated.isCover && sameScope
            ? { ...item, isCover: false }
            : item;
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تصویر ذخیره نشد.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteImage(imageId: number) {
    setSavingId(imageId);
    setError("");
    try {
      await apiRequest(`/owner/property-images/${imageId}`, { method: "DELETE" });
      onImagesChange(images.filter((image) => image.id !== imageId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تصویر حذف نشد.");
    } finally {
      setSavingId(null);
    }
  }

  if (!visibleImages.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        هنوز تصویری ثبت نشده است.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleImages.map((image) => (
          <article
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            key={image.id}
          >
            <div className="relative">
              <img
                alt={image.altText || image.caption || "تصویر اقامتگاه"}
                className="h-[120px] w-[160px] rounded-br-2xl object-cover sm:h-40 sm:w-full"
                src={image.url}
              />
              {image.isCover && (
                <span className="absolute right-3 top-3 rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">
                  کاور
                </span>
              )}
            </div>
            <div className="grid gap-3 p-4">
              <p className="text-sm font-bold text-slate-600">
                {imageScopeLabel(image, roomTypes)}
              </p>
              <label className="grid gap-1 text-xs font-bold">
                دسته تصویر
                <select
                  className={inputClass}
                  disabled={savingId === image.id}
                  onChange={(event) => patchImage(image, { tag: event.target.value })}
                  value={image.tag ?? "other"}
                >
                  {imageTags.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold">
                کپشن
                <input
                  className={inputClass}
                  onBlur={(event) =>
                    event.target.value !== (image.caption ?? "") &&
                    patchImage(image, { caption: event.target.value || null })
                  }
                  defaultValue={image.caption ?? ""}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold">
                متن جایگزین
                <input
                  className={inputClass}
                  onBlur={(event) =>
                    event.target.value !== (image.altText ?? "") &&
                    patchImage(image, { altText: event.target.value || null })
                  }
                  defaultValue={image.altText ?? ""}
                />
              </label>
              {fixedRoomTypeId === undefined && (
                <label className="grid gap-1 text-xs font-bold">
                  انتساب تصویر
                  <select
                    className={inputClass}
                    disabled={savingId === image.id}
                    onChange={(event) =>
                      patchImage(image, {
                        roomTypeId: event.target.value
                          ? Number(event.target.value)
                          : null,
                        isCover: false,
                      })
                    }
                    value={image.roomTypeId ?? ""}
                  >
                    <option value="">تصویر عمومی اقامتگاه</option>
                    {roomTypes.map((roomType) => (
                      <option key={roomType.id} value={roomType.id}>
                        {roomType.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-60"
                  disabled={savingId === image.id}
                  onClick={() => patchImage(image, { isCover: true })}
                  type="button"
                >
                  {image.roomTypeId ? "کاور اتاق" : "کاور اقامتگاه"}
                </button>
                <button
                  className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-60"
                  disabled={savingId === image.id}
                  onClick={() => deleteImage(image.id)}
                  type="button"
                >
                  حذف
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
