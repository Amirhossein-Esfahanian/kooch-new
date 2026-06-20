"use client";

import Cropper, { Area } from "react-easy-crop";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SharedUploadedFile = Record<string, unknown>;

export interface SharedExistingFile {
  id: string | number;
  url: string;
  name?: string | null;
  alt?: string | null;
}

export interface SharedUploaderLabels {
  title?: string;
  description?: string;
  dropText?: string;
  browseText?: string;
  uploadText?: string;
  uploadingText?: string;
  removeText?: string;
  cropText?: string;
  confirmCropText?: string;
  cancelText?: string;
  successText?: string;
  previewText?: string;
  existingEmptyText?: string;
}

export interface SharedUploaderProps {
  /** Endpoint that receives multipart/form-data. Use /api/backend/... for backend API routes. */
  uploadUrl: string;
  /** Multipart field name for files. Property images use "files"; site settings use "file". */
  fieldName?: string;
  /** Allow selecting and uploading more than one file. */
  multiple?: boolean;
  /** Accepted MIME types, for example ["image/png", "image/jpeg"]. */
  accept?: string[];
  /** Maximum size per file in MB. */
  maxFileSizeMb?: number;
  /** Maximum number of pending files. */
  maxFiles?: number;
  /** Show thumbnails for selected image files. */
  enablePreview?: boolean;
  /** Enable optional client-side crop for images. */
  enableCrop?: boolean;
  /** Crop aspect ratio, for example 16 / 9 for hero images. */
  cropAspectRatio?: number;
  /** Metadata appended to the form. Values are stringified. */
  metadata?: Record<string, string | number | boolean | null | undefined>;
  /** Extra form fields appended to the form. Values are stringified. */
  extraFormFields?: Record<string, string | number | boolean | null | undefined>;
  /** Request headers, usually Authorization. */
  headers?: Record<string, string>;
  /** Called with parsed JSON response after successful upload. */
  onUploadSuccess?: (uploadedFiles: SharedUploadedFile[] | SharedUploadedFile) => void;
  /** Called when validation or upload fails. */
  onUploadError?: (error: string) => void;
  /** Called whenever pending files change. */
  onFilesChange?: (files: File[]) => void;
  /** Existing uploaded files shown above the dropzone. */
  existingFiles?: SharedExistingFile[];
  /** Whether existing files should be shown. */
  showExistingFiles?: boolean;
  /** Show delete button for existing files. */
  allowDeleteExisting?: boolean;
  /** Called when deleting an existing file. */
  onDeleteExisting?: (fileId: string | number) => void;
  /** Persian label overrides. */
  labels?: SharedUploaderLabels;
  /** Disable upload button and file selection. */
  disabled?: boolean;
}

type PendingFile = {
  id: string;
  file: File;
  previewUrl: string | null;
  progress: number;
};

const defaultLabels: Required<SharedUploaderLabels> = {
  title: "بارگذاری فایل",
  description: "فایل را بکشید و رها کنید یا از سیستم انتخاب کنید.",
  dropText: "فایل‌ها را اینجا رها کنید",
  browseText: "انتخاب فایل",
  uploadText: "آپلود",
  uploadingText: "در حال آپلود...",
  removeText: "حذف",
  cropText: "برش تصویر",
  confirmCropText: "تایید برش",
  cancelText: "انصراف",
  successText: "فایل با موفقیت آپلود شد.",
  previewText: "پیش‌نمایش",
  existingEmptyText: "فایلی ثبت نشده است.",
};

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function makePendingFile(file: File, enablePreview: boolean): PendingFile {
  return {
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    previewUrl: enablePreview && file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    progress: 0,
  };
}

async function cropImage(file: File, croppedAreaPixels: Area): Promise<File> {
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
  return new File([blob], file.name, { type: blob.type, lastModified: Date.now() });
}

export function SharedUploader({
  uploadUrl,
  fieldName = "files",
  multiple = true,
  accept = ["image/jpeg", "image/png", "image/webp"],
  maxFileSizeMb = 5,
  maxFiles,
  enablePreview = true,
  enableCrop = false,
  cropAspectRatio = 4 / 3,
  metadata,
  extraFormFields,
  headers,
  onUploadSuccess,
  onUploadError,
  onFilesChange,
  existingFiles = [],
  showExistingFiles = false,
  allowDeleteExisting = false,
  onDeleteExisting,
  labels,
  disabled = false,
}: SharedUploaderProps) {
  const text = { ...defaultLabels, ...(labels ?? {}) };
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cropTarget, setCropTarget] = useState<PendingFile | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const acceptText = useMemo(() => accept.join(","), [accept]);

  useEffect(() => {
    return () => items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
  }, [items]);

  useEffect(() => {
    onFilesChange?.(items.map((item) => item.file));
  }, [items, onFilesChange]);

  const setSafeError = useCallback((value: string) => {
    setError(value);
    onUploadError?.(value);
  }, [onUploadError]);

  const addFiles = useCallback((files: FileList | File[]) => {
    if (disabled) return;
    setError("");
    setMessage("");
    const incoming = Array.from(files);
    const next: PendingFile[] = [];
    for (const file of incoming) {
      if (accept.length && !accept.includes(file.type)) {
        setSafeError("نوع فایل انتخاب‌شده مجاز نیست.");
        continue;
      }
      if (file.size > maxFileSizeMb * 1024 * 1024) {
        setSafeError(`حجم هر فایل باید حداکثر ${maxFileSizeMb} مگابایت باشد.`);
        continue;
      }
      next.push(makePendingFile(file, enablePreview));
    }
    setItems((current) => {
      const combined = multiple ? [...current, ...next] : next.slice(0, 1);
      return typeof maxFiles === "number" ? combined.slice(0, maxFiles) : combined;
    });
  }, [accept, disabled, enablePreview, maxFileSizeMb, maxFiles, multiple, setSafeError]);

  function removeItem(id: string) {
    setItems((current) => {
      const found = current.find((item) => item.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function confirmCrop() {
    if (!cropTarget || !croppedPixels) return;
    try {
      const croppedFile = await cropImage(cropTarget.file, croppedPixels);
      const previewUrl = enablePreview ? URL.createObjectURL(croppedFile) : null;
      setItems((current) =>
        current.map((item) => {
          if (item.id !== cropTarget.id) return item;
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          return { ...item, file: croppedFile, previewUrl };
        }),
      );
      setCropTarget(null);
    } catch (caught) {
      setSafeError(caught instanceof Error ? caught.message : "برش تصویر انجام نشد.");
    }
  }

  function upload() {
    if (!items.length) {
      setSafeError("حداقل یک فایل انتخاب کنید.");
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    items.forEach((item) => formData.append(fieldName, item.file));
    const fields = { ...(metadata ?? {}), ...(extraFormFields ?? {}) };
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== null && value !== undefined) formData.append(key, String(value));
    });

    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    Object.entries(headers ?? {}).forEach(([key, value]) => request.setRequestHeader(key, value));
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setItems((current) => current.map((item) => ({ ...item, progress })));
    };
    request.onload = () => {
      setUploading(false);
      if (request.status >= 200 && request.status < 300) {
        const parsed = request.responseText ? JSON.parse(request.responseText) : {};
        items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
        setItems([]);
        setMessage(text.successText);
        onUploadSuccess?.(parsed);
        return;
      }
      const body = JSON.parse(request.responseText || "{}") as { message?: string };
      setSafeError(body.message ?? "آپلود فایل انجام نشد.");
    };
    request.onerror = () => {
      setUploading(false);
      setSafeError("ارتباط با سرور برای آپلود برقرار نشد.");
    };
    request.send(formData);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" dir="rtl">
      <div>
        <h3 className="text-lg font-black text-slate-950">{text.title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">{text.description}</p>
      </div>

      {showExistingFiles && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-black text-slate-700">{text.previewText}</p>
          {existingFiles.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {existingFiles.map((file) => (
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3" key={file.id}>
                  <img alt={file.alt ?? file.name ?? ""} className="aspect-video w-full rounded-xl object-cover" src={file.url} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-bold text-slate-500">{file.name ?? file.url}</p>
                    {allowDeleteExisting && (
                      <button className="text-xs font-bold text-red-700" onClick={() => onDeleteExisting?.(file.id)} type="button">
                        {text.removeText}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-28 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-400">
              {text.existingEmptyText}
            </div>
          )}
        </div>
      )}

      <div
        className={`mt-4 grid min-h-40 cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
          dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        onClick={() => !disabled && inputRef.current?.click()}
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
          <p className="text-base font-black text-slate-800">{text.dropText}</p>
          <p className="mt-2 text-sm text-slate-500">حداکثر {maxFileSizeMb} مگابایت</p>
          <button className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white" disabled={disabled} type="button">
            {text.browseText}
          </button>
        </div>
        <input
          accept={acceptText}
          className="hidden"
          multiple={multiple}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.currentTarget.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      {items.length > 0 && (
        <div className="mt-5 grid gap-3">
          {items.map((item) => (
            <article className="grid gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-[96px_minmax(0,1fr)_auto]" key={item.id}>
              {item.previewUrl ? (
                <img alt={item.file.name} className="aspect-[4/3] w-24 rounded-xl object-cover" src={item.previewUrl} />
              ) : (
                <div className="grid aspect-[4/3] w-24 place-items-center rounded-xl bg-slate-100 text-xs font-bold text-slate-500">FILE</div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{item.file.name}</p>
                <p className="mt-1 text-xs text-slate-500">{formatSize(item.file.size)}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-blue-600 transition-all" style={{ width: `${item.progress}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {enableCrop && item.previewUrl && (
                  <button className="rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700" onClick={() => setCropTarget(item)} type="button">
                    {text.cropText}
                  </button>
                )}
                <button className="rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-700" onClick={() => removeItem(item.id)} type="button">
                  {text.removeText}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {(error || message) && (
        <p className={`mt-4 rounded-xl p-3 text-sm font-semibold ${error ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
          {error || message}
        </p>
      )}

      <button className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60" disabled={disabled || uploading || !items.length} onClick={upload} type="button">
        {uploading ? text.uploadingText : text.uploadText}
      </button>

      {cropTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black">{text.cropText}</h3>
              <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => setCropTarget(null)} type="button">
                بستن
              </button>
            </div>
            <div className="relative mt-4 h-[420px] overflow-hidden rounded-2xl bg-slate-900">
              <Cropper aspect={cropAspectRatio} crop={crop} image={cropTarget.previewUrl ?? ""} onCropChange={setCrop} onCropComplete={(_, pixels) => setCroppedPixels(pixels)} onZoomChange={setZoom} zoom={zoom} />
            </div>
            <label className="mt-4 grid gap-1 text-sm font-bold">
              بزرگ‌نمایی
              <input max="3" min="1" onChange={(event) => setZoom(Number(event.target.value))} step="0.1" type="range" value={zoom} />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button className="rounded-xl border border-slate-300 px-4 py-2 font-bold" onClick={() => setCropTarget(null)} type="button">
                {text.cancelText}
              </button>
              <button className="rounded-xl bg-blue-600 px-4 py-2 font-black text-white" onClick={confirmCrop} type="button">
                {text.confirmCropText}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
