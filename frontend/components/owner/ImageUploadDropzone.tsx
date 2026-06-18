"use client";

import Cropper, { Area } from "react-easy-crop";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getToken,
  PropertyImageResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
};

interface ImageUploadDropzoneProps {
  propertyId: number | null;
  roomTypes?: RoomTypeResponse[];
  fixedRoomTypeId?: number | null;
  onUploaded?: (images: PropertyImageResponse[]) => void;
}

const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
const maxFileSize = 5 * 1024 * 1024;
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

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function makePreview(file: File): PendingImage {
  return {
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    previewUrl: URL.createObjectURL(file),
    progress: 0,
  };
}

async function cropImage(
  file: File,
  croppedAreaPixels: Area,
): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

  const canvas = document.createElement("canvas");
  canvas.width = croppedAreaPixels.width;
  canvas.height = croppedAreaPixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("امکان برش تصویر وجود ندارد.");

  context.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
  );

  URL.revokeObjectURL(image.src);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, file.type || "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("برش تصویر انجام نشد.");

  return new File([blob], file.name, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

export function ImageUploadDropzone({
  propertyId,
  roomTypes = [],
  fixedRoomTypeId,
  onUploaded,
}: ImageUploadDropzoneProps) {
  const [items, setItems] = useState<PendingImage[]>([]);
  const [tag, setTag] = useState("other");
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [isCover, setIsCover] = useState(false);
  const [roomTypeId, setRoomTypeId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cropTarget, setCropTarget] = useState<PendingImage | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const aspect = useMemo(() => (isCover ? 16 / 9 : 4 / 3), [isCover]);
  const effectiveRoomTypeId =
    fixedRoomTypeId == null ? roomTypeId : String(fixedRoomTypeId);
  const canUpload = Boolean(propertyId) && fixedRoomTypeId !== null;

  useEffect(() => {
    return () => {
      items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [items]);

  const addFiles = useCallback((files: FileList | File[]) => {
    setError("");
    const next: PendingImage[] = [];
    for (const file of Array.from(files)) {
      if (!allowedTypes.includes(file.type)) {
        setError("فقط فایل‌های jpg، png و webp قابل بارگذاری هستند.");
        continue;
      }
      if (file.size > maxFileSize) {
        setError("حجم هر تصویر باید حداکثر ۵ مگابایت باشد.");
        continue;
      }
      next.push(makePreview(file));
    }
    if (next.length) setItems((current) => [...current, ...next]);
  }, []);

  function removeItem(id: string) {
    setItems((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function confirmCrop() {
    if (!cropTarget || !croppedPixels) return;
    setError("");
    try {
      const croppedFile = await cropImage(cropTarget.file, croppedPixels);
      const previewUrl = URL.createObjectURL(croppedFile);
      setItems((current) =>
        current.map((item) => {
          if (item.id !== cropTarget.id) return item;
          URL.revokeObjectURL(item.previewUrl);
          return { ...item, file: croppedFile, previewUrl };
        }),
      );
      setCropTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "برش تصویر انجام نشد.");
    }
  }

  function upload() {
    if (!canUpload) {
      setError("ابتدا اقامتگاه را ذخیره کنید، سپس تصویر بارگذاری کنید.");
      return;
    }
    if (!items.length) {
      setError("حداقل یک تصویر انتخاب کنید.");
      return;
    }

    setUploading(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    items.forEach((item) => formData.append("files", item.file));
    formData.append("tag", tag);
    formData.append("caption", caption);
    formData.append("altText", altText);
    formData.append("isCover", String(isCover));
    if (effectiveRoomTypeId) formData.append("roomTypeId", effectiveRoomTypeId);

    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `/api/backend/owner/properties/${propertyId}/images/upload`,
    );
    const token = getToken();
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setItems((current) => current.map((item) => ({ ...item, progress })));
    };

    request.onload = () => {
      setUploading(false);
      if (request.status >= 200 && request.status < 300) {
        const uploaded = JSON.parse(request.responseText) as PropertyImageResponse[];
        items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        setItems([]);
        setMessage("تصاویر با موفقیت بارگذاری شدند.");
        onUploaded?.(uploaded);
      } else {
        const body = JSON.parse(request.responseText || "{}") as { message?: string };
        setError(body.message ?? "بارگذاری تصویر انجام نشد.");
      }
    };

    request.onerror = () => {
      setUploading(false);
      setError("ارتباط با سرور برای بارگذاری تصویر برقرار نشد.");
    };

    request.send(formData);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">بارگذاری تصویر</h3>
          <p className="mt-1 text-sm text-slate-500">
            تصویرها را بکشید و رها کنید یا از فایل‌های سیستم انتخاب کنید.
          </p>
        </div>
        {isCover && (
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            برای کاور، برش ۱۶:۹ پیشنهاد می‌شود.
          </span>
        )}
      </div>

      <div
        className={`mt-4 grid min-h-40 cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
      >
        <div>
          <p className="text-base font-black text-slate-800">
            فایل‌های تصویر را اینجا رها کنید
          </p>
          <p className="mt-2 text-sm text-slate-500">
            JPG، PNG یا WEBP تا ۵ مگابایت
          </p>
          <button
            className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white"
            type="button"
          >
            انتخاب فایل
          </button>
        </div>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          multiple
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.currentTarget.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-bold">
          برچسب
          <select
            className="rounded-xl border border-slate-300 px-3 py-2.5"
            onChange={(event) => setTag(event.target.value)}
            value={tag}
          >
            {imageTags.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          متن جایگزین
          <input
            className="rounded-xl border border-slate-300 px-3 py-2.5"
            onChange={(event) => setAltText(event.target.value)}
            value={altText}
          />
        </label>
        <label className="grid gap-1 text-sm font-bold md:col-span-2">
          کپشن
          <input
            className="rounded-xl border border-slate-300 px-3 py-2.5"
            onChange={(event) => setCaption(event.target.value)}
            value={caption}
          />
        </label>
        {fixedRoomTypeId == null && roomTypes.length > 0 && (
          <label className="grid gap-1 text-sm font-bold">
            اتصال به اتاق
            <select
              className="rounded-xl border border-slate-300 px-3 py-2.5"
              onChange={(event) => setRoomTypeId(event.target.value)}
              value={roomTypeId}
            >
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
          <input
            checked={isCover}
            className="h-4 w-4 accent-blue-600"
            onChange={(event) => setIsCover(event.target.checked)}
            type="checkbox"
          />
          تصویر کاور باشد
        </label>
      </div>

      {items.length > 0 && (
        <div className="mt-5 grid gap-3">
          {items.map((item) => (
            <article
              className="grid gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-[96px_minmax(0,1fr)_auto]"
              key={item.id}
            >
              <img
                alt={item.file.name}
                className="aspect-[4/3] w-24 rounded-xl object-cover"
                src={item.previewUrl}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{item.file.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatSize(item.file.size)}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700"
                  onClick={() => {
                    setCropTarget(item);
                    setCrop({ x: 0, y: 0 });
                    setZoom(1);
                  }}
                  type="button"
                >
                  برش تصویر
                </button>
                <button
                  className="rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-700"
                  onClick={() => removeItem(item.id)}
                  type="button"
                >
                  حذف
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {(error || message) && (
        <p
          className={`mt-4 rounded-xl p-3 text-sm font-semibold ${
            error ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
          }`}
        >
          {error || message}
        </p>
      )}

      <button
        className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60"
        disabled={uploading || !items.length || !canUpload}
        onClick={upload}
        type="button"
      >
        {uploading ? "در حال بارگذاری..." : "بارگذاری تصاویر"}
      </button>

      {!canUpload && (
        <p className="mt-2 text-xs font-semibold text-slate-500">
          برای بارگذاری فایل، ابتدا اقامتگاه را ذخیره کنید.
        </p>
      )}

      {cropTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black">برش تصویر</h3>
              <button
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                onClick={() => setCropTarget(null)}
                type="button"
              >
                بستن
              </button>
            </div>
            <div className="relative mt-4 h-[420px] overflow-hidden rounded-2xl bg-slate-900">
              <Cropper
                aspect={aspect}
                crop={crop}
                image={cropTarget.previewUrl}
                onCropChange={setCrop}
                onCropComplete={(_, pixels) => setCroppedPixels(pixels)}
                onZoomChange={setZoom}
                zoom={zoom}
              />
            </div>
            <label className="mt-4 grid gap-1 text-sm font-bold">
              بزرگ‌نمایی
              <input
                max="3"
                min="1"
                onChange={(event) => setZoom(Number(event.target.value))}
                step="0.1"
                type="range"
                value={zoom}
              />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-xl border border-slate-300 px-4 py-2 font-bold"
                onClick={() => setCropTarget(null)}
                type="button"
              >
                انصراف
              </button>
              <button
                className="rounded-xl bg-blue-600 px-4 py-2 font-black text-white"
                onClick={confirmCrop}
                type="button"
              >
                تایید برش
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
