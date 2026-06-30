"use client";

export interface QuickPriceSelectorProps {
  prices: number[];
  onSelect: (price: number) => void;
  maxItems?: number;
  className?: string;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(price);
}

export function QuickPriceSelector({
  onSelect,
  prices,
  maxItems = 6,
  className = "",
}: QuickPriceSelectorProps) {
  const visiblePrices = prices.slice(0, maxItems);

  return (
    <div className={`grid gap-2 rounded-xl border border-border bg-muted p-3 ${className}`} dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-black text-muted-foreground">
          قیمت‌های اخیر این اقامتگاه
        </span>
      </div>

      {visiblePrices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visiblePrices.map((price) => (
            <button
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-black text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              key={price}
              onClick={() => onSelect(price)}
              type="button"
            >
              {formatPrice(price)}
            </button>
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
