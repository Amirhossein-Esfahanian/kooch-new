"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import {
  KoochCheckbox,
  KoochMultiSelect,
} from "@/components/KoochFormControls";
import {
  formatLocalIsoDate,
  getExclusiveRangeLength,
  isBeforeLocalIsoDate,
  isSameOrAfterLocalIsoDate,
} from "@/lib/date-utils";

type RoomId = number | string;

export type PricingBulkWeekday =
  | "Saturday"
  | "Sunday"
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday";

export type PricingBulkRoom = {
  id: RoomId;
  label: string;
  basePrice?: number | null;
  isActive?: boolean;
};

export type PricingBulkRoomPrice = {
  roomId: RoomId;
  roomLabel: string;
  basePrice: number;
};

export type PricingBulkEditPayload = {
  startDate: string;
  endDate: string;
  weekdays: PricingBulkWeekday[];
  roomPrices: PricingBulkRoomPrice[];
};

export type PricingBulkDateRangeRenderProps = {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
};

export type PricingBulkEditDialogProps = {
  open: boolean;
  rooms: PricingBulkRoom[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: PricingBulkEditPayload) => Promise<void> | void;
  title?: string;
  description?: string;
  initialStartDate?: string;
  initialEndDate?: string;
  initialSelectedRoomIds?: RoomId[];
  pricingCurrencyLabel?: string;
  pricingMinValue?: number;
  pricingMaxValue?: number;
  /**
   * Optional reference prices for suspicious-price confirmation.
   * If omitted, the dialog derives them from rooms[].basePrice.
   */
  outlierMinPrice?: number | null;
  outlierMaxPrice?: number | null;
  saving?: boolean;
  /**
   * برای اتصال انتخابگر تاریخ اختصاصی پروژه.
   * اگر پاس داده نشود، DatePicker اختصاصی Kooch به شکل compact استفاده می‌شود.
   */
  renderDateRangeFields?: (props: PricingBulkDateRangeRenderProps) => ReactNode;
};

const emptyRoomIds: RoomId[] = [];

const weekdayOptions: { value: PricingBulkWeekday; label: string }[] = [
  { value: "Saturday", label: "شنبه‌ها" },
  { value: "Sunday", label: "یکشنبه‌ها" },
  { value: "Monday", label: "دوشنبه‌ها" },
  { value: "Tuesday", label: "سه‌شنبه‌ها" },
  { value: "Wednesday", label: "چهارشنبه‌ها" },
  { value: "Thursday", label: "پنجشنبه‌ها" },
  { value: "Friday", label: "جمعه‌ها" },
];

const latinDigitMap: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toPersianNumber(value: string | number) {
  return new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(
    Number(value),
  );
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function normalizeDigits(value: string) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => latinDigitMap[digit] ?? digit);
}

function parsePriceInput(value: string) {
  const normalized = normalizeDigits(value).replace(/[^0-9]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPriceInput(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const numericValue =
    typeof value === "number" ? value : parsePriceInput(value);
  return numericValue === null ? "" : formatPrice(numericValue);
}

function roomKey(roomId: RoomId) {
  return String(roomId);
}

function sameRoomId(first: RoomId, second: RoomId) {
  return String(first) === String(second);
}

function usePortalDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    function readDarkMode() {
      const root = document.documentElement;
      const body = document.body;
      const savedTheme =
        window.localStorage.getItem("theme") ??
        window.localStorage.getItem("kooch-theme") ??
        window.localStorage.getItem("color-theme");

      setIsDarkMode(
        root.classList.contains("dark") ||
          body.classList.contains("dark") ||
          savedTheme === "dark",
      );
    }

    readDarkMode();

    const observer = new MutationObserver(readDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    window.addEventListener("storage", readDarkMode);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", readDarkMode);
    };
  }, []);

  return isDarkMode;
}

function fallbackDateFields({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: PricingBulkDateRangeRenderProps) {
  const selectedNights = getExclusiveRangeLength(startDate, endDate);
  const selectedNightsLabel = selectedNights.toLocaleString("fa-IR");

  return (
    <div className="grid gap-2 text-sm font-bold text-foreground">
      <span>
        بازه ورود و خروج<span className="text-destructive"> *</span>
      </span>

      <div className="relative">
        <KoochDatePicker
          mode="range"
          value={{
            startDate: startDate || null,
            endDate: endDate || null,
          }}
          onChange={(value) => {
            onStartDateChange(value.startDate ?? "");
            onEndDateChange(value.endDate ?? "");
          }}
          labels={{
            start: "ورود",
            end: "خروج",
            rangeTitle: "انتخاب بازه قیمت‌گذاری",
            today: "برو به امروز",
            gregorian: "تقویم میلادی",
            jalali: "تقویم شمسی",
          }}
          placeholderStart="تاریخ ورود"
          placeholderEnd="تاریخ خروج"
          confirmText="تایید بازه"
          cancelText="انصراف"
          calendarType="jalali"
          disablePastDates
          minDate={formatLocalIsoDate(new Date())}
          labelsAbove={true}
          showFieldLabels
          controlClassName="grid h-9 rounded-lg border border-border bg-background px-3 py-1.5 text-right text-sm transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {startDate && endDate && selectedNights > 0 && (
        <p className="text-xs font-medium text-muted-foreground">
          {selectedNightsLabel} شب انتخاب شده است. تاریخ خروج محاسبه نمی‌شود.
        </p>
      )}
    </div>
  );
}

export function PricingBulkEditDialog({
  open,
  rooms,
  onOpenChange,
  onSubmit,
  title = "تعیین قیمت",
  description = "محدوده تاریخ، اتاق‌ها و روزهای هفته را انتخاب کنید.",
  initialStartDate = "",
  initialEndDate = "",
  initialSelectedRoomIds = emptyRoomIds,
  pricingCurrencyLabel = "تومان",
  pricingMinValue = 0,
  pricingMaxValue = Number.MAX_SAFE_INTEGER,
  outlierMinPrice = null,
  outlierMaxPrice = null,
  saving = false,
  renderDateRangeFields,
}: PricingBulkEditDialogProps) {
  const [mounted, setMounted] = useState(false);
  const isDarkMode = usePortalDarkMode();
  const openedRef = useRef(false);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [selectedRoomIds, setSelectedRoomIds] = useState<RoomId[]>(
    initialSelectedRoomIds,
  );
  const [selectedWeekdays, setSelectedWeekdays] = useState<
    PricingBulkWeekday[]
  >(weekdayOptions.map((weekday) => weekday.value));
  const [allRoomsPriceInput, setAllRoomsPriceInput] = useState("");
  const [roomPriceInputs, setRoomPriceInputs] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState("");
  const [pendingPayload, setPendingPayload] =
    useState<PricingBulkEditPayload | null>(null);
  const [outlierMessages, setOutlierMessages] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }

    if (openedRef.current) return;

    openedRef.current = true;
    setStartDate(initialStartDate);
    setEndDate(initialEndDate);
    setSelectedRoomIds(initialSelectedRoomIds);
    setSelectedWeekdays(weekdayOptions.map((weekday) => weekday.value));
    setAllRoomsPriceInput("");
    setRoomPriceInputs({});
    setError("");
    setPendingPayload(null);
    setOutlierMessages([]);
  }, [initialEndDate, initialSelectedRoomIds, initialStartDate, open]);

  const selectedRooms = useMemo(
    () =>
      selectedRoomIds
        .map((roomId) => rooms.find((room) => sameRoomId(room.id, roomId)))
        .filter((room): room is PricingBulkRoom => Boolean(room)),
    [rooms, selectedRoomIds],
  );

  useEffect(() => {
    setRoomPriceInputs((current) => {
      const next: Record<string, string> = {};
      const allPriceValue = parsePriceInput(allRoomsPriceInput);

      selectedRooms.forEach((room) => {
        const key = roomKey(room.id);
        if (current[key] !== undefined) {
          next[key] = current[key];
          return;
        }

        if (allPriceValue !== null) {
          next[key] = formatPrice(allPriceValue);
          return;
        }

        next[key] = formatPriceInput(room.basePrice);
      });

      return next;
    });
  }, [allRoomsPriceInput, selectedRooms]);

  function resetForm() {
    setSelectedRoomIds(initialSelectedRoomIds);
    setSelectedWeekdays(weekdayOptions.map((weekday) => weekday.value));
    setAllRoomsPriceInput("");
    setRoomPriceInputs({});
    setError("");
    setPendingPayload(null);
    setOutlierMessages([]);
  }

  function toggleWeekday(weekday: PricingBulkWeekday) {
    setError("");
    setSelectedWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday],
    );
  }

  function selectAllWeekdays() {
    setError("");
    setSelectedWeekdays(weekdayOptions.map((weekday) => weekday.value));
  }

  function clearWeekdays() {
    setError("");
    setSelectedWeekdays([]);
  }

  function updateAllRoomsPrice(value: string) {
    const parsed = parsePriceInput(value);
    const formatted = parsed === null ? "" : formatPrice(parsed);

    setAllRoomsPriceInput(formatted);
    setRoomPriceInputs((current) => {
      const next = { ...current };
      selectedRooms.forEach((room) => {
        next[roomKey(room.id)] = formatted;
      });
      return next;
    });
    setError("");
  }

  function updateRoomPrice(roomId: RoomId, value: string) {
    const parsed = parsePriceInput(value);
    setRoomPriceInputs((current) => ({
      ...current,
      [roomKey(roomId)]: parsed === null ? "" : formatPrice(parsed),
    }));
    setError("");
  }

  const referencePrices = useMemo(() => {
    const roomPrices = rooms
      .map((room) => room.basePrice)
      .filter(
        (price): price is number =>
          typeof price === "number" && Number.isFinite(price) && price > 0,
      );

    const min =
      typeof outlierMinPrice === "number" &&
      Number.isFinite(outlierMinPrice) &&
      outlierMinPrice > 0
        ? outlierMinPrice
        : roomPrices.length > 0
          ? Math.min(...roomPrices)
          : null;

    const max =
      typeof outlierMaxPrice === "number" &&
      Number.isFinite(outlierMaxPrice) &&
      outlierMaxPrice > 0
        ? outlierMaxPrice
        : roomPrices.length > 0
          ? Math.max(...roomPrices)
          : null;

    return { min, max };
  }, [outlierMaxPrice, outlierMinPrice, rooms]);

  function getOutlierMessages(payload: PricingBulkEditPayload) {
    const minReference = referencePrices.min;
    const maxReference = referencePrices.max;

    if (!minReference || !maxReference) return [];

    const lowThreshold = minReference * 0.2;
    const highThreshold = maxReference * 4;

    return payload.roomPrices
      .filter(
        (roomPrice) =>
          roomPrice.basePrice < lowThreshold ||
          roomPrice.basePrice > highThreshold,
      )
      .map((roomPrice) => {
        const reason =
          roomPrice.basePrice < lowThreshold
            ? `کمتر از ۲۰٪ کمترین قیمت مرجع (${formatPrice(minReference)} ${pricingCurrencyLabel})`
            : `بیشتر از ۴ برابر بیشترین قیمت مرجع (${formatPrice(maxReference)} ${pricingCurrencyLabel})`;

        return `${roomPrice.roomLabel}: ${formatPrice(roomPrice.basePrice)} ${pricingCurrencyLabel} — ${reason}`;
      });
  }

  async function submitPayload(payload: PricingBulkEditPayload) {
    await onSubmit(payload);
    setPendingPayload(null);
    setOutlierMessages([]);
  }

  function validate() {
    if (!startDate) return "تاریخ ورود را انتخاب کنید.";
    if (!endDate) return "تاریخ خروج را انتخاب کنید.";
    if (isSameOrAfterLocalIsoDate(startDate, endDate)) {
      return "تاریخ خروج باید بعد از تاریخ ورود باشد.";
    }
    const today = formatLocalIsoDate(new Date());
    if (isBeforeLocalIsoDate(startDate, today)) {
      return "امکان تغییر قیمت روزهای گذشته وجود ندارد.";
    }
    if (selectedRoomIds.length === 0) return "حداقل یک اتاق را انتخاب کنید.";
    if (selectedWeekdays.length === 0)
      return "حداقل یک روز هفته را انتخاب کنید.";

    for (const room of selectedRooms) {
      const parsedPrice = parsePriceInput(
        roomPriceInputs[roomKey(room.id)] ?? "",
      );
      if (parsedPrice === null) return `قیمت اتاق ${room.label} را وارد کنید.`;
      if (parsedPrice < pricingMinValue || parsedPrice > pricingMaxValue) {
        return `قیمت اتاق ${room.label} باید بین ${formatPrice(
          pricingMinValue,
        )} و ${formatPrice(pricingMaxValue)} ${pricingCurrencyLabel} باشد.`;
      }
    }

    return "";
  }

  async function handleSubmit() {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    const payload: PricingBulkEditPayload = {
      startDate,
      endDate,
      weekdays: selectedWeekdays,
      roomPrices: selectedRooms.map((room) => ({
        roomId: room.id,
        roomLabel: room.label,
        basePrice:
          parsePriceInput(roomPriceInputs[roomKey(room.id)] ?? "") ?? 0,
      })),
    };

    const suspiciousPrices = getOutlierMessages(payload);
    if (suspiciousPrices.length > 0) {
      setPendingPayload(payload);
      setOutlierMessages(suspiciousPrices);
      return;
    }

    await submitPayload(payload);
  }

  async function handleConfirmedOutlierSubmit() {
    if (!pendingPayload) return;
    await submitPayload(pendingPayload);
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      aria-modal="true"
      className={joinClasses(
        "fixed inset-0 z-[100] flex items-end justify-center bg-black/45 px-3 py-4 backdrop-blur-sm sm:items-center",
        isDarkMode && "dark",
      )}
      dir="rtl"
      role="dialog"
    >
      <KoochCard
        className="flex h-[90vh] max-h-[90vh] w-full max-w-3xl min-w-0 flex-col overflow-hidden border-border/70 bg-card text-card-foreground shadow-2xl"
        padding="none"
        variant="elevated"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-foreground">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>

          <button
            aria-label="بستن"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-xl leading-none text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-card px-4 py-4 sm:px-5">
          {(renderDateRangeFields ?? fallbackDateFields)({
            startDate,
            endDate,
            onStartDateChange: (value) => {
              setStartDate(value);
              setError("");
            },
            onEndDateChange: (value) => {
              setEndDate(value);
              setError("");
            },
          })}

          <div className="mt-4 grid gap-4">
            <div className="grid gap-2 text-sm font-bold text-foreground">
              <span>
                اتاق<span className="text-destructive"> *</span>
              </span>

              <KoochMultiSelect
                options={rooms.map((room) => ({
                  value: room.id,
                  label: room.label,
                  searchText: room.label,
                  disabled: room.isActive === false,
                }))}
                value={selectedRoomIds}
                onChange={setSelectedRoomIds}
                placeholder="انتخاب اتاق‌ها"
                searchPlaceholder="جستجوی اتاق..."
                selectAllText="انتخاب همه"
                clearText="حذف همه"
                emptyText="اتاقی پیدا نشد."
              />
            </div>

            <div className="grid gap-2 text-sm font-bold text-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>
                  روزهای هفته<span className="text-destructive"> *</span>
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    className="font-bold text-primary hover:underline"
                    onClick={selectAllWeekdays}
                    type="button"
                  >
                    انتخاب همه
                  </button>
                  <button
                    className="font-bold text-destructive hover:underline"
                    onClick={clearWeekdays}
                    type="button"
                  >
                    حذف همه
                  </button>
                </div>
              </div>

              <div className="grid w-full grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-4 md:grid-cols-7">
                {weekdayOptions.map((weekday) => {
                  const checked = selectedWeekdays.includes(weekday.value);
                  return (
                    <KoochCheckbox
                      checked={checked}
                      boxBorder={true}
                      boxBackground={true}
                      // checkedBoxBorder={false}
                      // checkedBoxBackground={false}
                      className="h-4 w-4 rounded"
                      containerClassName={joinClasses(
                        "rounded-lg border border-border bg-background p-2 transition ",
                      )}
                      key={weekday.value}
                      label={weekday.label}
                      onChange={() => toggleWeekday(weekday.value)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {selectedRooms.length > 0 && (
            <div className="mt-5 rounded-xl border border-border bg-muted/40 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-foreground">
                    قیمت اتاق‌ها
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    اعداد به صورت سه‌رقمی جدا می‌شوند.
                  </p>
                </div>

                <span className="rounded-lg bg-background px-2 py-1 text-xs font-bold text-muted-foreground">
                  {toPersianNumber(selectedRooms.length)} اتاق
                </span>
              </div>

              {selectedRooms.length > 1 && (
                <label className="mb-3 grid gap-2 text-sm font-bold text-foreground">
                  <span>قیمت همه اتاق‌ها</span>
                  <span className="relative block">
                    <input
                      className="h-9 w-full rounded-lg border border-border bg-background text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                      inputMode="numeric"
                      onChange={(event) =>
                        updateAllRoomsPrice(event.target.value)
                      }
                      placeholder="قیمت"
                      type="text"
                      value={allRoomsPriceInput}
                      style={{
                        paddingLeft: pricingCurrencyLabel
                          ? "4.25rem"
                          : "0.75rem",
                        paddingRight: "0.75rem",
                      }}
                    />
                    {pricingCurrencyLabel && (
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                        {pricingCurrencyLabel}
                      </span>
                    )}
                  </span>
                </label>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {selectedRooms.map((room) => (
                  <label
                    className="grid gap-2 text-sm font-bold text-foreground"
                    key={roomKey(room.id)}
                  >
                    <span>
                      {selectedRooms.length === 1
                        ? `اتاق ${room.label}`
                        : room.label}
                    </span>
                    <span className="relative block">
                      <input
                        className="h-9 w-full rounded-lg border border-border bg-background text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                        inputMode="numeric"
                        onChange={(event) =>
                          updateRoomPrice(room.id, event.target.value)
                        }
                        placeholder="قیمت"
                        type="text"
                        value={roomPriceInputs[roomKey(room.id)] ?? ""}
                        style={{
                          paddingLeft: pricingCurrencyLabel
                            ? "4.25rem"
                            : "0.75rem",
                          paddingRight: "0.75rem",
                        }}
                      />
                      {pricingCurrencyLabel && (
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                          {pricingCurrencyLabel}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <KoochButton
            className="w-full sm:w-auto"
            onClick={resetForm}
            type="button"
            variant="outline"
          >
            پاک کردن فرم
          </KoochButton>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <KoochButton
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              انصراف
            </KoochButton>
            <KoochButton
              className="w-full sm:w-auto"
              disabled={saving}
              loading={saving}
              onClick={handleSubmit}
              type="button"
              variant="primary"
            >
              ذخیره
            </KoochButton>
          </div>
        </div>
      </KoochCard>

      <KoochConfirmDialog
        cancelText="انصراف"
        confirmText="بله، ثبت شود"
        description="این قیمت نسبت به قیمت‌های این اقامتگاه غیرعادی است. آیا از ثبت آن مطمئن هستید؟"
        loading={saving}
        onConfirm={handleConfirmedOutlierSubmit}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingPayload(null);
            setOutlierMessages([]);
          }
        }}
        open={Boolean(pendingPayload)}
        title="قیمت غیرعادی"
        variant="warning"
      >
        {outlierMessages.length > 0 && (
          <ul className="mt-2 grid gap-1 text-right text-xs font-semibold text-muted-foreground">
            {outlierMessages.map((message) => (
              <li key={message}>• {message}</li>
            ))}
          </ul>
        )}
      </KoochConfirmDialog>
    </div>,
    document.body,
  );
}

export default PricingBulkEditDialog;
