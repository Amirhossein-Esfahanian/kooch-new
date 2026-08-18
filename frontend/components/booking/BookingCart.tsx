"use client";

import { KoochButton } from "@/components/KoochButton";
import type { BookingCartItem } from "@/components/booking/BookingCartProvider";
import {
  bookingModePresentation,
  countBookingNights,
  formatBookingDateRange,
} from "@/components/booking/booking-display";
import { formatCurrency } from "@/lib/currency";

export interface BookingCartLine {
  key: string;
  item: BookingCartItem;
  itemIds: string[];
  quantity: number;
  total: number;
}

export function groupBookingCartItems(items: BookingCartItem[]) {
  const groups = new Map<string, BookingCartLine>();
  for (const item of items) {
    const key = JSON.stringify([
      item.roomTypeId,
      item.roomName,
      item.checkIn,
      item.checkOut,
      item.adults,
      item.children,
      item.childAges,
      item.notes,
      item.bookingMode,
      item.displayAmount,
      item.currency,
    ]);
    const current = groups.get(key);
    if (current) {
      current.itemIds.push(item.id);
      current.quantity += 1;
      current.total += item.displayAmount;
    } else {
      groups.set(key, {
        key,
        item,
        itemIds: [item.id],
        quantity: 1,
        total: item.displayAmount,
      });
    }
  }
  return [...groups.values()];
}

export function BookingCartItemRow({
  line,
  onRemove,
}: {
  line: BookingCartLine;
  onRemove: (ids: string[]) => void;
}) {
  const { item } = line;
  const mode = bookingModePresentation(item.bookingMode);
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0 text-sm">
        <p className="truncate font-bold text-foreground">
          {item.roomTypeName}{item.roomName ? `، ${item.roomName}` : ""}
        </p>
        <p className="mt-1 text-xs font-bold text-foreground">
          <span aria-hidden="true">{mode.icon}</span> {mode.label}
        </p>
        <p className="mt-1 font-semibold text-foreground">
          {line.quantity.toLocaleString("fa-IR")} اتاق · {formatCurrency(line.total)}
        </p>
      </div>
      <KoochButton
        aria-label={`حذف ${item.roomTypeName} از سبد رزرو`}
        className="shrink-0"
        onClick={() => onRemove(line.itemIds)}
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
  className,
}: {
  items: BookingCartItem[];
  total: number;
  loading: boolean;
  onContinue: () => void;
  onRemove: (id: string) => void;
  className?: string;
}) {
  const lines = groupBookingCartItems(items);
  const roomTypeCount = new Set(items.map((item) => item.roomTypeId)).size;
  const nightsCount = countBookingNights(items);
  const firstItem = items[0];
  const mode = firstItem ? bookingModePresentation(firstItem.bookingMode) : null;

  return (
    <section
      aria-labelledby="booking-choices-title"
      className={`${className ?? "mt-5"} rounded-lg border border-border bg-card p-4`}
      data-testid="booking-choices-summary"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-black text-foreground" id="booking-choices-title">
          انتخاب‌های شما
        </h3>
        {items.length > 0 && (
          <span className="text-xs font-bold text-muted-foreground">
            {items.length.toLocaleString("fa-IR")} اتاق
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          هنوز اتاقی انتخاب نکرده‌اید.
        </p>
      ) : (
        <>
          <ul className="mt-2">
            {lines.map((line) => (
              <BookingCartItemRow
                key={line.key}
                line={line}
                onRemove={(ids) => ids.forEach(onRemove)}
              />
            ))}
          </ul>

          <div className="mt-3 border-y border-border py-3 text-sm">
            <p className="font-black leading-7 text-foreground">
              {formatBookingDateRange(firstItem.checkIn, firstItem.checkOut)}
            </p>
            <p className="mt-1 text-muted-foreground">
              {nightsCount.toLocaleString("fa-IR")} شب · {firstItem.adults.toLocaleString("fa-IR")} بزرگسال
              {firstItem.children > 0
                ? ` · ${firstItem.children.toLocaleString("fa-IR")} کودک`
                : ""}
            </p>
            <p className="mt-1 text-xs font-bold text-foreground">
              <span aria-hidden="true">{mode?.icon}</span> {mode?.label}
            </p>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <SummaryValue label="تعداد نوع اتاق" value={roomTypeCount.toLocaleString("fa-IR")} />
            <SummaryValue label="تعداد اتاق" value={items.length.toLocaleString("fa-IR")} />
            <div className="col-span-2 flex items-end justify-between gap-3 rounded-lg bg-muted p-3">
              <dt className="text-xs font-bold text-muted-foreground">مبلغ کل</dt>
              <dd className="text-base font-black text-foreground">{formatCurrency(total)}</dd>
            </div>
          </dl>

          <KoochButton className="mt-4 hidden w-full sm:inline-flex" loading={loading} onClick={onContinue}>
            ادامه رزرو
          </KoochButton>
        </>
      )}
    </section>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-black text-foreground">{value}</dd>
    </div>
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
          <p className="text-xs font-bold text-muted-foreground">{count.toLocaleString("fa-IR")} اتاق انتخاب‌شده</p>
          <p className="truncate font-black text-foreground">{formatCurrency(total)}</p>
        </div>
        <KoochButton loading={loading} onClick={onContinue}>ادامه رزرو</KoochButton>
      </div>
    </div>
  );
}
