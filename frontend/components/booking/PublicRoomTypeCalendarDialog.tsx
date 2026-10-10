"use client";

import dayjs from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useEffect, useRef, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { RoomPricingCalendar, type RoomPricingCalendarRoom } from "@/components/pricing/RoomPricingCalendar";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { fetchPublicRoomTypeCalendar, type PublicRoomTypeCalendarResponse, type PublicRoomType } from "@/lib/public-properties";

dayjs.extend(jalaliday);

function calendarMonths() {
  const currentStart = dayjs().calendar("jalali").date(1).startOf("day");
  const nextStart = currentStart.add(1, "month");
  const toIso = (date: dayjs.Dayjs) => date.calendar("gregory").format("YYYY-MM-DD");

  return [currentStart, nextStart].map((start) => ({
    start,
    from: toIso(start),
    to: toIso(start.add(1, "month").subtract(1, "day")),
    title: start.locale("fa").format("MMMM YYYY"),
  }));
}

export function PublicRoomTypeCalendarDialog({
  roomType,
  propertySlug,
  onClose,
}: {
  roomType: PublicRoomType | null;
  propertySlug: string;
  onClose: () => void;
}) {
  const [months] = useState(calendarMonths);
  const [monthIndex, setMonthIndex] = useState(0);
  const [calendar, setCalendar] = useState<PublicRoomTypeCalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, PublicRoomTypeCalendarResponse>());
  const currencyLabel = useSiteCurrencyLabel();
  const roomTypeId = roomType?.id;
  const from = months[0].from;
  const to = months[1].to;

  useEffect(() => {
    if (roomTypeId == null) return;
    const key = `${propertySlug}|${roomTypeId}|${from}|${to}`;
    const cached = cache.current.get(key);
    setMonthIndex(0);
    setError(false);
    if (cached) {
      setCalendar(cached);
      setLoading(false);
      return;
    }

    let active = true;
    setCalendar(null);
    setLoading(true);
    void fetchPublicRoomTypeCalendar(propertySlug, roomTypeId, from, to)
      .then((result) => {
        cache.current.set(key, result);
        if (active) setCalendar(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [roomTypeId, propertySlug, from, to, retry]);

  const selectedMonth = months[monthIndex];
  const daysByDate = new Map(calendar?.days.map((day) => [day.date, day]));
  const today = dayjs().calendar("gregory").format("YYYY-MM-DD");
  const days: RoomPricingCalendarRoom["days"] = Array.from(
    { length: selectedMonth.start.daysInMonth() },
    (_, index) => {
      const date = selectedMonth.start.add(index, "day");
      const iso = date.calendar("gregory").format("YYYY-MM-DD");
      const source = daysByDate.get(iso);
      const price = source?.standardPrice ?? null;
      const status = source?.availabilityStatus ?? "Unavailable";
      const availableUnits = source?.availableUnits ?? 0;
      const availabilityLabel = status === "Available"
        ? `${availableUnits.toLocaleString("fa-IR")} واحد`
        : status === "OnRequest" ? "درخواست رزرو" : "ناموجود";
      return {
        date: iso,
        dayLabel: date.locale("fa").format("D"),
        dateLabel: date.locale("fa").format("YYYY/MM/DD"),
        priceLabel: price === null ? "—" : formatCurrency(price, { currencyLabel }),
        priceAccessibleLabel: price === null ? "قیمت تعیین نشده" : formatCurrency(price, { currencyLabel }),
        availableUnits,
        availabilityLabel,
        status,
        isPast: iso < today,
      };
    },
  );

  return (
    <KoochDialog
      bodyClassName="min-w-0 px-3 py-4 sm:px-6"
      contentClassName="!h-auto"
      onOpenChange={(open) => { if (!open) onClose(); }}
      open={roomType !== null}
      size="md"
      title={`تقویم قیمت و موجودی — ${roomType?.name ?? ""}`}
    >
      <div className="grid gap-4">
        <div aria-label="ماه تقویم" className="flex flex-wrap gap-2" role="group">
          {["ماه جاری", "ماه بعد"].map((label, index) => (
            <KoochButton
              aria-pressed={monthIndex === index}
              key={label}
              onClick={() => setMonthIndex(index)}
              size="sm"
              variant={monthIndex === index ? "primary" : "outline"}
            >
              {label}
            </KoochButton>
          ))}
        </div>
        {loading && <p className="py-6 text-center text-sm text-muted-foreground" role="status">در حال دریافت تقویم…</p>}
        {error && (
          <KoochAlert variant="destructive">
            دریافت تقویم انجام نشد. <KoochButton className="ms-2" onClick={() => setRetry((value) => value + 1)} size="sm" variant="outline">تلاش دوباره</KoochButton>
          </KoochAlert>
        )}
        {!loading && !error && calendar?.roomTypeId === roomTypeId && (
          <div className="max-w-full overflow-x-auto">
            <div className="min-w-[560px] sm:min-w-0">
              <RoomPricingCalendar
                layout="single"
                monthTitle={selectedMonth.title}
                rooms={[{ id: roomTypeId!, name: roomType?.name ?? "", days }]}
                startOffset={(selectedMonth.start.day() + 1) % 7}
              />
            </div>
          </div>
        )}
      </div>
    </KoochDialog>
  );
}
