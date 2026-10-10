import type { ReactNode } from "react";

const weekdays = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"] as const;

export type RoomPricingCalendarStatus = "Available" | "OnRequest" | "Unavailable";

export interface RoomPricingCalendarDay {
  date: string;
  dayLabel: string;
  dateLabel: string;
  priceLabel: string;
  priceAccessibleLabel: string;
  availableUnits: number;
  availabilityLabel?: string;
  totalInventory?: number;
  status: RoomPricingCalendarStatus;
  isPast?: boolean;
  isHoliday?: boolean;
  isSelected?: boolean;
}

export interface RoomPricingCalendarRoom {
  id: number;
  name: string;
  days: RoomPricingCalendarDay[];
  headerActions?: ReactNode;
  selectionSummary?: ReactNode;
  onDaySelect?: (date: string) => void;
}

function persianNumber(value: number) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0, useGrouping: false }).format(value);
}

export function RoomPricingCalendar({
  rooms,
  startOffset,
  monthTitle,
  layout = "responsive",
  audience = "operator",
}: {
  rooms: RoomPricingCalendarRoom[];
  startOffset: number;
  monthTitle?: string;
  layout?: "responsive" | "single";
  audience?: "operator" | "guest";
}) {
  const isGuest = audience === "guest";
  return (
    <div dir="rtl">
      {monthTitle && <h2 className="mb-3 text-sm font-semibold text-foreground">{monthTitle}</h2>}
      <div className={`grid items-start gap-3 ${layout === "responsive" ? "md:grid-cols-2 xl:grid-cols-3" : ""}`}>
      {rooms.map((room) => (
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" key={room.id}>
          {!isGuest && <div className="grid gap-2 border-b border-border px-3 py-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-bold text-foreground">{room.name}</h3>
              {room.headerActions}
            </div>
            {room.selectionSummary}
          </div>}
          <div className="grid grid-cols-7 bg-muted">
            {weekdays.map((weekday) => (
              <div
                className={`${isGuest ? "border px-0.5 py-1 text-[10px]" : "border-2 px-0.5 py-1.5 text-[9px]"} border-card text-center font-semibold ${
                  weekday === "جمعه" ? "text-destructive" : "text-muted-foreground"
                }`}
                key={weekday}
              >
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 bg-muted">
            {Array.from({ length: startOffset }, (_, index) => (
              <div aria-hidden="true" className={`${isGuest ? "min-h-14 border" : "min-h-16 border-2"} border-card bg-card`} key={`empty-${room.id}-${index}`} />
            ))}
            {room.days.map((day) => {
              const isAvailable = day.status === "Available" && day.availableUnits > 0;
              const isOnRequest = day.status === "OnRequest" && day.availableUnits > 0;
              const statusSurface = day.isPast
                ? "bg-muted text-muted-foreground"
                : isAvailable
                  ? "bg-[var(--theme-success-soft)] text-foreground"
                  : isOnRequest
                    ? "bg-[var(--theme-warning-soft)] text-foreground"
                    : "bg-muted text-muted-foreground";
              const bookingLabel = isAvailable ? "رزرو فوری" : isOnRequest ? "استعلامی" : "ناموجود";
              const bookingIconClass = isAvailable
                ? "text-[var(--theme-success)]"
                : isOnRequest
                  ? "text-[var(--theme-warning)]"
                  : "text-muted-foreground";
              const availabilityLabel = day.totalInventory == null
                ? persianNumber(day.availableUnits)
                : `${persianNumber(day.availableUnits)} از ${persianNumber(day.totalInventory)}`;
              const statusDescription = isGuest
                ? day.availabilityLabel ? `، ${day.availabilityLabel}` : ""
                : `، ${day.availabilityLabel ?? `${bookingLabel}، ${availabilityLabel}`}`;
              const label = `${room.name}، ${day.dateLabel}${statusDescription}، نرخ ${day.priceAccessibleLabel}`;
              const content = isGuest ? (
                <div className="flex flex-col items-center justify-center gap-0.5 text-center">
                  <span className={`text-base font-bold leading-none ${day.isPast ? "text-muted-foreground" : "text-foreground"}`}>
                    {day.dayLabel}
                  </span>
                  <span className={`min-w-0 max-w-full break-words text-[11px] font-medium leading-tight tabular-nums ${day.isPast ? "text-muted-foreground" : "text-foreground/80"}`}>
                    {day.priceLabel}
                  </span>
                  {day.availabilityLabel && (
                    <span className="text-[9px] font-medium leading-none text-muted-foreground">
                      {day.availabilityLabel}
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-0.5">
                    <span className={`text-[11px] font-bold ${day.isHoliday ? "text-destructive" : ""}`}>{day.dayLabel}</span>
                    {day.status !== "Unavailable" && day.availableUnits > 0 && (
                      <span aria-hidden="true" className={`text-[10px] leading-none ${bookingIconClass}`} title={bookingLabel}>⚡</span>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="min-w-0 break-words text-[11px] font-bold leading-tight tabular-nums text-foreground">{day.priceLabel}</div>
                  </div>
                  <div className="text-left text-[9px] font-semibold leading-none tabular-nums text-muted-foreground">
                    {day.availabilityLabel ?? <>{persianNumber(day.availableUnits)}{day.totalInventory == null ? null : `/${persianNumber(day.totalInventory)}`}</>}
                  </div>
                </>
              );
              const className = `relative border-card transition ${isGuest ? "flex min-h-14 flex-col justify-center border px-0.5 py-1 text-center" : "grid min-h-16 content-between gap-1 border-2 p-1 text-right"} ${
                room.onDaySelect
                  ? day.isPast ? "cursor-not-allowed" : "cursor-pointer hover:brightness-[0.98]"
                  : ""
              } ${statusSurface} ${room.onDaySelect && day.isSelected ? "z-10 ring-2 ring-inset ring-primary" : ""}`;

              return room.onDaySelect ? (
                <button
                  aria-label={label}
                  aria-pressed={Boolean(day.isSelected)}
                  className={className}
                  disabled={day.isPast}
                  key={day.date}
                  onClick={() => room.onDaySelect?.(day.date)}
                  type="button"
                >
                  {content}
                </button>
              ) : (
                <div aria-label={label} className={className} key={day.date} role="group">{content}</div>
              );
            })}
          </div>
        </section>
      ))}
      </div>
    </div>
  );
}
