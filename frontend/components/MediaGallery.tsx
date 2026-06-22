"use client";

import Cropper, { Area } from "react-easy-crop";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export interface MediaGalleryItem {
  id: string | number;
  url: string;
  alt?: string | null;
  isMain?: boolean;
}

export interface ImageUploadConstraints {
  maxFileSizeMb: number;
  minWidth: number;
  minHeight: number;
  maxImages: number;
}

interface MediaGalleryProps<T extends MediaGalleryItem> {
  items: T[];
  mode: "property" | "room";
  onAdd: (files: File[]) => void | Promise<void>;
  onCrop: (item: T, file: File, saveMode: CropSaveMode) => void | Promise<void>;
  onDelete: (item: T) => void | Promise<void>;
  onSetMain?: (item: T) => void | Promise<void>;
  aspectRatio?: number;
  accept?: string;
  disabled?: boolean;
  busyId?: string | number | null;
  uploading?: boolean;
  error?: string;
  constraints?: ImageUploadConstraints;
  totalItemCount?: number;
  allowFreeCrop?: boolean;
  cropSaveMode?: CropSaveMode;
  uploadProgress?: number | null;
}

export type CropSaveMode = "replace" | "new";

const defaultConstraints: ImageUploadConstraints = {
  maxFileSizeMb: 2,
  minWidth: 800,
  minHeight: 600,
  maxImages: 30,
};

async function dimensions(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("فرمت فایل پشتیبانی نمی‌شود"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function DotsIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
      <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="22">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function GalleryThumbnail({ item, preload }: { item: MediaGalleryItem; preload: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <span className="media-skeleton absolute inset-0 bg-slate-200" />}
      <Image
        alt={item.alt || "تصویر اقامتگاه"}
        className={`h-full w-full object-cover transition duration-300 hover:scale-[1.03] ${loaded ? "opacity-100" : "opacity-0"}`}
        fill
        loading={preload ? "eager" : "lazy"}
        onLoad={() => setLoaded(true)}
        priority={preload}
        quality={45}
        sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1535px) 25vw, 17vw"
        src={item.url}
        unoptimized={!item.url.startsWith("/")}
      />
    </>
  );
}

function ProgressiveViewerImage({ item }: { item: MediaGalleryItem }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  return (
    <div className="relative h-full w-full">
      <Image
        alt=""
        className="object-contain blur-sm"
        fill
        priority
        quality={35}
        sizes="92vw"
        src={item.url}
        unoptimized={!item.url.startsWith("/")}
      />
      <img
        alt={item.alt || "پیش‌نمایش تصویر"}
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-500 ${fullLoaded ? "opacity-100" : "opacity-0"}`}
        loading="eager"
        onLoad={() => setFullLoaded(true)}
        src={item.url}
      />
    </div>
  );
}

async function croppedFile(item: MediaGalleryItem, pixels: Area, constraints: ImageUploadConstraints) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new window.Image();
    element.crossOrigin = "anonymous";
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("بارگذاری تصویر برای برش ممکن نشد."));
    element.src = item.url;
  });
  const canvas = document.createElement("canvas");
  const scale = Math.min(4, Math.max(1, constraints.minWidth / pixels.width, constraints.minHeight / pixels.height));
  canvas.width = Math.round(pixels.width * scale);
  canvas.height = Math.round(pixels.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("امکان برش تصویر وجود ندارد.");
  context.drawImage(image, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("ساخت تصویر برش‌خورده ممکن نشد.")), "image/webp", 0.9),
  );
  return new File([blob], `image-${item.id}.webp`, { type: "image/webp" });
}

export function MediaGallery<T extends MediaGalleryItem>({
  items,
  mode,
  onAdd,
  onCrop,
  onDelete,
  onSetMain,
  aspectRatio = 4 / 3,
  accept = "image/jpeg,image/png,image/webp",
  disabled = false,
  busyId = null,
  uploading = false,
  error = "",
  constraints = defaultConstraints,
  totalItemCount = items.length,
  allowFreeCrop = false,
  cropSaveMode = "replace",
  uploadProgress = null,
}: MediaGalleryProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuId, setMenuId] = useState<string | number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const touchStartX = useRef<number | null>(null);
  const [cropTarget, setCropTarget] = useState<T | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [cropAspect, setCropAspect] = useState<number | null>(aspectRatio);
  const [selectedSaveMode, setSelectedSaveMode] = useState<CropSaveMode>(cropSaveMode);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [cropError, setCropError] = useState("");
  const [cropping, setCropping] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (error) setToast(error);
  }, [error]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const closeMenu = () => setMenuId(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuId(null);
        setPreviewIndex(null);
        setCropTarget(null);
      }
      if (event.key === "ArrowLeft") setPreviewIndex((current) => current === null ? null : (current + 1) % items.length);
      if (event.key === "ArrowRight") setPreviewIndex((current) => current === null ? null : (current - 1 + items.length) % items.length);
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [items.length]);

  const preview = previewIndex === null ? null : items[previewIndex];

  function movePreview(direction: -1 | 1) {
    setPreviewIndex((current) => current === null ? null : (current + direction + items.length) % items.length);
    setPreviewZoom(1);
  }

  async function confirmCrop() {
    if (!cropTarget || !cropPixels) return;
    setCropping(true);
    setCropError("");
    try {
      await onCrop(cropTarget, await croppedFile(cropTarget, cropPixels, constraints), selectedSaveMode);
      setCropTarget(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "برش تصویر انجام نشد.";
      setCropError(message);
      setToast(message);
    } finally {
      setCropping(false);
    }
  }

  async function validateAndAdd(files: File[]) {
    try {
      if (totalItemCount + files.length > constraints.maxImages) {
        throw new Error("حداکثر تعداد تصاویر مجاز برای اقامتگاه تکمیل شده است.");
      }
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error("فرمت فایل پشتیبانی نمی‌شود");
        }
        if (file.size > constraints.maxFileSizeMb * 1024 * 1024) {
          throw new Error("حجم تصویر بیش از حد مجاز است");
        }
        const size = await dimensions(file);
        if (size.width < constraints.minWidth || size.height < constraints.minHeight) {
          throw new Error("ابعاد تصویر مناسب نیست");
        }
      }
      await onAdd(files);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "بارگذاری تصویر انجام نشد.");
    }
  }

  return (
    <section className="grid gap-3" dir="rtl">
      {cropError && <p className="sr-only" role="alert">{cropError}</p>}
      {toast && (
        <div className="fixed left-1/2 top-5 z-[70] w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-black text-[var(--theme-danger)] shadow-2xl" role="alert">
          <div className="flex items-center justify-between gap-3"><span>{toast}</span><button aria-label="بستن پیام" className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-[var(--theme-danger-soft)]" onClick={() => setToast("")} type="button"><CloseIcon /></button></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        <button
          aria-label="افزودن عکس"
          className="group grid w-full place-items-center rounded-2xl border-2 border-dashed border-[var(--theme-border)] bg-[var(--theme-surface-muted)] text-[var(--theme-muted-text)] transition hover:border-[var(--theme-primary)] hover:bg-[var(--theme-primary-soft)] hover:text-[var(--theme-primary-text)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          style={{ aspectRatio }}
          type="button"
        >
          <span className="grid justify-items-center gap-2">
            {uploading ? (
              <span className="grid justify-items-center gap-1"><span className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" /><span className="text-xs">{uploadProgress ?? 0}٪</span></span>
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-3xl leading-none shadow-sm transition group-hover:scale-105">+</span>
            )}
            <span className="text-sm font-black">{uploading ? "در حال بارگذاری…" : "افزودن عکس"}</span>
          </span>
          <input
            ref={inputRef}
            accept={accept}
            className="hidden"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) void validateAndAdd(files);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </button>

        {items.map((item, index) => (
          <article
            className={`relative overflow-hidden rounded-2xl border-2 bg-[var(--theme-surface-muted)] transition ${
              mode === "property" && item.isMain
                ? "border-[var(--theme-primary)] shadow-[0_0_0_3px_var(--theme-primary-soft)]"
                : "border-[var(--theme-border)]"
            }`}
            key={item.id}
            style={{ aspectRatio }}
          >
            <button
              aria-label="نمایش تصویر"
              className="absolute inset-0 z-[1] h-full w-full cursor-zoom-in"
              onClick={() => { setPreviewIndex(index); setPreviewZoom(1); }}
              type="button"
            >
              <GalleryThumbnail item={item} preload={index < 4} />
            </button>

            {mode === "property" && item.isMain && (
              <span className="absolute bottom-2 right-2 z-[2] rounded-full bg-[var(--theme-primary)] px-2.5 py-1 text-[11px] font-black text-white shadow-sm">
                عکس اصلی
              </span>
            )}

            <div className="absolute right-2 top-2 z-[3]">
              <button
                aria-expanded={menuId === item.id}
                aria-label="گزینه‌های تصویر"
                className="grid h-9 w-9 place-items-center rounded-full bg-slate-950/65 text-white shadow-md backdrop-blur-sm transition hover:bg-slate-950/80"
                disabled={busyId === item.id}
                onClick={(event) => { event.stopPropagation(); setMenuId((current) => current === item.id ? null : item.id); }}
                type="button"
              >
                {busyId === item.id ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <DotsIcon />}
              </button>
              {menuId === item.id && (
                <div className="absolute right-0 top-11 min-w-44 overflow-hidden rounded-xl border border-[var(--theme-border)] bg-white py-1 text-right text-sm font-bold text-[var(--theme-text)] shadow-xl" onClick={(event) => event.stopPropagation()}>
                  {mode === "property" && !item.isMain && onSetMain && (
                    <button className="block w-full px-4 py-2.5 text-right hover:bg-[var(--theme-primary-soft)]" onClick={() => { setMenuId(null); void onSetMain(item); }} type="button">انتخاب به‌عنوان عکس اصلی</button>
                  )}
                  <button className="block w-full px-4 py-2.5 text-right hover:bg-[var(--theme-surface-muted)]" onClick={() => { setMenuId(null); setCropError(""); setCropTarget(item); setCropZoom(1); setCropAspect(aspectRatio); setSelectedSaveMode(cropSaveMode); setCrop({ x: 0, y: 0 }); }} type="button">برش تصویر</button>
                  <button className="block w-full px-4 py-2.5 text-right text-[var(--theme-danger)] hover:bg-[var(--theme-danger-soft)]" onClick={() => { setMenuId(null); void onDelete(item); }} type="button">حذف تصویر</button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {preview && (
        <div
          aria-label="پیش‌نمایش تصویر"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-slate-950/90 p-4"
          onClick={() => setPreviewIndex(null)}
          onTouchEnd={(event) => { if (touchStartX.current === null) return; const distance = event.changedTouches[0].clientX - touchStartX.current; if (Math.abs(distance) > 50) movePreview(distance < 0 ? 1 : -1); touchStartX.current = null; }}
          onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }}
          role="dialog"
        >
          <button aria-label="بستن" className="absolute left-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setPreviewIndex(null)} type="button"><CloseIcon /></button>
          {items.length > 1 && <><button aria-label="تصویر قبلی" className="absolute right-3 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white hover:bg-white/20" onClick={(event) => { event.stopPropagation(); movePreview(-1); }} type="button">‹</button><button aria-label="تصویر بعدی" className="absolute left-3 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white hover:bg-white/20" onClick={(event) => { event.stopPropagation(); movePreview(1); }} type="button">›</button></>}
          <div className="h-[82vh] w-[92vw] max-w-6xl select-none transition-transform" onClick={(event) => event.stopPropagation()} style={{ transform: `scale(${previewZoom})` }}><ProgressiveViewerImage item={preview} key={preview.id} /></div>
          <div className="absolute bottom-5 flex items-center gap-2 rounded-full bg-slate-950/70 p-2 text-white backdrop-blur">
            <button aria-label="کوچک‌نمایی" className="h-9 w-9 rounded-full bg-white/10 text-xl" onClick={(event) => { event.stopPropagation(); setPreviewZoom((value) => Math.max(1, value - 0.25)); }} type="button">−</button>
            <span className="min-w-14 text-center text-sm font-bold">{Math.round(previewZoom * 100)}٪</span>
            <button aria-label="بزرگ‌نمایی" className="h-9 w-9 rounded-full bg-white/10 text-xl" onClick={(event) => { event.stopPropagation(); setPreviewZoom((value) => Math.min(3, value + 0.25)); }} type="button">+</button>
          </div>
        </div>
      )}

      {cropTarget && (
        <div aria-label="برش تصویر" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4" role="dialog">
          <div className="w-full max-w-3xl rounded-[var(--modal-radius)] bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-black">برش تصویر</h3><button aria-label="بستن" className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100" onClick={() => setCropTarget(null)} type="button"><CloseIcon /></button></div>
            <div className="relative mt-4 h-[min(55vh,440px)] overflow-hidden rounded-2xl bg-slate-900">
              <Cropper aspect={cropAspect ?? undefined} crop={crop} image={cropTarget.url} onCropChange={setCrop} onCropComplete={(_, pixels) => setCropPixels(pixels)} onZoomChange={setCropZoom} zoom={cropZoom} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <fieldset><legend className="mb-2 text-sm font-black">نسبت برش</legend><div className="flex flex-wrap gap-2"><button className={cropAspect === 1 ? "ds-button-primary" : "ds-button-secondary"} onClick={() => setCropAspect(1)} type="button">۱:۱</button><button className={cropAspect === 4 / 3 ? "ds-button-primary" : "ds-button-secondary"} onClick={() => setCropAspect(4 / 3)} type="button">۴:۳</button>{allowFreeCrop && <button className={cropAspect === null ? "ds-button-primary" : "ds-button-secondary"} onClick={() => setCropAspect(null)} type="button">آزاد</button>}</div></fieldset>
              <fieldset><legend className="mb-2 text-sm font-black">نحوه ذخیره</legend><div className="flex flex-wrap gap-2"><button className={selectedSaveMode === "replace" ? "ds-button-primary" : "ds-button-secondary"} onClick={() => setSelectedSaveMode("replace")} type="button">جایگزینی تصویر</button><button className={selectedSaveMode === "new" ? "ds-button-primary" : "ds-button-secondary"} onClick={() => setSelectedSaveMode("new")} type="button">ذخیره نسخه جدید</button></div></fieldset>
            </div>
            <label className="mt-4 grid gap-2 text-sm font-bold">بزرگ‌نمایی<input max="3" min="1" onChange={(event) => setCropZoom(Number(event.target.value))} step="0.1" type="range" value={cropZoom} /></label>
            <div className="mt-5 flex justify-end gap-3"><button className="ds-button-secondary" disabled={cropping} onClick={() => setCropTarget(null)} type="button">انصراف</button><button className="ds-button-primary disabled:opacity-60" disabled={cropping} onClick={() => void confirmCrop()} type="button">{cropping ? `در حال ذخیره… ${uploadProgress ?? 0}٪` : "ذخیره برش"}</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
