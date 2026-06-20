"use client";

import { useMemo, useState } from "react";
import { SharedUploader } from "@/components/SharedUploader";
import {
  getToken,
  PropertyImageResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";

interface ImageUploadDropzoneProps {
  propertyId: number | null;
  roomTypes?: RoomTypeResponse[];
  fixedRoomTypeId?: number | null;
  onUploaded?: (images: PropertyImageResponse[]) => void;
}

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

export function ImageUploadDropzone({
  propertyId,
  roomTypes = [],
  fixedRoomTypeId,
  onUploaded,
}: ImageUploadDropzoneProps) {
  const [tag, setTag] = useState("other");
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [isCover, setIsCover] = useState(false);
  const [roomTypeId, setRoomTypeId] = useState("");
  const token = getToken();
  const effectiveRoomTypeId =
    fixedRoomTypeId == null ? roomTypeId : String(fixedRoomTypeId);
  const canUpload = Boolean(propertyId) && fixedRoomTypeId !== null;
  const aspect = useMemo(() => (isCover ? 16 / 9 : 4 / 3), [isCover]);

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-bold">
          برچسب
          <select className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setTag(event.target.value)} value={tag}>
            {imageTags.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          متن جایگزین
          <input className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setAltText(event.target.value)} value={altText} />
        </label>
        <label className="grid gap-1 text-sm font-bold md:col-span-2">
          کپشن
          <input className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setCaption(event.target.value)} value={caption} />
        </label>
        {fixedRoomTypeId == null && roomTypes.length > 0 && (
          <label className="grid gap-1 text-sm font-bold">
            اتصال به اتاق
            <select className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setRoomTypeId(event.target.value)} value={roomTypeId}>
              <option value="">تصویر اقامتگاه</option>
              {roomTypes.map((roomType) => (
                <option key={roomType.id} value={roomType.id}>
                  {roomType.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-bold">
          <input checked={isCover} className="h-4 w-4 accent-blue-600" onChange={(event) => setIsCover(event.target.checked)} type="checkbox" />
          تصویر کاور باشد
        </label>
      </div>

      <SharedUploader
        accept={["image/jpeg", "image/png", "image/webp"]}
        cropAspectRatio={aspect}
        disabled={!canUpload}
        enableCrop
        enablePreview
        extraFormFields={{
          tag,
          caption,
          altText,
          isCover,
          roomTypeId: effectiveRoomTypeId || undefined,
        }}
        fieldName="files"
        headers={token ? { Authorization: `Bearer ${token}` } : undefined}
        labels={{
          title: "بارگذاری تصویر",
          description: "تصویرها را بکشید و رها کنید یا از فایل‌های سیستم انتخاب کنید.",
          uploadText: "بارگذاری تصاویر",
          uploadingText: "در حال بارگذاری...",
          successText: "تصاویر با موفقیت بارگذاری شدند.",
        }}
        maxFileSizeMb={5}
        multiple
        onUploadSuccess={(uploaded) => onUploaded?.(uploaded as unknown as PropertyImageResponse[])}
        uploadUrl={`/api/backend/owner/properties/${propertyId}/images/upload`}
      />

      {!canUpload && (
        <p className="text-xs font-semibold text-slate-500">
          برای بارگذاری فایل، ابتدا اقامتگاه را ذخیره کنید.
        </p>
      )}
    </section>
  );
}
