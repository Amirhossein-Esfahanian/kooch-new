"use client";

import { KoochButton } from "@/components/KoochButton";

export interface QuickPriceSelectorProps {
  prices: number[];
  onSelect: (price: number) => void;
  maxItems?: number;
  className?: string;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(
    price,
  );
}

export function QuickPriceSelector({
  onSelect,
  prices,
  maxItems = 6,
  className = "",
}: QuickPriceSelectorProps) {
  const visiblePrices = prices.slice(0, maxItems);

  return (
    <div
      className={`grid gap-2 rounded-lg border border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] p-2 text-foreground ${className}`}
      dir="rtl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-primary-foreground/80">
          قیمت‌های اخیر این اقامتگاه
        </span>
      </div>

      {visiblePrices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visiblePrices.map((price) => (
            <KoochButton
              className="min-h-8 rounded-full px-3 py-1 text-xs font-bold"
              key={price}
              onClick={() => onSelect(price)}
              size="sm"
              variant="outline"
            >
              {formatPrice(price)}
            </KoochButton>
          ))}
        </div>
      ) : (
        <p className="text-xs font-semibold text-muted-foreground">
          هنوز قیمت سریعی برای این اقامتگاه ثبت نشده است.
        </p>
      )}
    </div>
  );
}
