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
    <div className={`grid gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-3 ${className}`} dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-black text-[var(--theme-muted-text)]">
          قیمت‌های اخیر این اقامتگاه
        </span>
      </div>

      {visiblePrices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visiblePrices.map((price) => (
            <button
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 transition hover:border-[var(--theme-primary-border)] hover:bg-[var(--theme-primary-soft)] hover:text-[var(--theme-primary-text)]"
              key={price}
              onClick={() => onSelect(price)}
              type="button"
            >
              {formatPrice(price)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs font-semibold text-slate-400">
          هنوز قیمت سریعی برای این اقامتگاه ثبت نشده است.
        </p>
      )}
    </div>
  );
}
