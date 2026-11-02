"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";

type PropertyPhotoProps = Omit<ImageProps, "src" | "onError" | "unoptimized"> & {
  sources: Array<string | null | undefined>;
};

// A failed room image can fall back to a real Property image, never a stock photo.
export function PropertyPhoto({ sources, ...props }: PropertyPhotoProps) {
  const urls = [...new Set(sources.map((source) => source?.trim()).filter(
    (source): source is string => Boolean(source),
  ))];
  return <Photo key={JSON.stringify(urls)} urls={urls} {...props} />;
}

function Photo({ urls, alt, className, ...props }: Omit<PropertyPhotoProps, "sources"> & { urls: string[] }) {
  const [index, setIndex] = useState(0);
  const src = urls[index];
  if (!src) {
    return (
      <div aria-label={alt || "تصویر اقامتگاه موجود نیست"} className={`grid h-full min-h-52 w-full place-items-center bg-muted p-6 text-sm text-muted-foreground ${className ?? ""}`} role="img">
        تصویر در دسترس نیست
      </div>
    );
  }
  return <Image {...props} alt={alt} className={className} onError={() => setIndex((value) => value + 1)} src={src} unoptimized={shouldBypassImageOptimization(src)} />;
}
