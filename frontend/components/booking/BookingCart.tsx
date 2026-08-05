"use client";

import { KoochButton } from "@/components/KoochButton";
import type { BookingCartItem } from "@/components/booking/BookingCartProvider";
import { formatCurrency } from "@/lib/currency";

export function BookingCartItemRow({
  item,
  onRemove,
}: {
  item: BookingCartItem;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0 text-sm">
        <p className="truncate font-bold text-foreground">
          {item.roomTypeName}{item.roomName ? `، ${item.roomName}` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
          {item.checkIn} – {item.checkOut}
        </p>
        <p className="mt-1 font-semibold text-foreground">
          {formatCurrency(item.displayAmount)}
        </p>
      </div>
      <KoochButton
        aria-label={`حذف ${item.roomTypeName} از سبد رزرو`}
        className="shrink-0"
        onClick={() => onRemove(item.id)}
        size="sm"
        variant="ghost"
      >
        حذف
      </KoochButton>
    </li>
  );
}

export function BookingCartSummary({
  items,
  total,
  loading,
  onContinue,
  onRemove,
}: {
  items: BookingCartItem[];
  total: number;
  loading: boolean;
  onContinue: () => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="booking-cart-title" className="mt-5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-black text-foreground" id="booking-cart-title">سبد رزرو</h3>
        <span className="text-xs font-bold text-muted-foreground">
          {items.length.toLocaleString("fa-IR")} اتاق
        </span>
      </div>
      <ul className="mt-2">
        {items.map((item) => (
          <BookingCartItemRow item={item} key={item.id} onRemove={onRemove} />
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3 font-black">
        <span>مجموع</span>
        <span>{formatCurrency(total)}</span>
      </div>
      <KoochButton className="mt-4 hidden w-full sm:inline-flex" loading={loading} onClick={onContinue}>
        ادامه رزرو
      </KoochButton>
    </section>
  );
}

export function BookingCartMobileActionBar({
  count,
  total,
  loading,
  onContinue,
}: {
  count: number;
  total: number;
  loading: boolean;
  onContinue: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 shadow-lg backdrop-blur sm:hidden" data-testid="booking-mobile-action-bar" dir="rtl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="text-xs font-bold text-muted-foreground">{count.toLocaleString("fa-IR")} اتاق</p>
          <p className="truncate font-black text-foreground">{formatCurrency(total)}</p>
        </div>
        <KoochButton loading={loading} onClick={onContinue}>ادامه رزرو</KoochButton>
      </div>
    </div>
  );
}
