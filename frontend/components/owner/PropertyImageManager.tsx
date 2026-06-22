"use client";

import { useEffect, useMemo, useState } from "react";
import { CropSaveMode, ImageUploadConstraints, MediaGallery } from "@/components/MediaGallery";
import { apiRequest, getToken, PropertyImageResponse, RoomTypeResponse } from "@/lib/owner-api";
import { toast } from "sonner";

interface PropertyImageManagerProps {
  propertyId?: number | null;
  images: PropertyImageResponse[];
  roomTypes?: RoomTypeResponse[];
  fixedRoomTypeId?: number | null;
  aspectRatio?: number;
  allowFreeCrop?: boolean;
  cropSaveMode?: CropSaveMode;
  onImagesChange: (images: PropertyImageResponse[]) => void;
}

export function PropertyImageManager({
  propertyId,
  images,
  fixedRoomTypeId,
  aspectRatio,
  allowFreeCrop = false,
  cropSaveMode = "replace",
  onImagesChange,
}: PropertyImageManagerProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [constraints, setConstraints] = useState<ImageUploadConstraints>({
    maxFileSizeMb: 2,
    minWidth: 800,
    minHeight: 600,
    maxImages: 30,
  });
  const mode = fixedRoomTypeId === undefined ? "property" : "room";
  const effectiveAspectRatio = aspectRatio ?? (mode === "property" ? 4 / 3 : 1);
  const effectivePropertyId = propertyId ?? images[0]?.propertyId ?? null;

  useEffect(() => {
    fetch("/api/backend/site-settings/public")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((settings: Record<string, string>) => {
        const positive = (key: string, fallback: number) => {
          const value = Number(settings[key]);
          return Number.isFinite(value) && value > 0 ? value : fallback;
        };
        setConstraints({
          maxFileSizeMb: positive("image.maxFileSizeMb", 2),
          minWidth: positive("image.minWidth", 800),
          minHeight: positive("image.minHeight", 600),
          maxImages: positive("image.maxImagesPerProperty", 30),
        });
      })
      .catch(() => undefined);
  }, []);

  const visibleImages = useMemo(
    () => images
      .filter((image) => mode === "property"
        ? image.roomTypeId == null && image.roomId == null
        : image.roomTypeId === fixedRoomTypeId)
      .sort((first, second) => first.sortOrder - second.sortOrder),
    [fixedRoomTypeId, images, mode],
  );

  async function uploadFiles(files: File[], source?: PropertyImageResponse, replacing = false) {
    if (!effectivePropertyId) throw new Error("ابتدا اقامتگاه را ذخیره کنید.");
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("tag", source?.tag || (mode === "room" ? "room" : "other"));
    formData.append("caption", source?.caption || "");
    formData.append("altText", source?.altText || "");
    formData.append("isCover", String(mode === "property" && Boolean(source?.isCover)));
    if (mode === "room" && fixedRoomTypeId) formData.append("roomTypeId", String(fixedRoomTypeId));
    if (source && replacing) formData.append("replaceImageId", String(source.id));

    setUploadProgress(0);
    return new Promise<PropertyImageResponse[]>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/api/backend/owner/properties/${effectivePropertyId}/images/upload`);
      const token = getToken();
      if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      };
      request.onload = () => {
        let parsed: PropertyImageResponse[] | { message?: string } = [];
        try {
          parsed = request.responseText ? JSON.parse(request.responseText) as PropertyImageResponse[] | { message?: string } : [];
        } catch {
          reject(new Error("پاسخ بارگذاری تصویر معتبر نبود."));
          return;
        }
        if (request.status >= 200 && request.status < 300) {
          setUploadProgress(100);
          resolve(parsed as PropertyImageResponse[]);
        } else {
          reject(new Error(!Array.isArray(parsed) && parsed.message ? parsed.message : "بارگذاری تصاویر انجام نشد."));
        }
      };
      request.onerror = () => reject(new Error("ارتباط برای بارگذاری تصویر برقرار نشد."));
      request.send(formData);
    });
  }

  async function addImages(files: File[]) {
    setUploading(true);
    setError("");
    try {
      const uploaded = await uploadFiles(files);
      onImagesChange([...images, ...uploaded]);
      toast.success("تصویر با موفقیت بارگذاری شد");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "بارگذاری تصاویر انجام نشد.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function patchImage(image: PropertyImageResponse, isCover: boolean) {
    setBusyId(image.id);
    setError("");
    try {
      const updated = await apiRequest<PropertyImageResponse>(`/owner/property-images/${image.id}`, {
        method: "PUT",
        body: JSON.stringify({
          url: image.url,
          altText: image.altText,
          caption: image.caption,
          tag: image.tag,
          roomTypeId: image.roomTypeId,
          roomId: image.roomId,
          sortOrder: image.sortOrder,
          isCover,
          isGallery: image.isGallery,
        }),
      });
      onImagesChange(images.map((item) => item.id === updated.id
        ? updated
        : mode === "property" && updated.isCover && item.roomTypeId == null && item.roomId == null
          ? { ...item, isCover: false }
          : item));
      toast.success("عکس کاور تغییر کرد");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تصویر ذخیره نشد.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteImage(image: PropertyImageResponse) {
    setBusyId(image.id);
    setError("");
    try {
      await apiRequest(`/owner/property-images/${image.id}`, { method: "DELETE" });
      onImagesChange(images.filter((item) => item.id !== image.id));
      toast.success("تصویر حذف شد");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تصویر حذف نشد.");
    } finally {
      setBusyId(null);
    }
  }

  async function cropImage(image: PropertyImageResponse, file: File, saveMode: CropSaveMode) {
    setBusyId(image.id);
    setError("");
    try {
      const replacing = saveMode === "replace";
      const [replacement] = await uploadFiles([file], image, replacing);
      if (replacing) {
        await apiRequest(`/owner/property-images/${image.id}`, { method: "DELETE" });
        onImagesChange(images.map((item) => item.id === image.id ? replacement : item));
      } else {
        onImagesChange([
          ...images.map((item) => replacement.isCover && item.roomTypeId == null && item.roomId == null ? { ...item, isCover: false } : item),
          replacement,
        ]);
      }
      toast.success("تصویر برش خورد");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "برش تصویر ذخیره نشد.";
      setError(message);
      throw new Error(message);
    } finally {
      setBusyId(null);
      setUploadProgress(null);
    }
  }

  return (
    <div className="grid gap-3">
      <aside className="rounded-2xl border border-[var(--theme-primary-border)] bg-[var(--theme-primary-soft)] px-4 py-3 text-sm font-bold leading-7 text-[var(--theme-primary-text)]" role="note">
        <ul className="grid list-inside list-disc gap-x-6 sm:grid-cols-2">
          <li>حداقل ۳ عکس برای اقامتگاه پیشنهاد می‌شود</li>
          <li>حجم هر عکس حداکثر {constraints.maxFileSizeMb.toLocaleString("fa-IR")} مگابایت</li>
          <li>فرمت‌های مجاز: JPG، PNG، WEBP</li>
          <li>ابعاد پیشنهادی: حداقل {constraints.minWidth.toLocaleString("fa-IR")}×{constraints.minHeight.toLocaleString("fa-IR")} پیکسل</li>
        </ul>
      </aside>
      <MediaGallery
      allowFreeCrop={allowFreeCrop}
      aspectRatio={effectiveAspectRatio}
      busyId={busyId}
      constraints={constraints}
      cropSaveMode={cropSaveMode}
      disabled={!effectivePropertyId || (mode === "room" && !fixedRoomTypeId)}
      error={error}
      items={visibleImages.map((image) => ({
        ...image,
        alt: image.altText || image.caption,
        isMain: mode === "property" && image.isCover,
      }))}
      mode={mode}
      onAdd={addImages}
      onCrop={cropImage}
      onDelete={deleteImage}
      onSetMain={mode === "property" ? (image) => patchImage(image, true) : undefined}
      totalItemCount={images.length}
      uploading={uploading}
      uploadProgress={uploadProgress}
      />
    </div>
  );
}
