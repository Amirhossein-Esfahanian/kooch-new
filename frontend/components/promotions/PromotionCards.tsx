"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

export type PromotionCardType =
  | "PercentageDiscount"
  | "FixedAmountDiscount"
  | "LastMinute"
  | "Informational"
  | string;

export interface PromotionCardItem {
  id: number | string;
  title: string;
  publicDescription?: string | null;
  internalDescription?: string | null;
  shortDescription?: string | null;
  optionalIcon?: string | null;
  badgeColor?: string | null;
  minimumStayNights?: number | null;
  minimumGuests?: number | null;
  badge?: string | null;
  type?: PromotionCardType | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

interface PromotionCardsProps {
  promotions?: PromotionCardItem[] | null;
  title?: ReactNode;
  compact?: boolean;
  maxItems?: number;
  className?: string;
}

const typeMeta: Record<string, { icon: string; badge: string }> = {
  PercentageDiscount: { icon: "🏷", badge: "تخفیف درصدی" },
  FixedAmountDiscount: { icon: "🎁", badge: "تخفیف ویژه" },
  LastMinute: { icon: "⚡", badge: "لحظه آخری" },
  Informational: { icon: "✨", badge: "پیشنهاد ویژه" },
};

export function PromotionCards({
  promotions,
  title,
  compact = false,
  maxItems,
  className = "",
}: PromotionCardsProps) {
  const activePromotions = useMemo(() => {
    const items = (promotions ?? [])
      .filter((promotion) => promotion.isActive === true)
      .sort(
        (first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0),
      );

    return typeof maxItems === "number" ? items.slice(0, maxItems) : items;
  }, [maxItems, promotions]);

  if (!activePromotions.length) return null;

  return (
    <section
      className={className}
      dir="rtl"
      aria-label="پیشنهادها و پروموشن‌ها"
    >
      {title && (
        <h2
          className={`${compact ? "text-base" : "text-2xl"} font-bold text-slate-950`}
        >
          {title}
        </h2>
      )}
      <div className={`${title ? "mt-4" : ""} grid gap-3`}>
        {activePromotions.map((promotion) => {
          const meta = typeMeta[promotion.type ?? ""] ?? typeMeta.Informational;
          const customColor = promotion.badgeColor?.trim();
          const badgeStyle = customColor
            ? { backgroundColor: customColor, color: "#fff" }
            : undefined;
          const requirements = [
            promotion.minimumStayNights
              ? `حداقل ${promotion.minimumStayNights} شب`
              : "",
            promotion.minimumGuests
              ? `حداقل ${promotion.minimumGuests} مهمان`
              : "",
          ].filter(Boolean);
          const description =
            promotion.shortDescription ||
            promotion.publicDescription ||
            promotion.internalDescription ||
            "برای این اقامتگاه پیشنهاد ویژه فعال است.";

          return (
            <article
              className={`group rounded-2xl border border-[var(--theme-primary-border)] bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0 ${
                compact ? "p-3" : "p-4 sm:p-5"
              }`}
              key={promotion.id}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid shrink-0 place-items-center rounded-2xl bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)] shadow-sm ${
                    compact ? "h-10 w-10 text-lg" : "h-12 w-12 text-2xl"
                  }`}
                  aria-hidden="true"
                >
                  {promotion.optionalIcon || meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className={`${compact ? "text-sm" : "text-base sm:text-lg"} font-bold text-slate-950`}
                    >
                      {promotion.title}
                    </h3>
                    <span
                      className="rounded-full bg-[var(--theme-primary-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--theme-primary-text)]"
                      style={badgeStyle}
                    >
                      {promotion.badge || meta.badge}
                    </span>
                  </div>
                  <p
                    className={`${compact ? "mt-1 line-clamp-2 text-xs" : "mt-2 text-sm"} leading-6 text-slate-600`}
                  >
                    {description}
                  </p>
                  {requirements.length > 0 && (
                    <p className="mt-2 text-xs font-bold text-[var(--theme-primary-text)]">
                      {requirements.join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
