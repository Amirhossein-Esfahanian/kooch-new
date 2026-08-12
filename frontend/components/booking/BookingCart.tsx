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
          {line.quantity.toLocaleString("fa-IR")} واحد · جمع این ردیف: {formatCurrency(line.total)}
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
}: {
  items: BookingCartItem[];
  total: number;
  loading: boolean;
  onContinue: () => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  const lines = groupBookingCartItems(items);
  const roomTypeCount = new Set(items.map((item) => item.roomTypeId)).size;
  const nightsCount = countBookingNights(items);
  const mode = bookingModePresentation(items[0].bookingMode);
  const checkIn = items[0].checkIn;
  const checkOut = items[0].checkOut;
  const adults = items[0].adults;
  const children = items[0].children;

  return (
    <section aria-labelledby="booking-cart-title" className="mt-5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-black text-foreground" id="booking-cart-title">سبد رزرو</h3>
        <span className="text-xs font-bold text-muted-foreground">
          {items.length.toLocaleString("fa-IR")} واحد
        </span>
      </div>
      <ul className="mt-2">
        {lines.map((line) => (
          <BookingCartItemRow
            key={line.key}
            line={line}
            onRemove={(ids) => ids.forEach(onRemove)}
          />
        ))}
      </ul>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted p-3 text-sm sm:grid-cols-3">
        <SummaryValue label="اقامتگاه" value={items[0].propertyName} />
        <SummaryValue label="تعداد نوع اتاق" value={roomTypeCount.toLocaleString("fa-IR")} />
        <SummaryValue label="تعداد کل واحدها" value={items.length.toLocaleString("fa-IR")} />
        <SummaryValue label="تعداد شب" value={nightsCount.toLocaleString("fa-IR")} />
        <SummaryValue label="ورود و خروج" value={formatBookingDateRange(checkIn, checkOut)} />
        <SummaryValue
          label="مهمانان"
          value={`${adults.toLocaleString("fa-IR")} بزرگسال${children > 0 ? ` و ${children.toLocaleString("fa-IR")} کودک` : ""}`}
        />
        <SummaryValue label="وضعیت رزرو" value={`${mode.icon} ${mode.label}`} />
        <SummaryValue label="مبلغ کل" value={formatCurrency(total)} />
        <SummaryValue label="آمادگی ادامه" value="آماده بررسی نهایی و ثبت سفارش" />
      </dl>
      <p className="mt-3 text-xs leading-6 text-muted-foreground">
        برای افزودن اتاق دیگر، یک نوع اتاق یا اتاق نام‌دار دیگر را انتخاب کنید و دوباره به سبد اضافه کنید.
      </p>
      <KoochButton className="mt-4 hidden w-full sm:inline-flex" loading={loading} onClick={onContinue}>
        ادامه رزرو
      </KoochButton>
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
          <p className="text-xs font-bold text-muted-foreground">{count.toLocaleString("fa-IR")} واحد</p>
          <p className="truncate font-black text-foreground">{formatCurrency(total)}</p>
        </div>
        <KoochButton loading={loading} onClick={onContinue}>ادامه رزرو</KoochButton>
      </div>
    </div>
  );
}
