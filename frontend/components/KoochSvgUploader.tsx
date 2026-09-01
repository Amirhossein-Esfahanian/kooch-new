"use client";

import { ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/owner-api";
import { KoochButton } from "@/components/KoochButton";

const MAX_SVG_BYTES = 256 * 1024;

type SvgStageResponse = {
  uploadToken: string;
  assetNamespace: string;
  expiresAtUtc: string;
};

type KoochSvgUploaderProps = {
  disabled?: boolean;
  helperText?: string;
  onRemove: () => void;
  onRestore?: () => void;
  onStaged: (uploadToken: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  pendingUploadToken?: string | null;
  persistedValue?: string | null;
  removePending?: boolean;
  stagePath: string;
};

function validateSvgFile(file: File) {
  if (!file.name.toLocaleLowerCase().endsWith(".svg")) {
    return "فقط فایل با پسوند SVG قابل بارگذاری است.";
  }

  if (file.type && file.type !== "image/svg+xml") {
    return "نوع فایل انتخاب‌شده SVG نیست.";
  }

  if (file.size === 0) {
    return "فایل SVG خالی است.";
  }

  if (file.size > MAX_SVG_BYTES) {
    return "حجم فایل SVG باید حداکثر ۲۵۶ کیلوبایت باشد.";
  }

  return null;
}

export function KoochSvgUploader({
  disabled = false,
  helperText,
  onRemove,
  onRestore,
  onStaged,
  onUploadingChange,
  pendingUploadToken,
  persistedValue,
  removePending = false,
  stagePath,
}: KoochSvgUploaderProps) {
  const inputId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }

  useEffect(() => {
    if (!pendingUploadToken) clearPreview();
  }, [pendingUploadToken]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      onUploadingChange?.(false);
    };
  }, [onUploadingChange]);

  async function stageFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const validationError = validateSvgFile(file);
    if (validationError) {
      setError(validationError);
      toast.error(validationError);
      return;
    }

    const requestId = ++requestIdRef.current;
    const formData = new FormData();
    formData.append("file", file);

    setError(null);
    setUploading(true);
    onUploadingChange?.(true);

    try {
      const response = await apiRequest<SvgStageResponse>(stagePath, {
        method: "POST",
        body: formData,
      });

      if (!mountedRef.current || requestId !== requestIdRef.current) return;

      clearPreview();
      const nextPreviewUrl = URL.createObjectURL(file);
      previewUrlRef.current = nextPreviewUrl;
      setPreviewUrl(nextPreviewUrl);
      onStaged(response.uploadToken);
      toast.success("آیکن SVG برای ذخیره آماده شد.");
    } catch (caught) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;

      const message =
        caught instanceof Error ? caught.message : "آماده‌سازی SVG انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setUploading(false);
        onUploadingChange?.(false);
      }
    }
  }

  function removeIcon() {
    requestIdRef.current += 1;
    clearPreview();
    setError(null);
    setUploading(false);
    onUploadingChange?.(false);
    onRemove();
  }

  const visibleValue = removePending ? null : previewUrl ?? persistedValue;
  const hasPendingReplacement = Boolean(previewUrl && pendingUploadToken);

  return (
    <div
      aria-busy={uploading}
      aria-describedby={statusId}
      className="grid gap-3 rounded-xl border border-border bg-background p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-lg border border-border bg-card">
          {visibleValue ? (
            <img
              alt="پیش‌نمایش آیکن SVG"
              className="h-12 w-12 object-contain p-1"
              src={visibleValue}
            />
          ) : (
            <span className="text-[10px] font-bold text-muted-foreground">
              SVG
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-wrap gap-2">
          <KoochButton
            disabled={disabled || uploading}
            loading={uploading}
            onClick={() => inputRef.current?.click()}
            size="sm"
            type="button"
            variant="outline"
          >
            {visibleValue ? "جایگزینی SVG" : "بارگذاری SVG"}
          </KoochButton>
          {(visibleValue || hasPendingReplacement) && (
            <KoochButton
              disabled={disabled || uploading}
              onClick={removeIcon}
              size="sm"
              type="button"
              variant="ghost"
            >
              حذف SVG
            </KoochButton>
          )}
          {removePending && persistedValue && onRestore && (
            <KoochButton
              disabled={disabled || uploading}
              onClick={onRestore}
              size="sm"
              type="button"
              variant="ghost"
            >
              لغو حذف آیکن
            </KoochButton>
          )}
        </div>
      </div>

      <div
        aria-live="polite"
        className="grid gap-1 text-xs font-medium"
        id={statusId}
      >
        {uploading && (
          <p className="text-muted-foreground">در حال بررسی و آماده‌سازی SVG...</p>
        )}
        {hasPendingReplacement && (
          <p className="text-primary">آیکن جدید پس از ذخیره جایگزین می‌شود.</p>
        )}
        {removePending && (
          <p className="text-amber-700 dark:text-amber-300">
            آیکن فعلی پس از ذخیره حذف می‌شود.
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
        {helperText && <p className="text-muted-foreground">{helperText}</p>}
      </div>

      <label className="sr-only" htmlFor={inputId}>
        انتخاب فایل آیکن SVG
      </label>
      <input
        accept=".svg,image/svg+xml"
        aria-describedby={statusId}
        className="hidden"
        disabled={disabled || uploading}
        id={inputId}
        onChange={stageFile}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}
