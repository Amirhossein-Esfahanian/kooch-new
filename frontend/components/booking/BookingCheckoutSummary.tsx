import { groupBookingCartItems } from "@/components/booking/BookingCart";
import type { BookingCartItem } from "@/components/booking/BookingCartProvider";
import {
  bookingModePresentation,
  countBookingNights,
  formatBookingDate,
} from "@/components/booking/booking-display";
import { formatCurrency } from "@/lib/currency";

export function BookingCheckoutSummary({
  items,
  total,
}: {
  items: BookingCartItem[];
  total: number;
}) {
  const first = items[0];
  if (!first) return null;
  const lines = groupBookingCartItems(items);

  return (
    <div className="grid gap-4" data-testid="checkout-summary-stack">
      <SummaryCard testId="checkout-date-summary" title="تاریخ اقامت">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <SummaryValue label="ورود" value={formatBookingDate(first.checkIn)} />
          <SummaryValue label="خروج" value={formatBookingDate(first.checkOut)} />
          <SummaryValue
            className="col-span-2 border-t border-border pt-3"
            label="مدت اقامت"
            value={`${countBookingNights(items).toLocaleString("fa-IR")} شب`}
          />
        </dl>
      </SummaryCard>

      <SummaryCard testId="checkout-property-summary" title="اقامتگاه و اتاق‌ها">
        <p className="break-words text-base font-black text-foreground">
          {first.propertyName}
        </p>
        <p className="mt-1 text-xs font-bold text-muted-foreground">
          {first.adults.toLocaleString("fa-IR")} بزرگسال
          {first.children > 0
            ? ` · ${first.children.toLocaleString("fa-IR")} کودک (${first.childAges.map((age) => `${age.toLocaleString("fa-IR")} سال`).join("، ")})`
            : " · بدون کودک"}
        </p>
        <ul className="mt-3 divide-y divide-border" aria-label="اتاق‌های انتخاب‌شده">
          {lines.map((line) => {
            const mode = bookingModePresentation(line.item.bookingMode);
            return (
              <li className="grid min-w-0 gap-1 py-3 first:pt-0 last:pb-0" key={line.key}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="break-words text-sm font-black text-foreground">
                    {line.item.roomTypeName}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-foreground">
                    {line.quantity.toLocaleString("fa-IR")} اتاق
                  </span>
                </div>
                <span className="text-xs font-bold text-muted-foreground">
                  <span aria-hidden="true">{mode.icon}</span> {mode.label}
                </span>
              </li>
            );
          })}
        </ul>
      </SummaryCard>

      <SummaryCard testId="checkout-price-summary" title="جزئیات قیمت">
        <dl className="grid gap-3">
          {lines.map((line) => (
            <div className="flex min-w-0 items-start justify-between gap-3 text-sm" key={line.key}>
              <dt className="min-w-0 break-words text-muted-foreground">
                {line.item.roomTypeName} × {line.quantity.toLocaleString("fa-IR")}
              </dt>
              <dd className="shrink-0 font-bold text-foreground">{formatCurrency(line.total)}</dd>
            </div>
          ))}
          <div className="flex items-end justify-between gap-3 border-t border-border pt-4">
            <dt className="font-black text-foreground">مبلغ کل</dt>
            <dd className="text-lg font-black text-foreground">{formatCurrency(total)}</dd>
          </div>
        </dl>
      </SummaryCard>
    </div>
  );
}

function SummaryCard({
  children,
  testId,
  title,
}: {
  children: React.ReactNode;
  testId: string;
  title: string;
}) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid={testId}
    >
      <h2 className="text-base font-black text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SummaryValue({
  className = "",
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs font-bold text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-black text-foreground">{value}</dd>
    </div>
  );
}
