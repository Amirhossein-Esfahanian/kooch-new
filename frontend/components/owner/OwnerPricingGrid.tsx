"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, PricingGuestType, PropertyPricingResponse, RoomDailyPriceHistoryResponse, RoomDailyPriceResponse } from "@/lib/owner-api";
import { CalendarGridDay, CalendarGridRow, CalendarRangeApplyPayload, CalendarRangeGridEditor } from "@/components/CalendarRangeGridEditor";
import {
  getPricingWarnings,
  getPropertyPriceBounds,
  isOutlierPrice,
  PricingSettingsWarning,
} from "@/components/pricing/PricingWarnings";

dayjs.extend(jalaliday);

type PricingRow = CalendarGridRow & { roomTypeId: number; days: RoomDailyPriceResponse[] };

function jalaliMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return dayjs().calendar("jalali").year(year).month(monthNumber - 1).date(1).startOf("day");
}
function toIso(date: Dayjs) { return date.calendar("gregory").format("YYYY-MM-DD"); }
function cellKey(roomTypeId: number, date: string) { return `${roomTypeId}|${date}`; }
function formatPrice(value: number) { return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(value); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatIsoDate(value: string) { return dayjs(value).calendar("jalali").locale("fa").format("YYYY/MM/DD"); }

const pricingGuestTypeStorageKey = "kooch:owner-pricing-guest-type";
const maxQuickPrices = 6;
const pricingGuestTabs: { value: PricingGuestType; label: string; description: string }[] = [
  { value: "Iranian", label: "ایرانی", description: "قیمت روزانه برای مهمانان ایرانی" },
  { value: "Foreign", label: "خارجی", description: "قیمت روزانه برای مهمانان خارجی" },
];

function readStoredGuestType(): PricingGuestType {
  if (typeof window === "undefined") return "Iranian";
  const stored = window.localStorage.getItem(pricingGuestTypeStorageKey);
  return stored === "Foreign" ? "Foreign" : "Iranian";
}

function quickPriceStorageKey(propertyId: number) {
  return `kooch:quick-price-presets:property:${propertyId}`;
}

function uniqueRecentPrices(prices: number[]) {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const price of prices) {
    const normalized = Math.round(price);
    if (!Number.isFinite(normalized) || normalized < 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxQuickPrices) break;
  }
  return result;
}

function readStoredQuickPrices(propertyId: number) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(quickPriceStorageKey(propertyId)) ?? "[]");
    return Array.isArray(parsed) ? uniqueRecentPrices(parsed.map((item) => Number(item))) : [];
  } catch {
    return [];
  }
}

function writeStoredQuickPrices(propertyId: number, prices: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(quickPriceStorageKey(propertyId), JSON.stringify(uniqueRecentPrices(prices)));
}

function pricingRecentPrices(pricing: PropertyPricingResponse | null) {
  if (!pricing) return [];
  return uniqueRecentPrices(
    pricing.roomTypes
      .flatMap((roomType) => roomType.days)
      .slice()
      .sort((first, second) => second.date.localeCompare(first.date))
      .map((day) => day.basePrice),
  );
}

export function OwnerPricingGrid({
  context = "owner",
  propertyId,
}: {
  context?: "admin" | "owner";
  propertyId: number;
}) {
  const [activeMonth, setActiveMonth] = useState(() => dayjs().calendar("jalali").format("YYYY-MM"));
  const [activeGuestType, setActiveGuestType] = useState<PricingGuestType>(readStoredGuestType);
  const [pricing, setPricing] = useState<PropertyPricingResponse | null>(null);
  const [priceBounds, setPriceBounds] = useState({ minimum: 0, maximum: 1_000_000_000 });
  const [currencyLabel, setCurrencyLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<RoomDailyPriceHistoryResponse[]>([]);
  const [storedQuickPrices, setStoredQuickPrices] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const monthStart = useMemo(() => jalaliMonthStart(activeMonth), [activeMonth]);
  const monthDays = useMemo(() => Array.from({ length: monthStart.daysInMonth() }, (_, index) => monthStart.add(index, "day")), [monthStart]);
  const gridDays = useMemo<CalendarGridDay[]>(() => monthDays.map((date) => {
    const iso = toIso(date);
    return { date: iso, label: date.locale("fa").format("D"), weekday: date.locale("fa").format("ddd"), isToday: iso === dayjs().format("YYYY-MM-DD") };
  }), [monthDays]);
  const rows = useMemo<PricingRow[]>(() => pricing?.roomTypes.map((roomType) => ({ id: roomType.roomTypeId, roomTypeId: roomType.roomTypeId, label: roomType.name, days: roomType.days })) ?? [], [pricing]);
  const quickPricePresets = useMemo(() => uniqueRecentPrices([...storedQuickPrices, ...pricingRecentPrices(pricing)]), [pricing, storedQuickPrices]);
  const pricingWarnings = useMemo(() => getPricingWarnings(pricing), [pricing]);
  const propertyPriceBounds = useMemo(() => getPropertyPriceBounds(pricing), [pricing]);
  const propertyEditHref = context === "admin" ? `/admin/properties/${propertyId}` : `/owner/properties/${propertyId}`;

  useEffect(() => { loadMonth().catch((caught: Error) => setError(caught.message)); }, [activeGuestType, activeMonth, propertyId]);
  useEffect(() => {
    setStoredQuickPrices(readStoredQuickPrices(propertyId));
  }, [propertyId]);
  useEffect(() => {
    fetch("/api/backend/site-settings/public")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((settings: Record<string, string>) => {
        const minimum = Number(settings["pricing.minPrice"] ?? 0);
        const maximum = Number(settings["pricing.maxPrice"] ?? 1_000_000_000);
        setPriceBounds({ minimum: Number.isFinite(minimum) ? minimum : 0, maximum: Number.isFinite(maximum) ? maximum : 1_000_000_000 });
        setCurrencyLabel(settings["pricing.currencyLabel"] ?? "");
      })
      .catch(() => undefined);
  }, []);

  async function loadMonth() {
    setLoading(true);
    setError("");
    try {
      const from = toIso(monthDays[0]);
      const to = toIso(monthDays[monthDays.length - 1]);
      setPricing(await apiRequest<PropertyPricingResponse>(`/owner/properties/${propertyId}/pricing?from=${from}&to=${to}&guestType=${activeGuestType}`));
      setMessage("");
    } finally { setLoading(false); }
  }

  function getCellValue(rowId: string | number, date: string) {
    return rows.find((row) => String(row.id) === String(rowId))?.days.find((day) => day.date === date) ?? { id: null, roomTypeId: Number(rowId), date, guestType: activeGuestType, basePrice: 0, childPrice: 0, extraGuestPrice: 0 };
  }

  async function applyPrices(payload: CalendarRangeApplyPayload) {
    const updated = await apiRequest<RoomDailyPriceResponse[]>(`/owner/properties/${propertyId}/pricing/bulk-cells`, {
      method: "POST",
      body: JSON.stringify({
        items: payload.items.map((item) => ({ roomTypeId: Number(item.rowId), date: item.date })),
        guestType: activeGuestType,
        basePrice: payload.basePrice ?? 0,
        childPrice: payload.childPrice ?? 0,
        extraGuestPrice: payload.extraGuestPrice ?? 0,
      }),
    });
    const updateMap = new Map(updated.map((item) => [cellKey(item.roomTypeId, item.date), item]));
    setPricing((current) => current && ({ ...current, guestType: activeGuestType, roomTypes: current.roomTypes.map((roomType) => ({ ...roomType, days: roomType.days.map((day) => updateMap.get(cellKey(roomType.roomTypeId, day.date)) ?? day) })) }));
    const nextQuickPrices = uniqueRecentPrices([payload.basePrice ?? 0, ...storedQuickPrices]);
    setStoredQuickPrices(nextQuickPrices);
    writeStoredQuickPrices(propertyId, nextQuickPrices);
    setMessage("قیمت‌ها با موفقیت ذخیره شدند.");
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setError("");
    try {
      setHistory(await apiRequest<RoomDailyPriceHistoryResponse[]>(`/owner/properties/${propertyId}/pricing/history?guestType=${activeGuestType}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "سوابق قیمت بارگذاری نشد.");
    } finally {
      setHistoryLoading(false);
    }
  }

  function confirmOutlierPrice(payload: CalendarRangeApplyPayload) {
    const nextPrice = payload.basePrice ?? 0;
    if (!isOutlierPrice(nextPrice, propertyPriceBounds)) return true;
    return window.confirm("این قیمت نسبت به قیمت‌های این اقامتگاه غیرعادی است. آیا از ثبت آن مطمئن هستید؟");
  }

  const monthTitle = monthStart.locale("fa").format("MMMM YYYY");
  const activeGuestTab = pricingGuestTabs.find((tab) => tab.value === activeGuestType) ?? pricingGuestTabs[0];
  function changeGuestType(nextGuestType: PricingGuestType) {
    if (nextGuestType === activeGuestType) return;
    setActiveGuestType(nextGuestType);
    setPricing(null);
    setHistory([]);
    setHistoryOpen(false);
    setError("");
    setMessage("");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(pricingGuestTypeStorageKey, nextGuestType);
    }
  }
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-black">مدیریت قیمت روزانه</h2><p className="mt-1 text-sm text-slate-500">روزها و اتاق‌ها را انتخاب کنید و نرخ‌ها را به‌صورت گروهی تغییر دهید.</p></div>
        <div className="flex items-center gap-2">
          <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" onClick={openHistory} type="button">مشاهده سوابق</button>
          <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => setActiveMonth(monthStart.subtract(1, "month").format("YYYY-MM"))} type="button">ماه قبل</button>
          <strong className="min-w-32 rounded-xl bg-slate-50 px-4 py-2 text-center">{monthTitle}</strong>
          <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => setActiveMonth(monthStart.add(1, "month").format("YYYY-MM"))} type="button">ماه بعد</button>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-2" dir="rtl">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {pricingGuestTabs.map((tab) => (
            <button
              className={`rounded-lg px-5 py-2 text-sm font-black transition ${
                activeGuestType === tab.value
                  ? "bg-[var(--theme-primary)] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
              key={tab.value}
              onClick={() => changeGuestType(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-xs font-bold text-slate-500">{activeGuestTab.description}</p>
      </div>
      {loading && <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">در حال بارگذاری قیمت‌ها...</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <PricingSettingsWarning className="mt-5" editHref={propertyEditHref} warnings={pricingWarnings} />
      <div className="mt-5">
        <CalendarRangeGridEditor
          days={gridDays}
          disabledDateResolver={(date) => dayjs(date).isBefore(dayjs().startOf("day"), "day")}
          error={error}
          getCellValue={getCellValue}
          confirmApplyRange={confirmOutlierPrice}
          message={message}
          mode="pricing"
          onApplyRange={applyPrices}
          pricingCurrencyLabel={currencyLabel}
          pricingMaxValue={priceBounds.maximum}
          pricingMinValue={priceBounds.minimum}
          quickPricePresets={quickPricePresets}
          pricingValueResolver={(day) => ({
            basePrice: day.basePrice,
            childPrice: day.childPrice,
            extraGuestPrice: day.extraGuestPrice,
          })}
          renderCell={(_row, _date, day, state) => (
            <div
              className={`grid h-full place-items-center px-1 text-[11px] font-black ${
                state.disabled
                  ? "bg-slate-100 text-slate-400"
                  : state.selected
                    ? "bg-[var(--theme-primary-light)]"
                    : "bg-[var(--theme-surface-muted)]"
              }`}
            >
              {formatPrice(day.basePrice)}
            </div>
          )}
          rows={rows}
          key={activeGuestType}
          valueInputType="number"
          valueLabel="نرخ اتاق"
        />
      </div>

      {historyOpen && (
        <div className="fixed inset-0 z-50" dir="rtl">
          <button aria-label="بستن سوابق" className="absolute inset-0 h-full w-full cursor-default bg-slate-950/60 backdrop-blur-[2px]" onClick={() => setHistoryOpen(false)} type="button" />
          <section className="absolute inset-x-3 top-1/2 mx-auto max-h-[86vh] max-w-5xl -translate-y-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h3 className="text-xl font-black text-slate-950">سوابق تغییر قیمت</h3>
                <p className="mt-1 text-sm text-slate-500">آخرین تغییرات قیمت اتاق‌ها، جدیدترین در ابتدا.</p>
              </div>
              <button className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={() => setHistoryOpen(false)} type="button">×</button>
            </div>
            <div className="max-h-[calc(86vh-92px)] overflow-auto p-5">
              {historyLoading ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">در حال بارگذاری سوابق...</p>
              ) : history.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">هنوز سابقه‌ای ثبت نشده است.</p>
              ) : (
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-right text-xs font-black text-slate-500">
                      <th className="border border-slate-200 p-3">تاریخ</th>
                      <th className="border border-slate-200 p-3">کاربر</th>
                      <th className="border border-slate-200 p-3">قیمت قبلی</th>
                      <th className="border border-slate-200 p-3">قیمت جدید</th>
                      <th className="border border-slate-200 p-3">بازه تاریخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr className="text-slate-700" key={item.id}>
                        <td className="border border-slate-200 p-3 font-bold">{formatDateTime(item.dateTime)}</td>
                        <td className="border border-slate-200 p-3">{item.user}</td>
                        <td className="border border-slate-200 p-3">{formatPrice(item.oldPrice)} {currencyLabel}</td>
                        <td className="border border-slate-200 p-3 font-black text-blue-700">{formatPrice(item.newPrice)} {currencyLabel}</td>
                        <td className="border border-slate-200 p-3">
                          <span className="font-bold">{item.roomName}</span>
                          <span className="mx-2 text-slate-300">|</span>
                          {formatIsoDate(item.affectedStartDate)}
                          {item.affectedStartDate !== item.affectedEndDate && ` تا ${formatIsoDate(item.affectedEndDate)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
