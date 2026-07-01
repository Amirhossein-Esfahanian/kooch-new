"use client";

import { ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/owner-api";
import { KoochButton } from "@/components/KoochButton";

type SvgUploadResponse = {
  path: string;
};

type KoochSvgUploaderProps = {
  disabled?: boolean;
  helperText?: string;
  onChange: (path: string) => void;
  onRemove?: () => void;
  uploadPath: string;
  value?: string | null;
  fileNameHint?: string;
};

function isSvgFile(file: File) {
  return (
    file.name.toLocaleLowerCase().endsWith(".svg") ||
    file.type === "image/svg+xml"
  );
}

export function KoochSvgUploader({
  disabled = false,
  helperText,
  onChange,
  onRemove,
  uploadPath,
  value,
  fileNameHint = "icon",
}: KoochSvgUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      toast.error("فایل SVG را انتخاب کنید.");
      return;
    }

    if (!isSvgFile(file)) {
      toast.error("فقط فایل SVG قابل بارگذاری است.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("slug", fileNameHint);

    setUploading(true);
    try {
      const response = await apiRequest<SvgUploadResponse>(uploadPath, {
        method: "POST",
        body: formData,
      });
      onChange(response.path);
      toast.success("آیکن SVG بارگذاری شد.");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "بارگذاری SVG انجام نشد.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-lg border border-border bg-card">
          {value ? (
            <img
              alt=""
              className="h-12 w-12 object-contain p-1"
              src={value}
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
            {value ? "جایگزینی SVG" : "بارگذاری SVG"}
          </KoochButton>
          {value && (
            <KoochButton
              disabled={disabled || uploading}
              onClick={() => onRemove?.()}
              size="sm"
              type="button"
              variant="ghost"
            >
              حذف SVG
            </KoochButton>
          )}
        </div>
      </div>

      {value && (
        <p className="break-all text-xs font-medium text-muted-foreground" dir="ltr">
          {value}
        </p>
      )}
      {helperText && (
        <p className="text-xs font-medium text-muted-foreground">
          {helperText}
        </p>
      )}

      <input
        accept=".svg,image/svg+xml"
        className="hidden"
        disabled={disabled || uploading}
        onChange={uploadFile}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}
