"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiRequest,
  CopyRoomDailyPriceRequest,
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
import RoomPricingMatrixEditor from "@/components/pricing/RoomPricingMatrixEditor";
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

type CopyPricingDirection = "IranianToForeign" | "ForeignToIranian";

const copyPricingDirectionOptions: {
  value: CopyPricingDirection;
  label: string;
  source: PricingGuestType;
  destination: PricingGuestType;
}[] = [
  {
    value: "IranianToForeign",
    label: "از ایرانی به خارجی",
    source: "Iranian",
    destination: "Foreign",
  },
  {
    value: "ForeignToIranian",
    label: "از خارجی به ایرانی",
    source: "Foreign",
    destination: "Iranian",
  },
];

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
  const router = useRouter();
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
  const [bulkReviewDialogOpen, setBulkReviewDialogOpen] = useState(false);
  const [bulkReviewPayload, setBulkReviewPayload] =
    useState<CalendarRangeApplyPayload | null>(null);
  const bulkReviewResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyPayload, setCopyPayload] =
    useState<CalendarRangeApplyPayload | null>(null);
  const [copyDirection, setCopyDirection] =
    useState<CopyPricingDirection>("IranianToForeign");
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [usePricingMatrix, setUsePricingMatrix] = useState(false);
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
  const roomsHref =
    context === "admin"
      ? `/admin/properties/${propertyId}/rooms`
      : `/owner/properties/${propertyId}/rooms`;
  const hasLoadedPricing = pricing !== null;
  const hasRooms = rows.length > 0;
  const hasPriceInSelectedRange = rows.some((row) =>
    row.days.some((day) => day.id != null && Number(day.basePrice) > 0),
  );
  const shouldShowNoRoomsState = hasLoadedPricing && !hasRooms;
  const shouldShowNoPricingWarning =
    hasLoadedPricing && hasRooms && !hasPriceInSelectedRange;

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
    // setMessage("قیمت‌ها با موفقیت ذخیره شدند.");
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

  function getBulkReviewDetails(payload: CalendarRangeApplyPayload | null) {
    if (!payload) {
      return {
        affectedDays: 0,
        dateRangeLabel: "-",
        priceLabel: "-",
        rangeCount: 0,
        roomNames: "-",
      };
    }
    const selectedRoomIds = new Set(
      payload.items.map((item) => String(item.rowId)),
    );
    const selectedDates = Array.from(
      new Set(payload.items.map((item) => item.date)),
    ).sort();
    const roomNames = rows
      .filter((row) => selectedRoomIds.has(String(row.id)))
      .map((row) => row.label);
    const firstDate = selectedDates[0] ?? payload.startDate;
    const lastDate = selectedDates[selectedDates.length - 1] ?? payload.endDate;

    return {
      affectedDays: selectedDates.length,
      dateRangeLabel:
        firstDate === lastDate
          ? formatIsoDate(firstDate)
          : `${formatIsoDate(firstDate)} تا ${formatIsoDate(lastDate)}`,
      priceLabel: formatPriceWithCurrency(
        payload.basePrice ?? 0,
        currencyLabel,
      ),
      rangeCount: payload.selectionRangeCount ?? 1,
      roomNames: roomNames.length > 0 ? roomNames.join("، ") : "-",
    };
  }

  function shouldReviewBulkApply(payload: CalendarRangeApplyPayload) {
    const affectedDays = new Set(payload.items.map((item) => item.date)).size;
    return affectedDays > 14 || (payload.selectionRangeCount ?? 1) > 3;
  }

  function resolveBulkReviewConfirmation(confirmed: boolean) {
    bulkReviewResolverRef.current?.(confirmed);
    bulkReviewResolverRef.current = null;
    setBulkReviewDialogOpen(false);
    setBulkReviewPayload(null);
  }

  function confirmBulkReview(payload: CalendarRangeApplyPayload) {
    if (!shouldReviewBulkApply(payload)) return true;
    return new Promise<boolean>((resolve) => {
      bulkReviewResolverRef.current = resolve;
      setBulkReviewPayload(payload);
      setBulkReviewDialogOpen(true);
    });
  }

  async function confirmPriceApply(payload: CalendarRangeApplyPayload) {
    const outlierConfirmed = await confirmOutlierPrice(payload);
    if (!outlierConfirmed) return false;
    return confirmBulkReview(payload);
  }

  function openCopyPricingDialog(payload: CalendarRangeApplyPayload) {
    setCopyPayload(payload);
    setCopyError("");
    setCopyDirection(
      activeGuestType === "Iranian" ? "IranianToForeign" : "ForeignToIranian",
    );
    setCopyDialogOpen(true);
  }

  async function confirmCopyPricing() {
    if (!copyPayload) return;
    const direction =
      copyPricingDirectionOptions.find(
        (option) => option.value === copyDirection,
      ) ?? copyPricingDirectionOptions[0];
    const request: CopyRoomDailyPriceRequest = {
      sourceGuestType: direction.source,
      destinationGuestType: direction.destination,
      items: copyPayload.items.map((item) => ({
        roomTypeId: Number(item.rowId),
        date: item.date,
      })),
    };

    setCopyLoading(true);
    setCopyError("");
    try {
      const updated = await apiRequest<RoomDailyPriceResponse[]>(
        `/owner/properties/${propertyId}/pricing/copy`,
        {
          method: "POST",
          body: JSON.stringify(request),
        },
      );
      if (direction.destination === activeGuestType) {
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
                    updateMap.get(cellKey(roomType.roomTypeId, day.date)) ??
                    day,
                ),
              })),
            },
        );
      }
      setMessage(
        updated.length > 0
          ? "کپی قیمت‌ها با موفقیت انجام شد."
          : "برای بازه انتخاب‌شده قیمت روزانه‌ای در مبدا پیدا نشد.",
      );
      toast.success(
        updated.length > 0
          ? "کپی قیمت‌ها با موفقیت انجام شد."
          : "برای بازه انتخاب‌شده قیمت روزانه‌ای در مبدا پیدا نشد.",
      );
      setCopyDialogOpen(false);
      setCopyPayload(null);
    } catch (caught) {
      setCopyError(
        caught instanceof Error ? caught.message : "کپی قیمت‌ها انجام نشد.",
      );
      toast.error(
        caught instanceof Error ? caught.message : "کپی قیمت‌ها انجام نشد.",
        { id: "pricing-copy-error" },
      );
      throw caught;
    } finally {
      setCopyLoading(false);
    }
  }

  const monthTitle = monthStart.locale("fa").format("MMMM YYYY");
  const activeGuestTab =
    pricingGuestTabs.find((tab) => tab.value === activeGuestType) ??
    pricingGuestTabs[0];
  const bulkReviewDetails = getBulkReviewDetails(bulkReviewPayload);
  const copyReviewDetails = getBulkReviewDetails(copyPayload);
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
    <KoochCard
      className="min-w-0 max-w-full overflow-hidden"
      variant="elevated"
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-foreground">
            مدیریت قیمت روزانه
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            روزها و اتاق‌ها را انتخاب کنید و نرخ‌ها را به‌صورت گروهی تغییر دهید.
          </p>
        </div>

        <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <KoochButton
            className="w-full sm:w-auto"
            onClick={openHistory}
            size="sm"
            type="button"
            variant="outline"
          >
            مشاهده سوابق تغییر قیمت
          </KoochButton>

          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <KoochButton
              className="w-full sm:w-auto"
              onClick={() =>
                setActiveMonth(
                  monthStart.subtract(1, "month").format("YYYY-MM"),
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              ماه قبل
            </KoochButton>

            <strong className="min-w-0 rounded-lg bg-muted px-3 py-2 text-center text-sm text-foreground sm:min-w-32">
              {monthTitle}
            </strong>

            <KoochButton
              className="w-full sm:w-auto"
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

          <KoochButton
            className="w-full sm:w-auto"
            onClick={() => setUsePricingMatrix((s) => !s)}
            size="sm"
            type="button"
            variant={usePricingMatrix ? "primary" : "outline"}
          >
            {usePricingMatrix ? "برگشت به جدول قبلی" : "نمایش جدول آزمایشی"}
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
      {shouldShowNoRoomsState ? (
        <KoochCard
          className="mt-5 flex flex-col items-center justify-center gap-4 border-dashed py-10 text-center"
          padding="lg"
        >
          <div>
            <h3 className="text-lg font-black text-foreground">
              ابتدا باید برای این اقامتگاه اتاق تعریف کنید.
            </h3>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">
              بعد از ساخت اتاق‌ها می‌توانید قیمت روزانه را برای هر اتاق ثبت
              کنید.
            </p>
          </div>
          <KoochButton
            onClick={() => router.push(roomsHref)}
            type="button"
            variant="primary"
          >
            رفتن به مدیریت اتاق‌ها
          </KoochButton>
        </KoochCard>
      ) : (
        <>
          {shouldShowNoPricingWarning && (
            <KoochAlert
              className="mt-5"
              dir="rtl"
              title="قیمت ثبت نشده"
              variant="warning"
            >
              هنوز قیمتی برای این اقامتگاه ثبت نشده است.
            </KoochAlert>
          )}
          {shouldShowNoPricingWarning && (
            <p className="mt-3 rounded-xl border border-border bg-muted px-4 py-3 text-right text-sm font-semibold text-muted-foreground">
              برای این بازه هنوز قیمتی ثبت نشده است.
            </p>
          )}
          <div className="mt-5">
            {usePricingMatrix ? (
              <RoomPricingMatrixEditor
                rows={rows}
                days={gridDays}
                getCellValue={getCellValue}
                onApplyRange={applyPrices}
                pricingCurrencyLabel={currencyLabel}
                pricingMaxValue={priceBounds.maximum}
                pricingMinValue={priceBounds.minimum}
                quickPricePresets={quickPricePresets}
                pricingValueResolver={(day) => ({ basePrice: day.basePrice })}
                pricingCellSize="w-28 h-12"
                dayColumnSize="w-36"
                disabledDateResolver={(date) =>
                  dayjs(date).isBefore(dayjs().startOf("day"), "day")
                }
                childPrice={property?.childPrice}
                extraGuestPrice={property?.extraGuestPrice}
              />
            ) : (
              <CalendarRangeGridEditor
                days={gridDays}
                disabledDateResolver={(date) =>
                  dayjs(date).isBefore(dayjs().startOf("day"), "day")
                }
                error={error}
                getCellValue={getCellValue}
                confirmApplyRange={confirmPriceApply}
                message={message}
                mode="pricing"
                onApplyRange={applyPrices}
                onCopyPricing={openCopyPricingDialog}
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
                          ? "bg-[var(--theme-primary-soft)] text-foreground"
                          : "bg-light text-foreground"
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
            )}
          </div>
        </>
      )}

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
        cancelText="لغو"
        confirmText="کپی قیمت‌ها"
        description="قیمت‌های روزانه مبدا برای اتاق‌ها و بازه انتخاب‌شده روی نوع مهمان مقصد کپی می‌شود."
        disabled={!copyPayload}
        loading={copyLoading}
        onConfirm={confirmCopyPricing}
        onOpenChange={(open) => {
          setCopyDialogOpen(open);
          if (!open) {
            setCopyPayload(null);
            setCopyError("");
          }
        }}
        open={copyDialogOpen}
        title="کپی قیمت‌ها"
        variant="warning"
      >
        <div className="space-y-4">
          <KoochAlert title="فقط قیمت روزانه کپی می‌شود" variant="warning">
            پروموشن‌ها، کوپن‌ها و قیمت‌های مبدا تغییر نمی‌کنند.
          </KoochAlert>
          {copyError && (
            <KoochAlert title="کپی انجام نشد" variant="destructive">
              {copyError}
            </KoochAlert>
          )}
          <div className="grid gap-2">
            {copyPricingDirectionOptions.map((option) => (
              <KoochButton
                className="justify-start"
                key={option.value}
                onClick={() => setCopyDirection(option.value)}
                type="button"
                variant={copyDirection === option.value ? "primary" : "outline"}
              >
                {option.label}
              </KoochButton>
            ))}
          </div>
          <dl className="grid gap-3 rounded-lg border border-border bg-muted p-3 text-right text-sm">
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">اتاق‌ها</dt>
              <dd className="font-black text-foreground">
                {copyReviewDetails.roomNames}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">بازه تاریخ</dt>
              <dd className="font-black text-foreground">
                {copyReviewDetails.dateRangeLabel}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">
                تعداد روزهای اثرگرفته
              </dt>
              <dd className="font-black text-foreground">
                {formatPrice(copyReviewDetails.affectedDays)} روز در{" "}
                {formatPrice(copyReviewDetails.rangeCount)} بازه
              </dd>
            </div>
          </dl>
        </div>
      </KoochConfirmDialog>

      <KoochConfirmDialog
        cancelText="لغو"
        confirmText="تایید و ذخیره"
        description="این تغییر روی تعداد زیادی روز یا بازه اعمال می‌شود. لطفا خلاصه را پیش از ذخیره بررسی کنید."
        onConfirm={() => resolveBulkReviewConfirmation(true)}
        onOpenChange={(open) => {
          if (!open) resolveBulkReviewConfirmation(false);
          else setBulkReviewDialogOpen(true);
        }}
        open={bulkReviewDialogOpen}
        title="بررسی تغییر گروهی قیمت"
        variant="warning"
      >
        <div className="space-y-4">
          <KoochAlert title="خلاصه تغییرات" variant="default">
            قیمت انتخاب‌شده بعد از تایید برای همه موارد زیر ثبت می‌شود.
          </KoochAlert>
          <dl className="grid gap-3 rounded-lg border border-border bg-muted p-3 text-right text-sm">
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">اتاق‌ها</dt>
              <dd className="font-black text-foreground">
                {bulkReviewDetails.roomNames}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">بازه تاریخ</dt>
              <dd className="font-black text-foreground">
                {bulkReviewDetails.dateRangeLabel}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">نوع مهمان</dt>
              <dd className="font-black text-foreground">
                {pricingGuestTypeLabels[activeGuestType]}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">مبلغ</dt>
              <dd className="font-black text-foreground">
                {bulkReviewDetails.priceLabel}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">
                تعداد روزهای اثرگرفته
              </dt>
              <dd className="font-black text-foreground">
                {formatPrice(bulkReviewDetails.affectedDays)} روز در{" "}
                {formatPrice(bulkReviewDetails.rangeCount)} بازه
              </dd>
            </div>
          </dl>
        </div>
      </KoochConfirmDialog>

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
