"use client";

import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import NextImage from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";

export type SharedUploadedFile = Record<string, unknown>;

export interface SharedExistingFile {
  id: string | number;
  url: string;
  name?: string | null;
  alt?: string | null;
}

export interface SharedCropAspectOption {
  label: string;
  value: number | null;
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
  previewImageText?: string;
  imageActionsText?: string;
  replaceText?: string;
  existingEmptyText?: string;
  addPhotoText?: string;
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
  /** Optional domain-neutral validation after MIME and file-size checks. */
  validateFile?: (
    file: File,
  ) => string | null | undefined | Promise<string | null | undefined>;
  /** Upload accepted files immediately. Cropped images wait for crop confirmation. */
  autoUpload?: boolean;
  /** Show thumbnails for selected image files. */
  enablePreview?: boolean;
  /** Enable optional client-side crop for images. */
  enableCrop?: boolean;
  /** Crop aspect ratio, for example 16 / 9 for hero images. */
  cropAspectRatio?: number;
  /** Optional crop aspect choices. Use null for free crop. Existing consumers remain fixed-ratio when omitted. */
  cropAspectOptions?: SharedCropAspectOption[];
  /** Metadata appended to the form. Values are stringified. */
  metadata?: Record<string, string | number | boolean | null | undefined>;
  /** Extra form fields appended to the form. Values are stringified. */
  extraFormFields?: Record<
    string,
    string | number | boolean | null | undefined
  >;
  /** Request headers, usually Authorization. */
  headers?: Record<string, string>;
  /** Called with parsed JSON response after successful upload. */
  onUploadSuccess?: (
    uploadedFiles: SharedUploadedFile[] | SharedUploadedFile,
  ) => void;
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
  onDeleteExisting?: (fileId: string | number) => void | Promise<void>;
  /** Persian label overrides. */
  labels?: SharedUploaderLabels;
  /** Disable upload button and file selection. */
  disabled?: boolean;
  /** Visual style. "square" matches the media gallery add-photo tile. */
  variant?: "dropzone" | "square";
  /** Aspect ratio for the square/media-gallery style tile. */
  aspectRatio?: string;
  /** Use Sonner toast for success/error feedback. */
  useToastNotifications?: boolean;
  /** Hide file names/URLs below previews. */
  hideFileDetails?: boolean;
  /** Hide inline status message, useful when using toast notifications. */
  hideInlineStatus?: boolean;
  /** Remove outer card/header chrome when embedding the uploader inside another gallery. */
  embedded?: boolean;
}

type PendingFile = {
  id: string;
  file: File;
  previewUrl: string | null;
  progress: number;
};

type CropTarget =
  | { kind: "pending"; item: PendingFile }
  | { kind: "existing"; file: SharedExistingFile };

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
  previewImageText: "مشاهده",
  imageActionsText: "گزینه‌های تصویر",
  replaceText: "جایگزینی",
  existingEmptyText: "فایلی ثبت نشده است.",
  addPhotoText: "Add photo",
};

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

let pendingFileSequence = 0;

function createPendingFileId(file: File) {
  const uniquePart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${++pendingFileSequence}`;

  return `${file.name}-${file.lastModified}-${uniquePart}`;
}

function makePendingFile(file: File, enablePreview: boolean): PendingFile {
  return {
    id: createPendingFileId(file),
    file,
    previewUrl:
      enablePreview && file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null,
    progress: 0,
  };
}

function isCroppableRasterImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

const uploaderIcons = {
  crop: "/svgs/crop-alt.svg",
  preview: "/svgs/eye-2.svg",
  replace: "/svgs/repeat-3.svg",
  menu: "/svgs/ellipsis-v.svg",
  remove: "/svgs/image-circle-xmark.svg",
} as const;

function UploaderIcon({
  src,
  className = "size-5",
}: {
  src: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${className} block shrink-0 bg-current`}
      style={{
        WebkitMaskImage: `url("${src}")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskImage: `url("${src}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
      }}
    />
  );
}

type SharedViewerItem = {
  id: string;
  url: string;
  alt: string;
  title: string;
};

function ProgressiveViewerImage({ item }: { item: SharedViewerItem }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const isObjectUrl =
    item.url.startsWith("blob:") || item.url.startsWith("data:");

  if (isObjectUrl) {
    return (
      <img
        alt={item.alt}
        className="h-full w-full object-contain"
        src={item.url}
      />
    );
  }

  return (
    <div className="relative h-full w-full">
      <NextImage
        alt=""
        className="object-contain blur-sm"
        fill
        priority
        quality={35}
        sizes="92vw"
        src={item.url}
        unoptimized={shouldBypassImageOptimization(item.url)}
      />
      <NextImage
        alt={item.alt}
        className={`object-contain transition-opacity duration-500 motion-reduce:transition-none ${
          fullLoaded ? "opacity-100" : "opacity-0"
        }`}
        fill
        onLoad={() => setFullLoaded(true)}
        priority
        quality={85}
        sizes="92vw"
        src={item.url}
        unoptimized={shouldBypassImageOptimization(item.url)}
      />
    </div>
  );
}

async function cropImageSource(
  src: string,
  croppedAreaPixels: Area,
  fileName: string,
  outputType: string,
): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("بارگذاری تصویر برای برش ممکن نشد."));
    img.src = src;
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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, 0.92),
  );
  if (!blob) throw new Error("برش تصویر انجام نشد.");

  return new File([blob], fileName, {
    type: blob.type || outputType,
    lastModified: Date.now(),
  });
}

async function cropImage(file: File, croppedAreaPixels: Area): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    return await cropImageSource(
      sourceUrl,
      croppedAreaPixels,
      file.name,
      file.type || "image/jpeg",
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function cropExistingImage(
  file: SharedExistingFile,
  croppedAreaPixels: Area,
): Promise<File> {
  return cropImageSource(
    file.url,
    croppedAreaPixels,
    `cropped-${String(file.id)}.webp`,
    "image/webp",
  );
}

export function SharedUploader({
  uploadUrl,
  fieldName = "files",
  multiple = true,
  accept = ["image/jpeg", "image/png", "image/webp"],
  maxFileSizeMb = 5,
  maxFiles,
  validateFile,
  autoUpload = false,
  enablePreview = true,
  enableCrop = false,
  cropAspectRatio = 4 / 3,
  cropAspectOptions = [],
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
  variant = "dropzone",
  aspectRatio = "1 / 1",
  useToastNotifications = false,
  hideFileDetails = false,
  hideInlineStatus = false,
  embedded = false,
}: SharedUploaderProps) {
  const text = { ...defaultLabels, ...(labels ?? {}) };
  const inputRef = useRef<HTMLInputElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadingRef = useRef(false);
  const validatingRef = useRef(false);
  const mountedRef = useRef(true);
  const [validating, setValidating] = useState(false);
  const deletingRef = useRef(false);
  const croppingRef = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | number | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [items, setItems] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [cropAspect, setCropAspect] = useState<number | null>(cropAspectRatio);
  const [cropping, setCropping] = useState(false);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const acceptText = useMemo(() => accept.join(","), [accept]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () =>
      items.forEach(
        (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl),
      );
  }, [items]);

  useEffect(() => {
    onFilesChange?.(items.map((item) => item.file));
  }, [items, onFilesChange]);

  useEffect(() => {
    if (!actionMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!actionMenuRef.current?.contains(target)) setActionMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActionMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionMenuOpen]);

  const setSafeError = useCallback(
    (value: string) => {
      setError(value);
      if (useToastNotifications) toast.error(value);
      onUploadError?.(value);
    },
    [onUploadError, useToastNotifications],
  );

  function openFilePicker() {
    if (
      disabled ||
      uploadingRef.current ||
      validatingRef.current ||
      deletingRef.current ||
      croppingRef.current
    )
      return;
    setActionMenuOpen(false);
    setPreviewIndex(null);
    inputRef.current?.click();
  }

  function openPreview(index = 0) {
    setActionMenuOpen(false);
    setPreviewZoom(1);
    setPreviewIndex(index);
  }

  function openCrop(target: CropTarget) {
    if (validatingRef.current) return;
    if (disabled || !enableCrop) return;
    if (
      target.kind === "pending" &&
      !isCroppableRasterImage(target.item.file)
    ) {
      return;
    }

    setActionMenuOpen(false);
    setPreviewIndex(null);
    setCroppedPixels(null);
    setCrop({ x: 0, y: 0 });
    setCropZoom(1);
    setCropAspect(cropAspectRatio);
    setCropTarget(target);
  }

  async function addFiles(files: FileList | File[]) {
    if (
      disabled ||
      uploadingRef.current ||
      deletingRef.current ||
      validatingRef.current
    )
      return;
    validatingRef.current = true;
    setValidating(true);
    setError("");
    const incoming = Array.from(files);
    const accepted: File[] = [];
    try {
      for (const file of incoming) {
        if (accept.length && !accept.includes(file.type)) {
          setSafeError("فرمت تصویر پشتیبانی نمی‌شود");
          continue;
        }
        if (file.size > maxFileSizeMb * 1024 * 1024) {
          setSafeError("حجم تصویر بیش از حد مجاز است");
          continue;
        }
        if (validateFile) {
          let validationError: string | null | undefined;
          try {
            validationError = await validateFile(file);
          } catch (caught) {
            validationError =
              caught instanceof Error
                ? caught.message
                : "اعتبارسنجی فایل انجام نشد.";
          }
          if (!mountedRef.current) return;
          if (typeof validationError === "string") {
            setSafeError(validationError);
            continue;
          }
        }
        accepted.push(file);
      }

      if (accepted.length === 0) return;
      if (
        typeof maxFiles === "number" &&
        (multiple ? items.length : 0) + accepted.length > maxFiles
      ) {
        setSafeError("تعداد فایل‌های انتخاب‌شده بیش از ظرفیت مجاز است.");
        return;
      }
      const selected = multiple ? accepted : accepted.slice(0, 1);
      const next = selected.map((file) => makePendingFile(file, enablePreview));
      const acceptedItems = multiple ? [...items, ...next] : next;
      setUploadFailed(false);
      setMessage("");
      setItems(acceptedItems);
      if (!autoUpload) return;

      const cropCandidate = acceptedItems[0];
      if (
        enableCrop &&
        cropCandidate.previewUrl &&
        isCroppableRasterImage(cropCandidate.file)
      ) {
        setCroppedPixels(null);
        setCrop({ x: 0, y: 0 });
        setCropZoom(1);
        setCropAspect(cropAspectRatio);
        setCropTarget({ kind: "pending", item: cropCandidate });
        return;
      }

      validatingRef.current = false;
      upload(acceptedItems);
    } finally {
      validatingRef.current = false;
      if (mountedRef.current) setValidating(false);
    }
  }

  function removeItem(id: string) {
    if (validatingRef.current) return;
    setActionMenuOpen(false);
    setPreviewIndex(null);
    setItems((current) => {
      const found = current.find((item) => item.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function confirmCrop() {
    if (
      !cropTarget ||
      !croppedPixels ||
      croppingRef.current ||
      validatingRef.current ||
      uploadingRef.current
    )
      return;

    croppingRef.current = true;
    setCropping(true);
    try {
      if (cropTarget.kind === "pending") {
        const croppedFile = await cropImage(
          cropTarget.item.file,
          croppedPixels,
        );
        const previewUrl = enablePreview
          ? URL.createObjectURL(croppedFile)
          : null;
        const croppedItem = {
          ...cropTarget.item,
          file: croppedFile,
          previewUrl,
        };
        const updatedItems = items.map((item) => {
          if (item.id !== cropTarget.item.id) return item;
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          return croppedItem;
        });
        setItems(updatedItems);
        setCropTarget(null);
        if (autoUpload) upload(updatedItems);
        return;
      }

      const croppedFile = await cropExistingImage(
        cropTarget.file,
        croppedPixels,
      );
      const croppedItem = makePendingFile(croppedFile, enablePreview);
      const updatedItems = multiple ? [...items, croppedItem] : [croppedItem];
      setItems(updatedItems);
      setCropTarget(null);
      if (autoUpload) upload(updatedItems);
    } catch (caught) {
      setSafeError(
        caught instanceof Error ? caught.message : "برش تصویر انجام نشد.",
      );
    } finally {
      croppingRef.current = false;
      setCropping(false);
    }
  }

  function upload(uploadItems: PendingFile[] = items) {
    if (!uploadItems.length) {
      setSafeError("حداقل یک فایل انتخاب کنید.");
      return;
    }
    if (uploadingRef.current || deletingRef.current || validatingRef.current)
      return;

    uploadingRef.current = true;
    setUploading(true);
    setUploadFailed(false);
    setError("");
    setMessage("");

    const formData = new FormData();
    uploadItems.forEach((item) => formData.append(fieldName, item.file));
    const fields = { ...(metadata ?? {}), ...(extraFormFields ?? {}) };
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== null && value !== undefined)
        formData.append(key, String(value));
    });

    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    Object.entries(headers ?? {}).forEach(([key, value]) =>
      request.setRequestHeader(key, value),
    );
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setItems((current) => current.map((item) => ({ ...item, progress })));
    };
    request.onload = () => {
      uploadingRef.current = false;
      setUploading(false);
      if (request.status >= 200 && request.status < 300) {
        const parsed = request.responseText
          ? JSON.parse(request.responseText)
          : {};
        uploadItems.forEach(
          (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl),
        );
        setActionMenuOpen(false);
        setPreviewIndex(null);
        setItems([]);
        setMessage(text.successText);
        if (useToastNotifications) toast.success(text.successText);
        onUploadSuccess?.(parsed);
        return;
      }
      setUploadFailed(true);
      const body = JSON.parse(request.responseText || "{}") as {
        message?: string;
      };
      setSafeError(body.message ?? "آپلود فایل انجام نشد.");
    };
    request.onerror = () => {
      uploadingRef.current = false;
      setUploading(false);
      setUploadFailed(true);
      setSafeError("ارتباط با سرور برای آپلود برقرار نشد.");
    };
    request.send(formData);
  }

  const viewerItems = useMemo<SharedViewerItem[]>(() => {
    const existing = showExistingFiles
      ? existingFiles.map((file) => ({
          id: `existing-${file.id}`,
          url: file.url,
          alt: file.alt ?? file.name ?? text.previewText,
          title: file.name ?? text.previewText,
        }))
      : [];
    const pending = items
      .filter((item) => Boolean(item.previewUrl))
      .map((item) => ({
        id: `pending-${item.id}`,
        url: item.previewUrl!,
        alt: item.file.name,
        title: item.file.name,
      }));

    if (variant === "square" && !multiple) {
      return pending.length ? [pending[0]] : existing.slice(0, 1);
    }

    return [...existing, ...pending];
  }, [
    existingFiles,
    items,
    multiple,
    showExistingFiles,
    text.previewText,
    variant,
  ]);

  const preview =
    previewIndex === null ? null : (viewerItems[previewIndex] ?? null);

  useEffect(() => {
    if (previewIndex === null) return;
    if (viewerItems.length === 0) {
      setPreviewIndex(null);
      return;
    }
    if (previewIndex >= viewerItems.length) {
      setPreviewIndex(viewerItems.length - 1);
    }
  }, [previewIndex, viewerItems.length]);

  useEffect(() => {
    if (previewIndex === null || viewerItems.length < 2) return;

    function handlePreviewKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPreviewIndex((current) =>
          current === null ? null : (current + 1) % viewerItems.length,
        );
        setPreviewZoom(1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPreviewIndex((current) =>
          current === null
            ? null
            : (current - 1 + viewerItems.length) % viewerItems.length,
        );
        setPreviewZoom(1);
      }
    }

    document.addEventListener("keydown", handlePreviewKeyDown);
    return () => document.removeEventListener("keydown", handlePreviewKeyDown);
  }, [previewIndex, viewerItems.length]);

  function movePreview(direction: -1 | 1) {
    if (viewerItems.length < 2) return;
    setPreviewIndex((current) =>
      current === null
        ? null
        : (current + direction + viewerItems.length) % viewerItems.length,
    );
    setPreviewZoom(1);
  }

  function previewIndexForUrl(url: string | null) {
    if (!url) return 0;
    const index = viewerItems.findIndex((item) => item.url === url);
    return index >= 0 ? index : 0;
  }

  const firstExistingPreview =
    showExistingFiles && existingFiles.length ? existingFiles[0] : null;
  const pendingSquarePreview = items[0]?.previewUrl ? items[0] : null;
  const squarePreview =
    pendingSquarePreview?.previewUrl ?? firstExistingPreview?.url ?? null;
  const squarePreviewAlt = pendingSquarePreview
    ? pendingSquarePreview.file.name
    : (firstExistingPreview?.alt ??
      firstExistingPreview?.name ??
      text.previewText);
  const canCropSquarePreview = Boolean(
    !disabled &&
    enableCrop &&
    (pendingSquarePreview
      ? isCroppableRasterImage(pendingSquarePreview.file)
      : firstExistingPreview),
  );

  return (
    <section
      className={
        embedded
          ? "min-w-0"
          : "rounded-2xl border border-border bg-card p-4 shadow-sm"
      }
      dir="rtl"
    >
      {!embedded && (
        <div>
          <h3 className="text-lg font-bold text-foreground">{text.title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {text.description}
          </p>
        </div>
      )}

      {variant === "dropzone" && showExistingFiles && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-bold text-foreground">
            {text.previewText}
          </p>
          {existingFiles.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {existingFiles.map((file) => (
                <article
                  className="rounded-2xl border border-border bg-muted p-3"
                  key={file.id}
                >
                  <button
                    aria-label={text.previewImageText}
                    className="block w-full cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => openPreview(previewIndexForUrl(file.url))}
                    type="button"
                  >
                    <img
                      alt={file.alt ?? file.name ?? ""}
                      className="aspect-video w-full object-cover transition duration-300 hover:scale-[1.03] motion-reduce:duration-100 motion-reduce:hover:scale-100"
                      src={file.url}
                    />
                  </button>
                  <div
                    className={`mt-2 flex items-center justify-between gap-2 ${hideFileDetails && !allowDeleteExisting ? "sr-only" : ""}`}
                  >
                    {!hideFileDetails && (
                      <p className="truncate text-xs font-bold text-muted-foreground">
                        {file.name ?? file.url}
                      </p>
                    )}
                    {allowDeleteExisting && (
                      <button
                        className="text-xs font-bold text-destructive"
                        disabled={
                          disabled || uploading || deleting || !onDeleteExisting
                        }
                        onClick={() => setDeleteTarget(file.id)}
                        type="button"
                      >
                        {text.removeText}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-28 place-items-center rounded-2xl border border-dashed border-border bg-muted text-sm font-bold text-muted-foreground">
              {text.existingEmptyText}
            </div>
          )}
        </div>
      )}

      {variant === "square" && (
        <div
          className={embedded ? "grid gap-3" : "mt-4 grid gap-3 sm:max-w-64"}
        >
          <div
            className={`group relative grid w-full place-items-center text-center transition ${
              squarePreview
                ? "rounded-2xl bg-muted"
                : dragging
                  ? "rounded-2xl border-2 border-dashed border-primary bg-[var(--theme-primary-soft)]"
                  : "rounded-2xl border-2 border-dashed border-border bg-muted hover:border-[var(--theme-primary-border)] hover:bg-[var(--theme-primary-soft)]"
            } ${disabled && !squarePreview ? "opacity-60" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!disabled) setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
            style={{ aspectRatio }}
          >
            {squarePreview ? (
              <>
                <button
                  aria-label={text.previewImageText}
                  className="absolute inset-0 cursor-zoom-in overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => openPreview(previewIndexForUrl(squarePreview))}
                  title={text.previewImageText}
                  type="button"
                >
                  <img
                    alt={squarePreviewAlt}
                    className="h-full w-full object-cover transition duration-200 ease-out hover:scale-[1.015] hover:brightness-95 motion-reduce:transition-none motion-reduce:hover:scale-100"
                    src={squarePreview}
                  />
                </button>

                <div className="absolute end-2 top-2 z-[4]" ref={actionMenuRef}>
                  <button
                    aria-expanded={actionMenuOpen}
                    aria-haspopup="menu"
                    aria-label={text.imageActionsText}
                    className="grid size-[29px] place-items-center rounded-full bg-white text-foreground shadow-md transition duration-150 ease-out hover:scale-110 hover:shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
                    onClick={() => setActionMenuOpen((open) => !open)}
                    title={text.imageActionsText}
                    type="button"
                  >
                    <img
                      alt=""
                      aria-hidden="true"
                      className="size-[18px]"
                      src={uploaderIcons.menu}
                    />
                  </button>

                  {actionMenuOpen && (
                    <div
                      className="absolute end-0 mt-1 min-w-48 rounded-xl border border-border bg-card p-1 text-start shadow-lg"
                      role="menu"
                    >
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-bold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          openPreview(previewIndexForUrl(squarePreview))
                        }
                        role="menuitem"
                        type="button"
                      >
                        <UploaderIcon
                          className="size-4"
                          src={uploaderIcons.preview}
                        />
                        {text.previewImageText}
                      </button>

                      {!disabled && (
                        <button
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-bold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={openFilePicker}
                          role="menuitem"
                          type="button"
                        >
                          <UploaderIcon
                            className="size-4"
                            src={uploaderIcons.replace}
                          />
                          {text.replaceText}
                        </button>
                      )}

                      <button
                        aria-disabled={!canCropSquarePreview}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-bold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                        disabled={!canCropSquarePreview}
                        onClick={() => {
                          if (pendingSquarePreview) {
                            openCrop({
                              kind: "pending",
                              item: pendingSquarePreview,
                            });
                            return;
                          }
                          if (firstExistingPreview) {
                            openCrop({
                              kind: "existing",
                              file: firstExistingPreview,
                            });
                          }
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <UploaderIcon
                          className="size-4"
                          src={uploaderIcons.crop}
                        />
                        {text.cropText}
                      </button>

                      <button
                        aria-disabled={
                          disabled ||
                          uploading ||
                          deleting ||
                          (!pendingSquarePreview &&
                            !(
                              firstExistingPreview &&
                              allowDeleteExisting &&
                              onDeleteExisting
                            ))
                        }
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-bold text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                        disabled={
                          disabled ||
                          uploading ||
                          deleting ||
                          (!pendingSquarePreview &&
                            !(
                              firstExistingPreview &&
                              allowDeleteExisting &&
                              onDeleteExisting
                            ))
                        }
                        onClick={() => {
                          setActionMenuOpen(false);
                          if (pendingSquarePreview) {
                            removeItem(pendingSquarePreview.id);
                            return;
                          }
                          if (
                            firstExistingPreview &&
                            allowDeleteExisting &&
                            onDeleteExisting
                          ) {
                            setDeleteTarget(firstExistingPreview.id);
                          }
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <UploaderIcon
                          className="size-4"
                          src={uploaderIcons.remove}
                        />
                        {text.removeText}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <button
                aria-label={text.browseText}
                className={`absolute inset-0 grid place-items-center rounded-2xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  disabled ? "cursor-not-allowed" : "cursor-pointer"
                }`}
                disabled={disabled}
                onClick={openFilePicker}
                title={text.browseText}
                type="button"
              >
                <span className="grid justify-items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="text-4xl font-light leading-none text-primary transition-transform duration-150 group-hover:scale-110 motion-reduce:group-hover:scale-100"
                  >
                    +
                  </span>
                  <span className="text-sm font-bold text-primary">
                    {text.addPhotoText}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    حداکثر {maxFileSizeMb} مگابایت
                  </span>
                </span>
              </button>
            )}

            {embedded && (validating || uploading) && (
              <div
                aria-live="polite"
                className="absolute inset-0 z-[5] grid place-items-center rounded-2xl bg-card/80 text-foreground backdrop-blur-sm"
              >
                <span className="grid justify-items-center gap-2 text-sm font-bold">
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span>
                    {validating
                      ? "در حال بررسی…"
                      : `${text.uploadingText} ${items[0]?.progress ?? 0}٪`}
                  </span>
                </span>
              </div>
            )}

            <input
              accept={acceptText}
              className="hidden"
              disabled={disabled}
              multiple={multiple}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
              ref={inputRef}
              type="file"
            />
          </div>
        </div>
      )}

      {variant === "dropzone" && (
        <div
          className={`mt-4 grid min-h-40 cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
            dragging
              ? "border-primary bg-[var(--theme-primary-soft)]"
              : "border-border bg-muted hover:border-[var(--theme-primary-border)] hover:bg-[var(--theme-primary-soft)]"
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
            <p className="text-base font-bold text-foreground">
              {text.dropText}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              حداکثر {maxFileSizeMb} مگابایت
            </p>
            <button
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"
              disabled={disabled}
              type="button"
            >
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
      )}

      {items.length > 0 && variant === "dropzone" && (
        <div className="mt-5 grid gap-3">
          {items.map((item) => (
            <article
              className="grid gap-3 rounded-2xl border border-border p-3 sm:grid-cols-[96px_minmax(0,1fr)_auto]"
              key={item.id}
            >
              {item.previewUrl ? (
                <button
                  aria-label={`${text.previewImageText}: ${item.file.name}`}
                  className="cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() =>
                    openPreview(previewIndexForUrl(item.previewUrl))
                  }
                  type="button"
                >
                  <img
                    alt={item.file.name}
                    className="aspect-[4/3] w-24 object-cover transition duration-300 hover:scale-[1.03] motion-reduce:duration-100 motion-reduce:hover:scale-100"
                    src={item.previewUrl}
                  />
                </button>
              ) : (
                <div className="grid aspect-[4/3] w-24 place-items-center rounded-xl bg-muted text-xs font-bold text-muted-foreground">
                  FILE
                </div>
              )}
              <div className="min-w-0">
                {!hideFileDetails && (
                  <p className="truncate text-sm font-bold">{item.file.name}</p>
                )}
                <p
                  className={`${hideFileDetails ? "" : "mt-1"} text-xs text-muted-foreground`}
                >
                  {formatSize(item.file.size)}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {enableCrop &&
                  !disabled &&
                  item.previewUrl &&
                  isCroppableRasterImage(item.file) && (
                    <button
                      className="rounded-xl border border-[var(--theme-primary-border)] px-3 py-2 text-sm font-bold text-[var(--theme-primary-text)]"
                      onClick={() => openCrop({ kind: "pending", item })}
                      type="button"
                    >
                      {text.cropText}
                    </button>
                  )}
                <button
                  className="rounded-xl border border-destructive/30 px-3 py-2 text-sm font-bold text-destructive"
                  onClick={() => removeItem(item.id)}
                  type="button"
                >
                  {text.removeText}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {!hideInlineStatus && (error || message) && (
        <p
          className={`mt-4 rounded-xl p-3 text-sm font-semibold ${error ? "bg-[var(--destructive-soft)] text-destructive" : "bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]"}`}
        >
          {error || message}
        </p>
      )}

      {(!autoUpload || uploading || (uploadFailed && items.length > 0)) && (
        <button
          className="mt-5 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-60"
          disabled={disabled || uploading || validating || !items.length}
          onClick={() => upload()}
          type="button"
        >
          {uploading ? text.uploadingText : text.uploadText}
        </button>
      )}

      <KoochConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingRef.current) setDeleteTarget(null);
        }}
        title="حذف تصویر"
        description="آیا از حذف تصویر فعلی مطمئن هستید؟"
        cancelText="انصراف"
        confirmText="حذف تصویر"
        variant="destructive"
        loading={deleting}
        onConfirm={async () => {
          if (deleteTarget === null || !onDeleteExisting || deletingRef.current)
            return;
          deletingRef.current = true;
          setDeleting(true);
          try {
            await onDeleteExisting(deleteTarget);
            setDeleteTarget(null);
          } catch (failure) {
            const message =
              failure instanceof Error
                ? failure.message
                : "حذف تصویر انجام نشد.";
            setError(message);
            if (useToastNotifications) toast.error(message);
          } finally {
            deletingRef.current = false;
            setDeleting(false);
          }
        }}
      />

      {preview && (
        <KoochDialog
          bodyClassName="relative overflow-hidden bg-slate-950 p-0"
          contentClassName="h-[min(840px,94vh)] w-[calc(100vw-1rem)]"
          onOpenChange={(open) => {
            if (!open) setPreviewIndex(null);
          }}
          open
          size="xl"
          title={
            viewerItems.length > 1
              ? `${text.previewText} ${previewIndex! + 1} از ${viewerItems.length}`
              : preview.title
          }
        >
          <div
            className="relative h-full min-h-[55vh] w-full overflow-hidden"
            onTouchEnd={(event) => {
              if (touchStartX.current === null) return;
              const distance =
                event.changedTouches[0].clientX - touchStartX.current;
              if (Math.abs(distance) > 50) movePreview(distance < 0 ? 1 : -1);
              touchStartX.current = null;
            }}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0].clientX;
            }}
          >
            {viewerItems.length > 1 && (
              <>
                <button
                  aria-label="تصویر قبلی"
                  className="touch-target-44 absolute right-3 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
                  onClick={(event) => {
                    event.stopPropagation();
                    movePreview(-1);
                  }}
                  type="button"
                >
                  ‹
                </button>
                <button
                  aria-label="تصویر بعدی"
                  className="touch-target-44 absolute left-3 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
                  onClick={(event) => {
                    event.stopPropagation();
                    movePreview(1);
                  }}
                  type="button"
                >
                  ›
                </button>
              </>
            )}

            <div
              className="absolute inset-4 select-none transition-transform motion-reduce:transition-none sm:inset-8"
              style={{ transform: `scale(${previewZoom})` }}
            >
              <ProgressiveViewerImage item={preview} key={preview.id} />
            </div>

            <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950/70 p-2 text-white backdrop-blur">
              <button
                aria-label="کوچک‌نمایی"
                className="touch-target-44 h-9 w-9 rounded-full bg-white/10 text-xl transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
                disabled={previewZoom <= 1}
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewZoom((value) => Math.max(1, value - 0.25));
                }}
                type="button"
              >
                −
              </button>
              <span
                aria-live="polite"
                className="min-w-14 text-center text-sm font-bold"
              >
                {Math.round(previewZoom * 100)}٪
              </span>
              <button
                aria-label="بزرگ‌نمایی"
                className="touch-target-44 h-9 w-9 rounded-full bg-white/10 text-xl transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
                disabled={previewZoom >= 3}
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewZoom((value) => Math.min(3, value + 0.25));
                }}
                type="button"
              >
                +
              </button>
            </div>
          </div>
        </KoochDialog>
      )}

      <KoochDialog
        closeDisabled={cropping}
        footer={
          <>
            <KoochButton
              disabled={cropping}
              onClick={() => setCropTarget(null)}
              variant="outline"
            >
              {text.cancelText}
            </KoochButton>
            <KoochButton
              loading={cropping}
              onClick={() => void confirmCrop()}
              variant="primary"
            >
              {text.confirmCropText}
            </KoochButton>
          </>
        }
        onOpenChange={(open) => {
          if (!open && !croppingRef.current) setCropTarget(null);
        }}
        open={Boolean(cropTarget)}
        size="lg"
        title={text.cropText}
      >
        <div className="relative h-[min(55vh,440px)] overflow-hidden rounded-2xl bg-slate-900">
          <Cropper
            aspect={cropAspect ?? undefined}
            crop={crop}
            image={
              cropTarget?.kind === "pending"
                ? (cropTarget.item.previewUrl ?? "")
                : (cropTarget?.file.url ?? "")
            }
            onCropChange={setCrop}
            onCropComplete={(_, pixels) => setCroppedPixels(pixels)}
            onZoomChange={setCropZoom}
            zoom={cropZoom}
          />
        </div>

        {cropAspectOptions.length > 0 && (
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-bold text-foreground">
              نسبت برش
            </legend>
            <div className="flex flex-wrap gap-2">
              {cropAspectOptions.map((option) => (
                <KoochButton
                  aria-pressed={cropAspect === option.value}
                  disabled={cropping}
                  key={`${option.label}-${String(option.value)}`}
                  onClick={() => setCropAspect(option.value)}
                  size="sm"
                  variant={cropAspect === option.value ? "primary" : "outline"}
                >
                  {option.label}
                </KoochButton>
              ))}
            </div>
          </fieldset>
        )}

        <label className="mt-4 grid gap-2 text-sm font-bold text-foreground">
          بزرگ‌نمایی
          <input
            aria-label="بزرگ‌نمایی برش"
            disabled={cropping}
            max="3"
            min="1"
            onChange={(event) => setCropZoom(Number(event.target.value))}
            step="0.1"
            type="range"
            value={cropZoom}
          />
        </label>
      </KoochDialog>
    </section>
  );
}
