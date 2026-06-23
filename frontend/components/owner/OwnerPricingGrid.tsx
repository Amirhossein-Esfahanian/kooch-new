"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, PropertyPricingResponse, RoomDailyPriceResponse } from "@/lib/owner-api";
import { CalendarGridDay, CalendarGridRow, CalendarRangeApplyPayload, CalendarRangeGridEditor } from "@/components/CalendarRangeGridEditor";

dayjs.extend(jalaliday);

type PricingRow = CalendarGridRow & { roomTypeId: number; days: RoomDailyPriceResponse[] };

function jalaliMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return dayjs().calendar("jalali").year(year).month(monthNumber - 1).date(1).startOf("day");
}
function toIso(date: Dayjs) { return date.calendar("gregory").format("YYYY-MM-DD"); }
function cellKey(roomTypeId: number, date: string) { return `${roomTypeId}|${date}`; }
function formatPrice(value: number) { return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(value); }

export function OwnerPricingGrid({ propertyId }: { propertyId: number }) {
  const [activeMonth, setActiveMonth] = useState(() => dayjs().calendar("jalali").format("YYYY-MM"));
  const [pricing, setPricing] = useState<PropertyPricingResponse | null>(null);
  const [priceBounds, setPriceBounds] = useState({ minimum: 0, maximum: 1_000_000_000 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const monthStart = useMemo(() => jalaliMonthStart(activeMonth), [activeMonth]);
  const monthDays = useMemo(() => Array.from({ length: monthStart.daysInMonth() }, (_, index) => monthStart.add(index, "day")), [monthStart]);
  const gridDays = useMemo<CalendarGridDay[]>(() => monthDays.map((date) => {
    const iso = toIso(date);
    return { date: iso, label: date.locale("fa").format("D"), weekday: date.locale("fa").format("ddd"), isToday: iso === dayjs().format("YYYY-MM-DD") };
  }), [monthDays]);
  const rows = useMemo<PricingRow[]>(() => pricing?.roomTypes.map((roomType) => ({ id: roomType.roomTypeId, roomTypeId: roomType.roomTypeId, label: roomType.name, days: roomType.days })) ?? [], [pricing]);

  useEffect(() => { loadMonth().catch((caught: Error) => setError(caught.message)); }, [activeMonth, propertyId]);
  useEffect(() => {
    fetch("/api/backend/site-settings/public")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((settings: Record<string, string>) => {
        const minimum = Number(settings["pricing.minPrice"] ?? 0);
        const maximum = Number(settings["pricing.maxPrice"] ?? 1_000_000_000);
        setPriceBounds({ minimum: Number.isFinite(minimum) ? minimum : 0, maximum: Number.isFinite(maximum) ? maximum : 1_000_000_000 });
      })
      .catch(() => undefined);
  }, []);

  async function loadMonth() {
    setLoading(true);
    setError("");
    try {
      const from = toIso(monthDays[0]);
      const to = toIso(monthDays[monthDays.length - 1]);
      setPricing(await apiRequest<PropertyPricingResponse>(`/owner/properties/${propertyId}/pricing?from=${from}&to=${to}`));
      setMessage("");
    } finally { setLoading(false); }
  }

  function getCellValue(rowId: string | number, date: string) {
    return rows.find((row) => row.id === rowId)?.days.find((day) => day.date === date) ?? { id: null, roomTypeId: Number(rowId), date, basePrice: 0, childPrice: 0, extraGuestPrice: 0 };
  }

  async function applyPrices(payload: CalendarRangeApplyPayload) {
    const updated = await apiRequest<RoomDailyPriceResponse[]>(`/owner/properties/${propertyId}/pricing/bulk-cells`, {
      method: "POST",
      body: JSON.stringify({
        items: payload.items.map((item) => ({ roomTypeId: Number(item.rowId), date: item.date })),
        basePrice: payload.basePrice ?? 0,
        childPrice: payload.childPrice ?? 0,
        extraGuestPrice: payload.extraGuestPrice ?? 0,
      }),
    });
    const updateMap = new Map(updated.map((item) => [cellKey(item.roomTypeId, item.date), item]));
    setPricing((current) => current && ({ ...current, roomTypes: current.roomTypes.map((roomType) => ({ ...roomType, days: roomType.days.map((day) => updateMap.get(cellKey(roomType.roomTypeId, day.date)) ?? day) })) }));
    setMessage("قیمت‌ها با موفقیت ذخیره شدند.");
  }

  const monthTitle = monthStart.locale("fa").format("MMMM YYYY");
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-black">مدیریت قیمت روزانه</h2><p className="mt-1 text-sm text-slate-500">روزها و اتاق‌ها را انتخاب کنید و نرخ‌ها را به‌صورت گروهی تغییر دهید.</p></div>
        <div className="flex items-center gap-2">
          <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => setActiveMonth(monthStart.subtract(1, "month").format("YYYY-MM"))} type="button">ماه قبل</button>
          <strong className="min-w-32 rounded-xl bg-slate-50 px-4 py-2 text-center">{monthTitle}</strong>
          <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => setActiveMonth(monthStart.add(1, "month").format("YYYY-MM"))} type="button">ماه بعد</button>
        </div>
      </div>
      {loading && <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">در حال بارگذاری قیمت‌ها...</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <div className="mt-5">
        <CalendarRangeGridEditor
          days={gridDays}
          disabledDateResolver={(date) => dayjs(date).isBefore(dayjs().startOf("day"), "day")}
          error={error}
          getCellValue={getCellValue}
          message={message}
          mode="pricing"
          onApplyRange={applyPrices}
          pricingMaxValue={priceBounds.maximum}
          pricingMinValue={priceBounds.minimum}
          renderCell={(_row, _date, day, state) => <div className={`grid h-full place-items-center px-1 text-[11px] font-black ${state.selected ? "bg-[var(--theme-primary-light)]" : "bg-[var(--theme-surface-muted)]"}`}>{formatPrice(day.basePrice)}</div>}
          rows={rows}
          valueInputType="number"
          valueLabel="نرخ اتاق"
        />
      </div>
    </section>
  );
}
