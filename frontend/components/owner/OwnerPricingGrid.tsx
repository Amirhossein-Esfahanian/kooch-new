"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiRequest,
  AvailabilityStatus,
  CopyRoomDailyPriceRequest,
  InventoryDayResponse,
  PricingGuestType,
  PropertyInventoryResponse,
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
  CalendarSelectionEditor,
} from "@/components/CalendarRangeGridEditor";
import RoomPricingMatrixEditor from "@/components/pricing/RoomPricingMatrixEditor";
import PricingBulkEditDialog, {
  PricingBulkEditPayload,
  PricingBulkRoom,
} from "@/components/pricing/PricingBulkEditDialog";
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
import { getCheckInCheckoutDates, parseLocalIsoDate } from "@/lib/date-utils";

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

function formatPlainNumber(value: number | string) {
  return new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: 0,
    useGrouping: false,
  }).format(Number(value));
}

function formatCalendarPrice(value: number) {
  return formatPrice(Math.round(value / 1000));
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
function getDatesInWeekdays(
  startDate: string,
  endDate: string,
  weekdays: PricingBulkEditPayload["weekdays"],
) {
  const dayIndexToWeekday = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ] as const;
  const selectedWeekdays = new Set<string>(weekdays);

  return getCheckInCheckoutDates(startDate, endDate).filter((date) =>
    selectedWeekdays.has(dayIndexToWeekday[parseLocalIsoDate(date).getDay()]),
  );
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

const pricingCalendarWeekdays = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
] as const;

type CompactSelectionMode = "range" | "single";

type CompactCalendarSelection = {
  mode: CompactSelectionMode;
  anchorDate: string | null;
  dates: string[];
};

const compactInventoryStatusOptions: {
  value: AvailabilityStatus;
  label: string;
}[] = [
  { value: "Available", label: "موجود" },
  { value: "OnRequest", label: "نیازمند استعلام" },
  { value: "Unavailable", label: "ناموجود" },
];

function datesBetween(startDate: string, endDate: string) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const first = start.isAfter(end, "day") ? end : start;
  const last = start.isAfter(end, "day") ? start : end;
  const result: string[] = [];
  let cursor = first;
  while (!cursor.isAfter(last, "day")) {
    result.push(cursor.format("YYYY-MM-DD"));
    cursor = cursor.add(1, "day");
  }
  return result;
}

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
  const hasSeparateForeignPricing =
    property?.hasSeparateForeignPricing === true;
  const pricingGuestType: PricingGuestType = hasSeparateForeignPricing
    ? activeGuestType
    : "Iranian";
  const [pricing, setPricing] = useState<PropertyPricingResponse | null>(null);
  const [inventory, setInventory] = useState<PropertyInventoryResponse | null>(
    null,
  );
  const [priceBounds, setPriceBounds] = useState({
    minimum: 0,
    maximum: 1_000_000_000,
  });
  const [currencyLabel, setCurrencyLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [guestPricingRulesOpen, setGuestPricingRulesOpen] = useState(false);
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
  const [usePricingCalendar, setUsePricingCalendar] = useState(false);
  const [calendarSelections, setCalendarSelections] = useState<
    Record<number, CompactCalendarSelection>
  >({});
  const [calendarActiveRoomId, setCalendarActiveRoomId] = useState<
    number | null
  >(null);
  const [calendarEditMode, setCalendarEditMode] = useState<
    "pricing" | "inventory"
  >("pricing");
  const [calendarEditorOpen, setCalendarEditorOpen] = useState(false);
  const [calendarPriceValue, setCalendarPriceValue] = useState<number>(
    Number.NaN,
  );
  const [calendarPriceMixed, setCalendarPriceMixed] = useState(false);
  const [calendarPriceSaving, setCalendarPriceSaving] = useState(false);
  const [calendarInventoryValue, setCalendarInventoryValue] = useState(1);
  const [calendarInventoryValueMixed, setCalendarInventoryValueMixed] =
    useState(false);
  const [calendarInventoryStatus, setCalendarInventoryStatus] =
    useState<AvailabilityStatus>("Available");
  const [calendarInventoryStatusMixed, setCalendarInventoryStatusMixed] =
    useState(false);
  const [calendarInventorySaving, setCalendarInventorySaving] = useState(false);
  const [calendarEditorError, setCalendarEditorError] = useState("");
  const [calendarInventoryConfirmOpen, setCalendarInventoryConfirmOpen] =
    useState(false);
  const [calendarInventoryConfirmPayload, setCalendarInventoryConfirmPayload] =
    useState<CalendarRangeApplyPayload | null>(null);
  const calendarInventoryConfirmResolverRef = useRef<
    ((confirmed: boolean) => void) | null
  >(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
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
  const inventoryRoomById = useMemo(
    () =>
      new Map(
        (inventory?.roomTypes ?? []).map((roomType) => [
          roomType.roomTypeId,
          roomType,
        ]),
      ),
    [inventory],
  );
  const pricingCalendarStartOffset = (monthStart.day() + 1) % 7;
  const bulkRooms = useMemo<PricingBulkRoom[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        label: row.label,
        basePrice: row.days.find((day) => Number(day.basePrice) > 0)?.basePrice,
      })),
    [rows],
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
    if (!property) return;
    loadMonth().catch((caught: Error) => setError(caught.message));
  }, [activeMonth, pricingGuestType, property, propertyId]);
  useEffect(() => {
    if (!usePricingCalendar) return;
    loadInventoryMonth().catch((caught: Error) =>
      setInventoryError(caught.message),
    );
  }, [activeMonth, propertyId, usePricingCalendar]);
  useEffect(() => {
    setCalendarSelections({});
    setCalendarActiveRoomId(null);
    setCalendarEditorOpen(false);
    setCalendarEditorError("");
  }, [activeMonth]);

  const viewMode = usePricingCalendar
    ? "calendar"
    : usePricingMatrix
      ? "table"
      : "default";
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
          `/owner/properties/${propertyId}/pricing?from=${from}&to=${to}&guestType=${pricingGuestType}`,
        ),
      );
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  async function loadInventoryMonth() {
    setInventoryLoading(true);
    setInventoryError("");
    try {
      const from = toIso(monthDays[0]);
      const to = toIso(monthDays[monthDays.length - 1]);
      setInventory(
        await apiRequest<PropertyInventoryResponse>(
          `/owner/properties/${propertyId}/inventory?from=${from}&to=${to}`,
        ),
      );
    } catch (caught) {
      setInventory(null);
      throw caught;
    } finally {
      setInventoryLoading(false);
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
        guestType: pricingGuestType,
        basePrice: 0,
      }
    );
  }

  function getCalendarSelection(roomTypeId: number) {
    return (
      calendarSelections[roomTypeId] ?? {
        mode: "range" as CompactSelectionMode,
        anchorDate: null,
        dates: [],
      }
    );
  }

  function setCalendarSelectionMode(
    roomTypeId: number,
    mode: CompactSelectionMode,
  ) {
    setCalendarActiveRoomId(roomTypeId);
    setCalendarEditMode("pricing");
    setCalendarEditorOpen(false);
    setCalendarSelections({
      [roomTypeId]: {
        mode,
        anchorDate: null,
        dates: [],
      },
    });
  }

  function toggleCalendarDate(roomTypeId: number, date: string) {
    if (dayjs(date).isBefore(dayjs().startOf("day"), "day")) return;

    setCalendarActiveRoomId(roomTypeId);
    setCalendarEditMode("pricing");
    setCalendarEditorOpen(false);
    setCalendarEditorError("");

    setCalendarSelections((current) => {
      const selection =
        current[roomTypeId] ??
        ({
          mode: "range",
          anchorDate: null,
          dates: [],
        } satisfies CompactCalendarSelection);

      let nextSelection: CompactCalendarSelection;

      if (selection.mode === "single") {
        const exists = selection.dates.includes(date);
        nextSelection = {
          ...selection,
          anchorDate: null,
          dates: exists
            ? selection.dates.filter((item) => item !== date)
            : [...selection.dates, date].sort(),
        };
      } else if (!selection.anchorDate) {
        nextSelection = {
          ...selection,
          anchorDate: date,
          dates: [date],
        };
      } else {
        nextSelection = {
          ...selection,
          anchorDate: null,
          dates: datesBetween(selection.anchorDate, date),
        };
      }

      return nextSelection.dates.length > 0
        ? { [roomTypeId]: nextSelection }
        : {};
    });
  }

  function clearCalendarSelection(roomTypeId: number) {
    setCalendarSelections((current) => {
      if (!(roomTypeId in current)) return current;
      const next = { ...current };
      delete next[roomTypeId];
      return next;
    });
    if (calendarActiveRoomId === roomTypeId) {
      setCalendarEditorOpen(false);
      setCalendarEditorError("");
    }
  }

  function selectionPayload(
    roomTypeId: number,
    selection: CompactCalendarSelection,
  ): CalendarRangeApplyPayload | null {
    if (selection.dates.length === 0) return null;
    const dates = [...selection.dates].sort();
    return {
      rowId: roomTypeId,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      value: 0,
      items: dates.map((date) => ({ rowId: roomTypeId, date })),
      selectionRangeCount:
        selection.mode === "single" ? selection.dates.length : 1,
    };
  }

  function prepareCalendarPriceEditor(roomTypeId: number) {
    const selection = getCalendarSelection(roomTypeId);
    if (selection.dates.length === 0) return;

    const values = selection.dates.map(
      (date) => getCellValue(roomTypeId, date).basePrice,
    );
    const first = values[0] ?? 0;
    const mixed = values.some((value) => value !== first);

    setCalendarActiveRoomId(roomTypeId);
    setCalendarEditMode("pricing");
    setCalendarPriceMixed(mixed);
    setCalendarPriceValue(mixed ? Number.NaN : first);
    setCalendarEditorError("");
  }

  function prepareCalendarInventoryEditor(roomTypeId: number) {
    const selection = getCalendarSelection(roomTypeId);
    if (selection.dates.length === 0) return;

    const inventoryRoom = inventoryRoomById.get(roomTypeId);
    const values = selection.dates.map((date) => {
      const day = inventoryRoom?.days.find((item) => item.date === date);
      return {
        availabilityId: day?.availabilityId ?? null,
        availableCount: day?.availableCount ?? 1,
        status: day?.status ?? ("Available" as AvailabilityStatus),
      };
    });

    const allMissing = values.every((item) => item.availabilityId == null);
    const firstCount = values[0]?.availableCount ?? 1;
    const countMixed =
      !allMissing && values.some((item) => item.availableCount !== firstCount);
    const firstStatus = values[0]?.status ?? "Available";
    const statusMixed = values.some((item) => item.status !== firstStatus);

    setCalendarActiveRoomId(roomTypeId);
    setCalendarEditMode("inventory");
    setCalendarInventoryValueMixed(countMixed);
    setCalendarInventoryStatusMixed(statusMixed);
    setCalendarInventoryValue(
      allMissing ? 1 : countMixed ? Number.NaN : firstCount,
    );
    setCalendarInventoryStatus(statusMixed ? "Available" : firstStatus);
    setCalendarEditorError("");
  }

  function setCompactCalendarEditorOpen(open: boolean) {
    if (open && calendarActiveRoomId != null) {
      if (calendarEditMode === "pricing") {
        prepareCalendarPriceEditor(calendarActiveRoomId);
      } else {
        prepareCalendarInventoryEditor(calendarActiveRoomId);
      }
    }
    setCalendarEditorOpen(open);
  }

  function changeCompactCalendarEditMode(nextMode: "pricing" | "inventory") {
    if (calendarActiveRoomId == null || nextMode === calendarEditMode) return;

    if (nextMode === "pricing") {
      prepareCalendarPriceEditor(calendarActiveRoomId);
    } else {
      prepareCalendarInventoryEditor(calendarActiveRoomId);
    }

    setCalendarEditorOpen(true);
  }

  async function saveCalendarPrice() {
    if (calendarActiveRoomId == null) return;
    const selection = getCalendarSelection(calendarActiveRoomId);
    const payload = selectionPayload(calendarActiveRoomId, selection);
    if (!payload) return;

    if (!Number.isFinite(calendarPriceValue)) {
      setCalendarEditorError("قیمت را وارد کنید.");
      return;
    }
    if (
      calendarPriceValue < priceBounds.minimum ||
      calendarPriceValue > priceBounds.maximum
    ) {
      setCalendarEditorError(
        `قیمت باید بین ${formatPrice(priceBounds.minimum)} و ${formatPrice(
          priceBounds.maximum,
        )} باشد.`,
      );
      return;
    }

    const pricePayload: CalendarRangeApplyPayload = {
      ...payload,
      value: calendarPriceValue,
      basePrice: calendarPriceValue,
    };

    setCalendarPriceSaving(true);
    setCalendarEditorError("");
    try {
      const confirmed = await confirmPriceApply(pricePayload);
      if (!confirmed) return;
      await applyPrices(pricePayload);
      toast.success("قیمت روزهای انتخاب‌شده ذخیره شد.");
      clearCalendarSelection(calendarActiveRoomId);
      setCalendarEditorOpen(false);
    } catch (caught) {
      setCalendarEditorError(
        caught instanceof Error ? caught.message : "ذخیره قیمت انجام نشد.",
      );
    } finally {
      setCalendarPriceSaving(false);
    }
  }

  function openCompactCopyPricingDialog() {
    if (calendarActiveRoomId == null) return;
    const selection = getCalendarSelection(calendarActiveRoomId);
    const payload = selectionPayload(calendarActiveRoomId, selection);
    if (!payload) return;
    openCopyPricingDialog({
      ...payload,
      value: Number.isFinite(calendarPriceValue) ? calendarPriceValue : 0,
      basePrice: Number.isFinite(calendarPriceValue) ? calendarPriceValue : 0,
    });
  }

  function shouldConfirmCalendarInventory(payload: CalendarRangeApplyPayload) {
    const affectedDays = new Set(payload.items.map((item) => item.date)).size;
    return affectedDays > 14 || (payload.selectionRangeCount ?? 1) > 3;
  }

  function resolveCalendarInventoryConfirmation(confirmed: boolean) {
    calendarInventoryConfirmResolverRef.current?.(confirmed);
    calendarInventoryConfirmResolverRef.current = null;
    setCalendarInventoryConfirmOpen(false);
    setCalendarInventoryConfirmPayload(null);
  }

  function confirmCalendarInventory(payload: CalendarRangeApplyPayload) {
    if (!shouldConfirmCalendarInventory(payload)) return true;
    return new Promise<boolean>((resolve) => {
      calendarInventoryConfirmResolverRef.current = resolve;
      setCalendarInventoryConfirmPayload(payload);
      setCalendarInventoryConfirmOpen(true);
    });
  }

  async function saveCalendarInventory() {
    if (calendarActiveRoomId == null) return;
    const selection = getCalendarSelection(calendarActiveRoomId);
    const payload = selectionPayload(calendarActiveRoomId, selection);
    if (!payload) return;

    const inventoryRoom = inventoryRoomById.get(calendarActiveRoomId);
    const max = inventoryRoom?.totalInventory ?? 0;
    const effectiveValue =
      calendarInventoryStatus === "Unavailable" ? 0 : calendarInventoryValue;

    if (!Number.isFinite(effectiveValue)) {
      setCalendarEditorError("تعداد موجود را وارد کنید.");
      return;
    }
    if (effectiveValue < 0) {
      setCalendarEditorError("موجودی نمی‌تواند منفی باشد.");
      return;
    }
    if (max === 1 && effectiveValue > 1) {
      setCalendarEditorError("برای این اتاق موجودی فقط می‌تواند ۰ یا ۱ باشد.");
      return;
    }
    if (effectiveValue > max) {
      setCalendarEditorError(
        `موجودی انتخاب‌شده نمی‌تواند بیشتر از ${formatPlainNumber(max)} باشد.`,
      );
      return;
    }

    const inventoryPayload: CalendarRangeApplyPayload = {
      ...payload,
      value: effectiveValue,
      status: calendarInventoryStatus,
    };

    setCalendarInventorySaving(true);
    setCalendarEditorError("");
    try {
      const confirmed = await confirmCalendarInventory(inventoryPayload);
      if (!confirmed) return;

      const updated = await apiRequest<InventoryDayResponse[]>(
        `/owner/properties/${propertyId}/inventory/bulk-cells`,
        {
          method: "POST",
          body: JSON.stringify({
            items: inventoryPayload.items.map((item) => ({
              roomTypeId: Number(item.rowId),
              date: item.date,
            })),
            availableCount:
              calendarInventoryStatus === "Unavailable" ? 0 : effectiveValue,
            status: calendarInventoryStatus,
          }),
        },
      );

      const updateMap = new Map(
        updated.map((item) => [cellKey(item.roomTypeId, item.date), item]),
      );
      setInventory(
        (current) =>
          current && {
            ...current,
            roomTypes: current.roomTypes.map((roomType) => ({
              ...roomType,
              days: roomType.days.map(
                (day) =>
                  updateMap.get(cellKey(roomType.roomTypeId, day.date)) ?? day,
              ),
            })),
          },
      );

      toast.success("موجودی روزهای انتخاب‌شده ذخیره شد.");
      clearCalendarSelection(calendarActiveRoomId);
      setCalendarEditorOpen(false);
    } catch (caught) {
      setCalendarEditorError(
        caught instanceof Error ? caught.message : "ذخیره موجودی انجام نشد.",
      );
    } finally {
      setCalendarInventorySaving(false);
    }
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
          guestType: pricingGuestType,
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
          guestType: pricingGuestType,
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
              guestType: pricingGuestType,
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

  async function handleBulkEditSubmit(payload: PricingBulkEditPayload) {
    const dates = getDatesInWeekdays(
      payload.startDate,
      payload.endDate,
      payload.weekdays,
    );

    if (dates.length === 0) {
      toast.error("در این بازه، روزی مطابق روزهای هفته انتخاب‌شده وجود ندارد.");
      return;
    }

    const savePayloads = payload.roomPrices.map((roomPrice) => ({
      rowId: roomPrice.roomId,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      value: roomPrice.basePrice,
      basePrice: roomPrice.basePrice,
      items: dates.map((date) => ({
        rowId: roomPrice.roomId,
        date,
      })),
      selectionRangeCount: 1,
    })) satisfies CalendarRangeApplyPayload[];

    for (const savePayload of savePayloads) {
      const confirmed = await confirmPriceApply(savePayload);
      if (!confirmed) return;
    }

    setBulkSaving(true);
    setError("");
    setMessage("");
    try {
      const updatedGroups = await Promise.all(
        savePayloads.map((savePayload) =>
          apiRequest<RoomDailyPriceResponse[]>(
            `/owner/properties/${propertyId}/pricing/bulk-cells`,
            {
              method: "POST",
              body: JSON.stringify({
                items: savePayload.items.map((item) => ({
                  roomTypeId: Number(item.rowId),
                  date: item.date,
                })),
                guestType: pricingGuestType,
                basePrice: savePayload.basePrice ?? 0,
              }),
            },
          ),
        ),
      );
      const updated = updatedGroups.flat();
      const updateMap = new Map(
        updated.map((item) => [cellKey(item.roomTypeId, item.date), item]),
      );

      setPricing(
        (current) =>
          current && {
            ...current,
            guestType: pricingGuestType,
            roomTypes: current.roomTypes.map((roomType) => ({
              ...roomType,
              days: roomType.days.map(
                (day) =>
                  updateMap.get(cellKey(roomType.roomTypeId, day.date)) ?? day,
              ),
            })),
          },
      );

      const submittedPrices = uniqueRecentPrices(
        payload.roomPrices.map((roomPrice) => roomPrice.basePrice),
      );
      const nextQuickPrices = uniqueRecentPrices([
        ...submittedPrices,
        ...storedQuickPrices,
      ]);
      setStoredQuickPrices(nextQuickPrices);
      writeStoredQuickPrices(propertyId, nextQuickPrices);

      setQuickPriceHistory((current) => [
        ...payload.roomPrices.map((roomPrice, index) => ({
          id: -Date.now() - index,
          propertyId,
          roomId: Number(roomPrice.roomId),
          roomName: roomPrice.roomLabel,
          guestType: pricingGuestType,
          affectedDateFrom: dates[0],
          affectedDateTo: dates[dates.length - 1],
          oldBasePrice: 0,
          newBasePrice: roomPrice.basePrice,
          oldChildPrice: 0,
          newChildPrice: 0,
          oldExtraGuestPrice: 0,
          newExtraGuestPrice: 0,
          changedByUserId: 0,
          user: "",
          dateTime: new Date().toISOString(),
        })),
        ...current,
      ]);

      setBulkEditOpen(false);
      setMessage("قیمت‌گذاری گروهی با موفقیت ذخیره شد.");
      toast.success("قیمت‌گذاری گروهی با موفقیت ذخیره شد.");
    } catch (caught) {
      const saveError =
        caught instanceof Error
          ? caught.message
          : "ذخیره قیمت‌گذاری گروهی انجام نشد.";
      setError(saveError);
      toast.error(saveError, { id: "pricing-bulk-edit-error" });
    } finally {
      setBulkSaving(false);
    }
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
    if (!hasSeparateForeignPricing) return;
    setCopyPayload(payload);
    setCopyError("");
    setCopyDirection(
      pricingGuestType === "Iranian" ? "IranianToForeign" : "ForeignToIranian",
    );
    setCopyDialogOpen(true);
  }

  async function confirmCopyPricing() {
    if (!hasSeparateForeignPricing || !copyPayload) return;
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
      if (direction.destination === pricingGuestType) {
        const updateMap = new Map(
          updated.map((item) => [cellKey(item.roomTypeId, item.date), item]),
        );
        setPricing(
          (current) =>
            current && {
              ...current,
              guestType: pricingGuestType,
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
    pricingGuestTabs.find((tab) => tab.value === pricingGuestType) ??
    pricingGuestTabs[0];
  const bulkReviewDetails = getBulkReviewDetails(bulkReviewPayload);
  const copyReviewDetails = getBulkReviewDetails(copyPayload);
  function changeGuestType(nextGuestType: PricingGuestType) {
    if (!hasSeparateForeignPricing || nextGuestType === activeGuestType) return;
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
        <div className="min-w-0" />

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

          <KoochButton
            className="w-full sm:w-auto"
            disabled={!hasRooms}
            onClick={() => setBulkEditOpen(true)}
            size="sm"
            type="button"
            variant="primary"
          >
            قیمت‌گذاری گروهی
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

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 flex-wrap" dir="rtl">
              <div className="inline-flex rounded-lg border border-border bg-muted p-1">
                <button
                  className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${viewMode === "default" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  type="button"
                  onClick={() => {
                    if (viewMode === "default") return;
                    setUsePricingMatrix(false);
                    setUsePricingCalendar(false);
                    setCalendarEditorOpen(false);
                  }}
                >
                  نمایش پیش‌فرض
                </button>
                <button
                  className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${viewMode === "table" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  type="button"
                  onClick={() => {
                    if (viewMode === "table") return;
                    setUsePricingMatrix(true);
                    setUsePricingCalendar(false);
                    setCalendarEditorOpen(false);
                  }}
                >
                  نمایش جدول آزمایشی
                </button>
                <button
                  className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${viewMode === "calendar" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  type="button"
                  onClick={() => {
                    if (viewMode === "calendar") return;
                    setUsePricingMatrix(false);
                    setUsePricingCalendar(true);
                    setCalendarEditorOpen(false);
                  }}
                >
                  نمایش تقویم آزمایشی
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {hasSeparateForeignPricing && (
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted p-2"
          dir="rtl"
        >
          <div className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
            {pricingGuestTabs.map((tab) => (
              <button
                className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
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
      )}
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
      {shouldShowNoRoomsState ? (
        <KoochCard
          className="mt-5 flex flex-col items-center justify-center gap-4 border-dashed py-10 text-center"
          padding="lg"
        >
          <div>
            <h3 className="text-lg font-bold text-foreground">
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
          <div
            className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-border/70 py-2 text-sm"
            dir="rtl"
          >
            <div className="min-h-5">
              {shouldShowNoPricingWarning && (
                <span className="font-semibold text-[var(--theme-warning)]">
                  برای این بازه هنوز قیمتی ثبت نشده است.
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-muted-foreground">
              {currencyLabel && (
                <span>
                  واحد قیمت:{" "}
                  <span className="text-foreground">{currencyLabel}</span>
                </span>
              )}

              {pricingWarnings.length === 0 && property && (
                <button
                  className="inline-flex items-center gap-1.5 text-foreground transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => setGuestPricingRulesOpen(true)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-blue-100 text-[11px] font-black leading-none text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    i
                  </span>
                  <span>قوانین قیمت مهمانان</span>
                </button>
              )}
            </div>
          </div>

          <div className="mt-5">
            {usePricingCalendar ? (
              <div className="grid gap-4">
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted px-3 py-2"
                  dir="rtl"
                >
                  <p className="text-sm font-semibold text-foreground">
                    تقویم آزمایشی نرخ و موجودی
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1 text-[var(--theme-success)]">
                      <span aria-hidden="true">⚡</span>
                      فوری
                    </span>
                    <span className="inline-flex items-center gap-1 text-[var(--theme-warning)]">
                      <span aria-hidden="true">⚡</span>
                      استعلامی
                    </span>
                    <span className="text-muted-foreground">
                      قیمت‌ها با حذف سه صفر
                    </span>
                  </div>
                </div>

                {inventoryLoading ? (
                  <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                    در حال بارگذاری موجودی تقویم...
                  </p>
                ) : inventoryError ? (
                  <KoochAlert variant="destructive">
                    {inventoryError}
                  </KoochAlert>
                ) : (
                  <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {rows.map((row) => {
                      const inventoryRoom = inventoryRoomById.get(
                        row.roomTypeId,
                      );
                      const totalInventory = inventoryRoom?.totalInventory ?? 0;
                      const selection = getCalendarSelection(row.roomTypeId);
                      const selectedDateSet = new Set(selection.dates);
                      const selectedCount = selection.dates.length;

                      return (
                        <section
                          className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
                          key={row.roomTypeId}
                        >
                          <div className="grid gap-2 border-b border-border px-3 py-2">
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <h3 className="min-w-0 truncate text-sm font-bold text-foreground">
                                {row.label}
                              </h3>

                              <div className="inline-flex shrink-0 rounded-md border border-border bg-muted p-0.5">
                                {[
                                  { value: "range" as const, label: "بازه‌ای" },
                                  { value: "single" as const, label: "تکی" },
                                ].map((option) => (
                                  <button
                                    className={`rounded px-2 py-1 text-[9px] font-bold transition ${
                                      selection.mode === option.value
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                    key={option.value}
                                    onClick={() =>
                                      setCalendarSelectionMode(
                                        row.roomTypeId,
                                        option.value,
                                      )
                                    }
                                    type="button"
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              {selectedCount > 0 && (
                                <span className="text-[10px] font-semibold text-muted-foreground">
                                  {formatPlainNumber(selectedCount)} روز انتخاب
                                  شده
                                </span>
                              )}

                              {selectedCount > 0 && (
                                <button
                                  aria-label="پاک کردن انتخاب"
                                  className="rounded-md px-1.5 py-1 text-[9px] font-bold text-destructive transition hover:bg-muted"
                                  onClick={() =>
                                    clearCalendarSelection(row.roomTypeId)
                                  }
                                  type="button"
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            {selection.mode === "range" &&
                              selection.anchorDate && (
                                <p className="text-[9px] font-semibold text-primary">
                                  روز پایان بازه را انتخاب کنید.
                                </p>
                              )}
                          </div>

                          <div className="grid grid-cols-7 bg-muted">
                            {pricingCalendarWeekdays.map((weekday) => (
                              <div
                                className={`border-2 border-white px-0.5 py-1.5 text-center text-[9px] font-semibold ${
                                  weekday === "جمعه"
                                    ? "text-destructive"
                                    : "text-muted-foreground"
                                }`}
                                key={weekday}
                              >
                                {weekday}
                              </div>
                            ))}
                          </div>

                          <div className="grid grid-cols-7 bg-muted">
                            {Array.from(
                              { length: pricingCalendarStartOffset },
                              (_, index) => (
                                <div
                                  aria-hidden="true"
                                  className="min-h-16 border-2 border-white bg-card"
                                  key={`empty-${row.roomTypeId}-${index}`}
                                />
                              ),
                            )}

                            {monthDays.map((date) => {
                              const iso = toIso(date);
                              const priceDay = getCellValue(row.id, iso);
                              const inventoryDay = inventoryRoom?.days.find(
                                (day) => day.date === iso,
                              );
                              const availableCount =
                                inventoryDay?.availableCount ?? 0;
                              const status =
                                inventoryDay?.status ?? "Unavailable";
                              const isPast = dayjs(iso).isBefore(
                                dayjs().startOf("day"),
                                "day",
                              );
                              const isAvailable =
                                status === "Available" && availableCount > 0;
                              const isOnRequest =
                                status === "OnRequest" && availableCount > 0;
                              const isHoliday = date.day() === 5;
                              const isSelected = selectedDateSet.has(iso);

                              const statusSurface = isPast
                                ? "bg-muted text-muted-foreground"
                                : isAvailable
                                  ? "bg-[var(--theme-success-soft)] text-foreground"
                                  : isOnRequest
                                    ? "bg-[var(--theme-warning-soft)] text-foreground"
                                    : "bg-muted text-muted-foreground";

                              const bookingLabel = isAvailable
                                ? "رزرو فوری"
                                : isOnRequest
                                  ? "استعلامی"
                                  : "ناموجود";

                              const bookingIconClass = isAvailable
                                ? "text-[var(--theme-success)]"
                                : isOnRequest
                                  ? "text-[var(--theme-warning)]"
                                  : "text-muted-foreground";

                              const jalaliDay = Number(
                                date.calendar("jalali").format("D"),
                              );

                              return (
                                <button
                                  aria-label={`${row.label}، ${formatIsoDate(
                                    iso,
                                  )}، ${bookingLabel}، ${formatPlainNumber(
                                    availableCount,
                                  )} از ${formatPlainNumber(
                                    totalInventory,
                                  )}، نرخ ${formatPriceWithCurrency(
                                    priceDay.basePrice,
                                    currencyLabel,
                                  )}`}
                                  aria-pressed={isSelected}
                                  className={`relative grid min-h-16 content-between gap-1 border-2 border-white p-1 text-right transition ${
                                    isPast
                                      ? "cursor-not-allowed"
                                      : "cursor-pointer hover:brightness-[0.98]"
                                  } ${statusSurface} ${
                                    isSelected
                                      ? "z-10 ring-2 ring-inset ring-primary"
                                      : ""
                                  }`}
                                  disabled={isPast}
                                  key={`${row.roomTypeId}-${iso}`}
                                  onClick={() =>
                                    toggleCalendarDate(row.roomTypeId, iso)
                                  }
                                  type="button"
                                >
                                  <div className="flex items-start justify-between gap-0.5">
                                    <span
                                      className={`text-[11px] font-bold ${
                                        isHoliday ? "text-destructive" : ""
                                      }`}
                                    >
                                      {formatPlainNumber(jalaliDay)}
                                    </span>
                                    {status !== "Unavailable" &&
                                      availableCount > 0 && (
                                        <span
                                          aria-hidden="true"
                                          className={`text-[10px] leading-none ${bookingIconClass}`}
                                          title={bookingLabel}
                                        >
                                          ⚡
                                        </span>
                                      )}
                                  </div>

                                  <div className="text-center">
                                    <div className="text-[11px] font-bold leading-none tabular-nums text-foreground">
                                      {priceDay.basePrice > 0
                                        ? formatCalendarPrice(
                                            priceDay.basePrice,
                                          )
                                        : "—"}
                                    </div>
                                  </div>

                                  <div className="text-left text-[9px] font-semibold leading-none tabular-nums text-muted-foreground">
                                    {formatPlainNumber(availableCount)}/
                                    {formatPlainNumber(totalInventory)}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : usePricingMatrix ? (
              <RoomPricingMatrixEditor
                rows={rows}
                days={gridDays}
                getCellValue={getCellValue}
                onApplyRange={applyPrices}
                confirmApplyRange={confirmPriceApply}
                onCopyPricing={
                  hasSeparateForeignPricing ? openCopyPricingDialog : undefined
                }
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
                compactSelectionModeControls={true}
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
                onCopyPricing={
                  hasSeparateForeignPricing ? openCopyPricingDialog : undefined
                }
                pricingCurrencyLabel={currencyLabel}
                pricingMaxValue={priceBounds.maximum}
                pricingMinValue={priceBounds.minimum}
                quickPricePresets={quickPricePresets}
                pricingValueResolver={(day) => ({
                  basePrice: day.basePrice,
                })}
                renderCell={(_row, _date, day, state) => (
                  <div
                    className={`grid h-full place-items-center px-1 text-[11px] font-bold ${
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
                key={pricingGuestType}
                valueInputType="number"
                valueLabel="نرخ اتاق"
              />
            )}
          </div>
        </>
      )}

      {usePricingCalendar && calendarActiveRoomId != null && (
        <CalendarSelectionEditor
          availableModes={["pricing", "inventory"]}
          error={calendarEditorError}
          inventoryStatus={calendarInventoryStatus}
          inventoryValue={calendarInventoryValue}
          maxValue={
            inventoryRoomById.get(calendarActiveRoomId)?.totalInventory ?? 0
          }
          minValue={0}
          mixedInventoryStatus={calendarInventoryStatusMixed}
          mixedInventoryValue={calendarInventoryValueMixed}
          mixedPricingValue={calendarPriceMixed}
          mode={calendarEditMode}
          onModeChange={changeCompactCalendarEditMode}
          onCancel={() => clearCalendarSelection(calendarActiveRoomId)}
          onCopyPricing={
            hasSeparateForeignPricing && calendarEditMode === "pricing"
              ? openCompactCopyPricingDialog
              : undefined
          }
          onInventoryStatusChange={(status) => {
            setCalendarInventoryStatus(status);
            setCalendarInventoryStatusMixed(false);
            setCalendarInventoryValueMixed(false);
            setCalendarEditorError("");
            if (status === "Unavailable") setCalendarInventoryValue(0);
          }}
          onInventoryValueChange={(value) => {
            setCalendarInventoryValue(value);
            setCalendarInventoryValueMixed(false);
            setCalendarEditorError("");
          }}
          onOpenChange={setCompactCalendarEditorOpen}
          onPriceValueChange={(value) => {
            setCalendarPriceValue(value);
            setCalendarPriceMixed(false);
            setCalendarEditorError("");
          }}
          onSave={
            calendarEditMode === "pricing"
              ? saveCalendarPrice
              : saveCalendarInventory
          }
          open={calendarEditorOpen}
          priceValue={calendarPriceValue}
          pricingCurrencyLabel={currencyLabel}
          quickPricePresets={quickPricePresets}
          saving={
            calendarEditMode === "pricing"
              ? calendarPriceSaving
              : calendarInventorySaving
          }
          selectedCount={
            getCalendarSelection(calendarActiveRoomId).dates.length
          }
          selectedDayCount={
            getCalendarSelection(calendarActiveRoomId).dates.length
          }
          selectedRoomLabels={rows
            .filter((row) => row.roomTypeId === calendarActiveRoomId)
            .map((row) => row.label)}
          selectionRangeCount={
            getCalendarSelection(calendarActiveRoomId).mode === "single"
              ? getCalendarSelection(calendarActiveRoomId).dates.length
              : 1
          }
          statusOptions={compactInventoryStatusOptions}
          valueInputType="number"
          valueLabel="تعداد موجود"
        />
      )}

      <KoochConfirmDialog
        cancelText="انصراف"
        confirmText="تایید و ذخیره"
        description="این تغییر موجودی روی تعداد زیادی روز اعمال می‌شود. آیا مطمئن هستید؟"
        onConfirm={() => resolveCalendarInventoryConfirmation(true)}
        onOpenChange={(open) => {
          if (!open) resolveCalendarInventoryConfirmation(false);
          else setCalendarInventoryConfirmOpen(true);
        }}
        open={calendarInventoryConfirmOpen}
        title="تغییر گروهی موجودی"
        variant="warning"
      >
        {calendarInventoryConfirmPayload && (
          <dl className="grid gap-3 rounded-lg border border-border bg-muted p-3 text-right text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="font-bold text-muted-foreground">تعداد روزها</dt>
              <dd className="font-bold text-foreground">
                {formatPlainNumber(
                  new Set(
                    calendarInventoryConfirmPayload.items.map(
                      (item) => item.date,
                    ),
                  ).size,
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="font-bold text-muted-foreground">موجودی جدید</dt>
              <dd className="font-bold text-foreground">
                {formatPlainNumber(calendarInventoryConfirmPayload.value)}
              </dd>
            </div>
          </dl>
        )}
      </KoochConfirmDialog>

      <KoochDialog
        bodyClassName="px-4 py-4"
        onOpenChange={setGuestPricingRulesOpen}
        open={guestPricingRulesOpen}
        size="xs"
        title="قوانین قیمت مهمانان"
      >
        {property && (
          <div className="grid gap-3" dir="rtl">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/50 px-3 py-3">
              <span className="text-sm font-medium text-muted-foreground">
                نرخ کودک
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatPriceWithCurrency(
                  property.childPrice ?? 0,
                  currencyLabel,
                )}
              </span>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/50 px-3 py-3">
              <span className="text-sm font-medium text-muted-foreground">
                نرخ نفر اضافه
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatPriceWithCurrency(
                  property.extraGuestPrice ?? 0,
                  currencyLabel,
                )}
              </span>
            </div>
          </div>
        )}
      </KoochDialog>

      <PricingBulkEditDialog
        onOpenChange={setBulkEditOpen}
        onSubmit={handleBulkEditSubmit}
        open={bulkEditOpen}
        pricingCurrencyLabel={currencyLabel || "تومان"}
        pricingMaxValue={priceBounds.maximum}
        pricingMinValue={priceBounds.minimum}
        rooms={bulkRooms}
        saving={bulkSaving}
      />

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
                  <KoochTableCell className="font-bold text-primary">
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
        open={hasSeparateForeignPricing && copyDialogOpen}
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
              <dd className="font-bold text-foreground">
                {copyReviewDetails.roomNames}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">بازه تاریخ</dt>
              <dd className="font-bold text-foreground">
                {copyReviewDetails.dateRangeLabel}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">
                تعداد روزهای اثرگرفته
              </dt>
              <dd className="font-bold text-foreground">
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
              <dd className="font-bold text-foreground">
                {bulkReviewDetails.roomNames}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">بازه تاریخ</dt>
              <dd className="font-bold text-foreground">
                {bulkReviewDetails.dateRangeLabel}
              </dd>
            </div>
            {hasSeparateForeignPricing && (
              <div className="grid gap-1">
                <dt className="font-bold text-muted-foreground">نوع مهمان</dt>
                <dd className="font-bold text-foreground">
                  {pricingGuestTypeLabels[pricingGuestType]}
                </dd>
              </div>
            )}
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">مبلغ</dt>
              <dd className="font-bold text-foreground">
                {bulkReviewDetails.priceLabel}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">
                تعداد روزهای اثرگرفته
              </dt>
              <dd className="font-bold text-foreground">
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
