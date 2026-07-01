"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  PricingGuestType,
  PropertyPricingResponse,
  PropertyResponse,
  RoomDailyPriceHistoryResponse,
  RoomDailyPriceResponse,
} from "@/lib/owner-api";
import {
  CalendarGridDay,
  CalendarGridRow,
  CalendarRangeApplyPayload,
  CalendarRangeGridEditor,
} from "@/components/CalendarRangeGridEditor";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import {
  getPropertyFinancialWarnings,
  getPropertyPriceBounds,
  isOutlierPrice,
  PricingSettingsWarning,
} from "@/components/pricing/PricingWarnings";

dayjs.extend(jalaliday);

type PricingRow = CalendarGridRow & {
  roomTypeId: number;
  days: RoomDailyPriceResponse[];
};

function jalaliMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return dayjs()
    .calendar("jalali")
    .year(year)
    .month(monthNumber - 1)
    .date(1)
    .startOf("day");
}
function toIso(date: Dayjs) {
  return date.calendar("gregory").format("YYYY-MM-DD");
}
function cellKey(roomTypeId: number, date: string) {
  return `${roomTypeId}|${date}`;
}
function formatPrice(value: number) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(
    value,
  );
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
function formatIsoDate(value: string) {
  return dayjs(value).calendar("jalali").locale("fa").format("YYYY/MM/DD");
}
function formatPriceWithCurrency(value: number, currencyLabel: string) {
  return `${formatPrice(value)}${currencyLabel ? ` ${currencyLabel}` : ""}`;
}

const pricingGuestTypeStorageKey = "kooch:owner-pricing-guest-type";
const maxQuickPrices = 6;
const pricingGuestTabs: {
  value: PricingGuestType;
  label: string;
  description: string;
}[] = [
  {
    value: "Iranian",
    label: "ایرانی",
    description: "قیمت روزانه برای مهمانان ایرانی",
  },
  {
    value: "Foreign",
    label: "خارجی",
    description: "قیمت روزانه برای مهمانان خارجی",
  },
];

const pricingGuestTypeLabels: Record<PricingGuestType, string> = {
  Iranian: "ایرانی",
  Foreign: "خارجی",
};

function PriceHistoryValues({
  basePrice,
  currencyLabel,
}: {
  basePrice: number;
  currencyLabel: string;
}) {
  return <span>{formatPriceWithCurrency(basePrice, currencyLabel)}</span>;
}

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
    if (!Number.isFinite(normalized) || normalized <= 0 || seen.has(normalized))
      continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxQuickPrices) break;
  }
  return result;
}

function readStoredQuickPrices(propertyId: number) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(quickPriceStorageKey(propertyId)) ?? "[]",
    );
    return Array.isArray(parsed)
      ? uniqueRecentPrices(parsed.map((item) => Number(item)))
      : [];
  } catch {
    return [];
  }
}

function writeStoredQuickPrices(propertyId: number, prices: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    quickPriceStorageKey(propertyId),
    JSON.stringify(uniqueRecentPrices(prices)),
  );
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

function historyRecentPrices(history: RoomDailyPriceHistoryResponse[]) {
  return uniqueRecentPrices(history.map((item) => item.newBasePrice));
}

export function OwnerPricingGrid({
  context = "owner",
  propertyId,
}: {
  context?: "admin" | "owner";
  propertyId: number;
}) {
  const [activeMonth, setActiveMonth] = useState(() =>
    dayjs().calendar("jalali").format("YYYY-MM"),
  );
  const [activeGuestType, setActiveGuestType] =
    useState<PricingGuestType>(readStoredGuestType);
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [pricing, setPricing] = useState<PropertyPricingResponse | null>(null);
  const [priceBounds, setPriceBounds] = useState({
    minimum: 0,
    maximum: 1_000_000_000,
  });
  const [currencyLabel, setCurrencyLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<RoomDailyPriceHistoryResponse[]>([]);
  const [quickPriceHistory, setQuickPriceHistory] = useState<
    RoomDailyPriceHistoryResponse[]
  >([]);
  const [storedQuickPrices, setStoredQuickPrices] = useState<number[]>([]);
  const [outlierDialogOpen, setOutlierDialogOpen] = useState(false);
  const outlierResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const monthStart = useMemo(
    () => jalaliMonthStart(activeMonth),
    [activeMonth],
  );
  const monthDays = useMemo(
    () =>
      Array.from({ length: monthStart.daysInMonth() }, (_, index) =>
        monthStart.add(index, "day"),
      ),
    [monthStart],
  );
  const gridDays = useMemo<CalendarGridDay[]>(
    () =>
      monthDays.map((date) => {
        const iso = toIso(date);
        return {
          date: iso,
          label: date.locale("fa").format("D"),
          weekday: date.locale("fa").format("ddd"),
          isToday: iso === dayjs().format("YYYY-MM-DD"),
        };
      }),
    [monthDays],
  );
  const rows = useMemo<PricingRow[]>(
    () =>
      pricing?.roomTypes.map((roomType) => ({
        id: roomType.roomTypeId,
        roomTypeId: roomType.roomTypeId,
        label: roomType.name,
        days: roomType.days,
      })) ?? [],
    [pricing],
  );
  const quickPricePresets = useMemo(
    () =>
      uniqueRecentPrices([
        ...storedQuickPrices,
        ...historyRecentPrices(quickPriceHistory),
        ...pricingRecentPrices(pricing),
      ]),
    [pricing, quickPriceHistory, storedQuickPrices],
  );
  const pricingWarnings = useMemo(
    () => getPropertyFinancialWarnings(property),
    [property],
  );
  const propertyPriceBounds = useMemo(
    () => getPropertyPriceBounds(pricing),
    [pricing],
  );
  const propertyEditHref =
    context === "admin"
      ? `/admin/properties/${propertyId}?step=7`
      : `/owner/properties/${propertyId}?step=7`;

  useEffect(() => {
    loadMonth().catch((caught: Error) => setError(caught.message));
  }, [activeGuestType, activeMonth, propertyId]);
  useEffect(() => {
    apiRequest<PropertyResponse>(
      context === "admin"
        ? `/admin/properties/${propertyId}`
        : `/owner/properties/${propertyId}`,
    )
      .then(setProperty)
      .catch(() => setProperty(null));
  }, [context, propertyId]);
  useEffect(() => {
    setStoredQuickPrices(readStoredQuickPrices(propertyId));
  }, [propertyId]);
  useEffect(() => {
    let active = true;
    apiRequest<RoomDailyPriceHistoryResponse[]>(
      `/owner/properties/${propertyId}/pricing/history`,
    )
      .then((items) => {
        if (active) setQuickPriceHistory(items);
      })
      .catch(() => {
        if (active) setQuickPriceHistory([]);
      });
    return () => {
      active = false;
    };
  }, [propertyId]);
  useEffect(() => {
    fetch("/api/backend/site-settings/public")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((settings: Record<string, string>) => {
        const minimum = Number(settings["pricing.minPrice"] ?? 0);
        const maximum = Number(settings["pricing.maxPrice"] ?? 1_000_000_000);
        setPriceBounds({
          minimum: Number.isFinite(minimum) ? minimum : 0,
          maximum: Number.isFinite(maximum) ? maximum : 1_000_000_000,
        });
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
      setPricing(
        await apiRequest<PropertyPricingResponse>(
          `/owner/properties/${propertyId}/pricing?from=${from}&to=${to}&guestType=${activeGuestType}`,
        ),
      );
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  function getCellValue(rowId: string | number, date: string) {
    return (
      rows
        .find((row) => String(row.id) === String(rowId))
        ?.days.find((day) => day.date === date) ?? {
        id: null,
        roomTypeId: Number(rowId),
        date,
        guestType: activeGuestType,
        basePrice: 0,
      }
    );
  }

  async function applyPrices(payload: CalendarRangeApplyPayload) {
    const updated = await apiRequest<RoomDailyPriceResponse[]>(
      `/owner/properties/${propertyId}/pricing/bulk-cells`,
      {
        method: "POST",
        body: JSON.stringify({
          items: payload.items.map((item) => ({
            roomTypeId: Number(item.rowId),
            date: item.date,
          })),
          guestType: activeGuestType,
          basePrice: payload.basePrice ?? 0,
        }),
      },
    );
    const updateMap = new Map(
      updated.map((item) => [cellKey(item.roomTypeId, item.date), item]),
    );
    setPricing(
      (current) =>
        current && {
          ...current,
          guestType: activeGuestType,
          roomTypes: current.roomTypes.map((roomType) => ({
            ...roomType,
            days: roomType.days.map(
              (day) =>
                updateMap.get(cellKey(roomType.roomTypeId, day.date)) ?? day,
            ),
          })),
        },
    );
    const nextQuickPrices = uniqueRecentPrices([
      payload.basePrice ?? 0,
      ...storedQuickPrices,
    ]);
    setStoredQuickPrices(nextQuickPrices);
    writeStoredQuickPrices(propertyId, nextQuickPrices);
    setQuickPriceHistory((current) =>
      payload.basePrice == null
        ? current
        : [
            {
              id: -Date.now(),
              propertyId,
              roomId: Number(payload.rowId),
              roomName: "",
              guestType: activeGuestType,
              affectedDateFrom: payload.startDate,
              affectedDateTo: payload.endDate,
              oldBasePrice: 0,
              newBasePrice: payload.basePrice,
              oldChildPrice: 0,
              newChildPrice: 0,
              oldExtraGuestPrice: 0,
              newExtraGuestPrice: 0,
              changedByUserId: 0,
              user: "",
              dateTime: new Date().toISOString(),
            },
            ...current,
          ],
    );
    setMessage("قیمت‌ها با موفقیت ذخیره شدند.");
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setError("");
    try {
      setHistory(
        await apiRequest<RoomDailyPriceHistoryResponse[]>(
          `/owner/properties/${propertyId}/pricing/history`,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "سوابق قیمت بارگذاری نشد.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function resolveOutlierConfirmation(confirmed: boolean) {
    outlierResolverRef.current?.(confirmed);
    outlierResolverRef.current = null;
    setOutlierDialogOpen(false);
  }

  function confirmOutlierPrice(payload: CalendarRangeApplyPayload) {
    const nextPrice = payload.basePrice ?? 0;
    if (!isOutlierPrice(nextPrice, propertyPriceBounds)) return true;
    return new Promise<boolean>((resolve) => {
      outlierResolverRef.current = resolve;
      setOutlierDialogOpen(true);
    });
  }

  const monthTitle = monthStart.locale("fa").format("MMMM YYYY");
  const activeGuestTab =
    pricingGuestTabs.find((tab) => tab.value === activeGuestType) ??
    pricingGuestTabs[0];
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
    <KoochCard className="min-w-0" variant="elevated">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-foreground">
            مدیریت قیمت روزانه
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            روزها و اتاق‌ها را انتخاب کنید و نرخ‌ها را به‌صورت گروهی تغییر دهید.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <KoochButton
            onClick={openHistory}
            size="sm"
            type="button"
            variant="outline"
          >
            مشاهده سوابق تغییر قیمت
          </KoochButton>
          <KoochButton
            onClick={() =>
              setActiveMonth(monthStart.subtract(1, "month").format("YYYY-MM"))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            ماه قبل
          </KoochButton>
          <strong className="min-w-32 rounded-xl bg-muted px-4 py-2 text-center text-foreground">
            {monthTitle}
          </strong>
          <KoochButton
            onClick={() =>
              setActiveMonth(monthStart.add(1, "month").format("YYYY-MM"))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            ماه بعد
          </KoochButton>
        </div>
      </div>
      <div
        className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted p-2"
        dir="rtl"
      >
        <div className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
          {pricingGuestTabs.map((tab) => (
            <button
              className={`rounded-lg px-5 py-2 text-sm font-black transition ${
                activeGuestType === tab.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              key={tab.value}
              onClick={() => changeGuestType(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-xs font-bold text-muted-foreground">
          {activeGuestTab.description}
        </p>
      </div>
      {loading && (
        <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
          در حال بارگذاری قیمت‌ها...
        </p>
      )}
      {error && (
        <p className="mt-5 rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <PricingSettingsWarning
        className="mt-5"
        editHref={propertyEditHref}
        warnings={pricingWarnings}
      />
      {pricingWarnings.length === 0 && property && (
        <KoochAlert
          className="mt-5"
          dir="rtl"
          title="قوانین قیمت مهمانان"
          variant="success"
        >
          <div className="flex flex-wrap gap-4">
            <span>
              نرخ کودک:{" "}
              {formatPriceWithCurrency(property.childPrice ?? 0, currencyLabel)}
            </span>
            <span>
              نرخ نفر اضافه:{" "}
              {formatPriceWithCurrency(
                property.extraGuestPrice ?? 0,
                currencyLabel,
              )}
            </span>
          </div>
        </KoochAlert>
      )}
      <div className="mt-5">
        <CalendarRangeGridEditor
          days={gridDays}
          disabledDateResolver={(date) =>
            dayjs(date).isBefore(dayjs().startOf("day"), "day")
          }
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
          })}
          renderCell={(_row, _date, day, state) => (
            <div
              className={`grid h-full place-items-center px-1 text-[11px] font-black ${
                state.disabled
                  ? "bg-muted text-muted-foreground"
                  : state.selected
                    ? "bg-primary/15 text-foreground"
                    : "bg-muted text-foreground"
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

      <KoochDialog
        description="آخرین تغییرات قیمت اتاق‌ها، جدیدترین در ابتدا."
        footer={
          <KoochButton onClick={() => setHistoryOpen(false)} variant="outline">
            بستن
          </KoochButton>
        }
        onOpenChange={setHistoryOpen}
        open={historyOpen}
        size="xl"
        title="سوابق تغییر قیمت"
      >
        <KoochTable>
          <KoochTableHeader>
            <KoochTableRow>
              <KoochTableHead>تاریخ تغییر</KoochTableHead>
              <KoochTableHead>کاربر</KoochTableHead>
              <KoochTableHead>اتاق</KoochTableHead>
              <KoochTableHead>نوع مهمان</KoochTableHead>
              <KoochTableHead>بازه تاریخ</KoochTableHead>
              <KoochTableHead>قیمت قبلی</KoochTableHead>
              <KoochTableHead>قیمت جدید</KoochTableHead>
            </KoochTableRow>
          </KoochTableHeader>
          <KoochTableBody>
            {historyLoading ? (
              <KoochTableEmpty colSpan={7}>
                در حال بارگذاری سوابق...
              </KoochTableEmpty>
            ) : history.length === 0 ? (
              <KoochTableEmpty colSpan={7}>
                هنوز سابقه‌ای ثبت نشده است.
              </KoochTableEmpty>
            ) : (
              history.map((item) => (
                <KoochTableRow key={item.id}>
                  <KoochTableCell className="font-bold">
                    {formatDateTime(item.dateTime)}
                  </KoochTableCell>
                  <KoochTableCell>{item.user}</KoochTableCell>
                  <KoochTableCell>{item.roomName}</KoochTableCell>
                  <KoochTableCell>
                    <KoochBadge
                      variant={
                        item.guestType === "Foreign" ? "warning" : "default"
                      }
                    >
                      {pricingGuestTypeLabels[item.guestType]}
                    </KoochBadge>
                  </KoochTableCell>
                  <KoochTableCell>
                    {formatIsoDate(item.affectedDateFrom)}
                    {item.affectedDateFrom !== item.affectedDateTo &&
                      ` تا ${formatIsoDate(item.affectedDateTo)}`}
                  </KoochTableCell>
                  <KoochTableCell>
                    <PriceHistoryValues
                      basePrice={item.oldBasePrice}
                      currencyLabel={currencyLabel}
                    />
                  </KoochTableCell>
                  <KoochTableCell className="font-black text-primary">
                    <PriceHistoryValues
                      basePrice={item.newBasePrice}
                      currencyLabel={currencyLabel}
                    />
                  </KoochTableCell>
                </KoochTableRow>
              ))
            )}
          </KoochTableBody>
        </KoochTable>
      </KoochDialog>

      <KoochConfirmDialog
        cancelText="انصراف"
        confirmText="بله، ثبت شود"
        description="این قیمت نسبت به قیمت‌های این اقامتگاه غیرعادی است. آیا از ثبت آن مطمئن هستید؟"
        onConfirm={() => resolveOutlierConfirmation(true)}
        onOpenChange={(open) => {
          if (!open) resolveOutlierConfirmation(false);
          else setOutlierDialogOpen(true);
        }}
        open={outlierDialogOpen}
        title="قیمت غیرعادی"
        variant="warning"
      />
    </KoochCard>
  );
}
