"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";
import type { PublicImage } from "@/lib/public-properties";
import styles from "./MarketplacePropertyDetail.module.css";

export function MarketplacePropertyGallery({ images, name }: { images: PublicImage[]; name: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const selected = index === null ? null : images[index];
  const move = (direction: number) => setIndex((value) => value === null ? null : (value + direction + images.length) % images.length);

  return <>
    <section aria-label="تصاویر اقامتگاه" className={styles.mosaic}>
      {images.length ? Array.from({ length: 5 }, (_, tile) => {
        const imageIndex = tile < images.length ? tile : 0;
        const image = images[imageIndex];
        return <button aria-label={`نمایش تصویر ${imageIndex + 1} از ${name}`} className={tile === 0 ? styles.coverTile : styles.photoTile}
          key={tile} onClick={() => setIndex(imageIndex)} type="button">
          <Image alt={image.altText || image.caption || name} className={styles.mosaicImage} fill priority={tile === 0}
            sizes={tile === 0 ? "(min-width: 1280px) 640px, 50vw" : "(min-width: 1280px) 320px, 25vw"}
            src={image.url} unoptimized={shouldBypassImageOptimization(image.url)} />
        </button>;
      }) : <p className={styles.noImages}>تصویری برای این اقامتگاه ثبت نشده است.</p>}
      <KoochButton className={styles.galleryPill} disabled={!images.length} onClick={() => setIndex(0)} variant="outline">
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeWidth="1.7">
          <path d="M8 5l1.5-2h5L16 5h4a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2z" /><circle cx="12" cy="13" r="4" />
        </svg>
        مشاهده همه تصاویر
      </KoochButton>
    </section>
    <KoochDialog initialFocusRef={viewerRef} open={selected !== null} onOpenChange={(open) => { if (!open) setIndex(null); }} title={`تصاویر ${name}`} size="xl"
      bodyClassName={styles.galleryBody} contentClassName={styles.galleryDialog}>
      {selected && <div aria-label="نمایش تصاویر اقامتگاه" role="group" tabIndex={-1} ref={viewerRef} className={styles.viewer} onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          move(event.key === "ArrowLeft" ? 1 : -1);
        }
      }}>
        <figure className={styles.viewerFigure}>
          <div className={styles.viewerImage}>
            <Image alt={selected.altText || name} className={styles.containImage} fill sizes="90vw" src={selected.url}
              unoptimized={shouldBypassImageOptimization(selected.url)} />
          </div>
          {selected.caption && <figcaption>{selected.caption}</figcaption>}
        </figure>
        <div className={styles.viewerControls}>
          <KoochButton disabled={images.length < 2} onClick={() => move(-1)} variant="outline">تصویر قبلی</KoochButton>
          <p aria-live="polite" aria-atomic="true">تصویر {((index ?? 0) + 1).toLocaleString("fa-IR")} از {images.length.toLocaleString("fa-IR")}</p>
          <KoochButton disabled={images.length < 2} onClick={() => move(1)} variant="outline">تصویر بعدی</KoochButton>
        </div>
        <div aria-label="انتخاب تصویر" className={styles.thumbnails}>
          {images.map((image, imageIndex) => <button aria-label={`انتخاب تصویر ${imageIndex + 1}`} aria-pressed={index === imageIndex}
            className={styles.thumbnail} key={image.id} onClick={() => setIndex(imageIndex)} type="button">
            <Image alt="" className={styles.mosaicImage} fill sizes="80px" src={image.url} unoptimized={shouldBypassImageOptimization(image.url)} />
          </button>)}
        </div>
      </div>}
    </KoochDialog>
  </>;
}
