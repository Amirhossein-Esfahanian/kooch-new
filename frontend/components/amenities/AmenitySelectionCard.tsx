"use client";

import type { AmenityCategoryResponse, AmenityResponse } from "@/lib/owner-api";
import { KoochSvgIcon } from "@/components/KoochSvgIcon";

type AmenitySelectionCardProps = {
  amenity: AmenityResponse;
  category?: AmenityCategoryResponse;
  disabled?: boolean;
  selected: boolean;
  onToggle: (selected: boolean) => void;
};

function AmenityIcon({ className, icon }: { className: string; icon: string }) {
  if (isSvgPath(icon)) {
    return <KoochSvgIcon className={className} src={icon} />;
  }

  return (
    <span aria-hidden="true" className={className}>
      {icon}
    </span>
  );
}

function isSvgPath(icon: string) {
  return icon.toLocaleLowerCase().endsWith(".svg");
}

export function AmenitySelectionCard({
  amenity,
  category,
  disabled = false,
  selected,
  onToggle,
}: AmenitySelectionCardProps) {
  return (
    <button
      aria-pressed={selected}
      className={`relative isolate flex h-24 w-full min-w-0 flex-col items-start justify-between overflow-hidden rounded-xl border-2 p-3 text-right transition-[border-color,box-shadow] duration-150 ease-out focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:shadow-[0_0_0_3px_var(--theme-primary-soft),0_0_14px_-7px_var(--theme-primary)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
        selected
          ? "border-primary text-primary [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:shadow-[0_0_0_4px_var(--theme-primary-soft),0_0_16px_-7px_var(--theme-primary)]"
          : "border border-foreground/35 text-foreground [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:border-[color-mix(in_srgb,var(--theme-primary)_50%,transparent)] [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:shadow-[0_0_0_2px_var(--theme-primary-soft),0_0_10px_-8px_var(--theme-primary)]"
      }`}
      disabled={disabled}
      onClick={() => onToggle(!selected)}
      type="button"
    >
      {category?.icon && isSvgPath(category.icon) ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute -bottom-5 -left-3 z-0 ${
            selected
              ? "text-primary opacity-[0.1]"
              : "text-muted-foreground opacity-[0.06]"
          }`}
          data-amenity-category-icon="decorative"
        >
          <KoochSvgIcon className="!h-24 !w-24" src={category.icon} />
        </span>
      ) : null}

      <span className="relative z-10 flex h-7 items-center">
        {amenity.icon ? (
          <AmenityIcon className="h-7 w-7" icon={amenity.icon} />
        ) : null}
      </span>
      <span className="relative z-10 line-clamp-2 w-full text-sm font-bold leading-5">
        {amenity.name}
      </span>
    </button>
  );
}
