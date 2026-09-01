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
      className={`relative isolate flex h-24 w-full min-w-0 flex-col items-start justify-between overflow-hidden rounded-xl border-2 p-3 text-right transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
        selected
          ? "border-primary  text-primary"
          : "border border-foreground/35 text-foreground hover:border-primary/60"
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
