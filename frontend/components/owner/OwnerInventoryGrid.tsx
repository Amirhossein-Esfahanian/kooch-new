"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  AvailabilityStatus,
  InventoryDayResponse,
  InventoryRoomTypeResponse,
  PropertyInventoryResponse,
} from "@/lib/owner-api";
import {
  CalendarGridDay,
  CalendarGridRow,
  CalendarRangeApplyPayload,
  CalendarRangeGridCellState,
  CalendarRangeGridEditor,
} from "@/components/CalendarRangeGridEditor";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";

dayjs.extend(jalaliday);

type InventoryRow = CalendarGridRow & {
  roomTypeId: number;
  inventoryMode: InventoryRoomTypeResponse["inventoryMode"];
  days: InventoryDayResponse[];
};

const statusOptions = [
  { value: "Available" as const, label: "موجود" },
  { value: "Unavailable" as const, label: "ناموجود" },
  { value: "OnRequest" as const, label: "نیازمند استعلام" },
];

function toPersianNumber(value: string | number) {
  return new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(
    Number(value),
  );
}

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

function datesInRange(startDate: string, endDate: string) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const totalDays = Math.max(0, end.diff(start, "day"));
  return Array.from({ length: totalDays + 1 }, (_, index) =>
    start.add(index, "day").format("YYYY-MM-DD"),
  );
}

function cellKey(roomTypeId: number, date: string) {
  return `${roomTypeId}|${date}`;
}

function cellColor(
  day: InventoryDayResponse,
  state: CalendarRangeGridCellState,
) {
  if (state.disabled) return "bg-muted text-muted-foreground";
  if (state.selected) return "bg-primary/15 text-foreground";
  if (day.status === "OnRequest")
    return "bg-yellow-50 text-foreground dark:bg-yellow-950/20";
  if (day.status === "Unavailable" || day.availableCount === 0)
    return "bg-red-50 text-foreground dark:bg-red-950/20";
  return "bg-card text-foreground";
}

function cellVariant(day: InventoryDayResponse) {
  if (day.status === "OnRequest") return "onRequest" as const;
  if (day.availableCount === 0) return "unavailable" as const;
  return "available" as const;
}

export function OwnerInventoryGrid({ propertyId }: { propertyId: number }) {
  const [activeMonth, setActiveMonth] = useState(() =>
    dayjs().calendar("jalali").format("YYYY-MM"),
  );
  const [inventory, setInventory] = useState<PropertyInventoryResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const monthStart = useMemo(
    () => jalaliMonthStart(activeMonth),
    [activeMonth],
  );
  const monthDays = useMemo(() => {
    const totalDays = monthStart.daysInMonth();
    return Array.from({ length: totalDays }, (_, index) =>
      monthStart.add(index, "day"),
    );
  }, [monthStart]);

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

  const rows = useMemo<InventoryRow[]>(
    () =>
      inventory?.roomTypes.map((roomType) => ({
        id: roomType.roomTypeId,
        roomTypeId: roomType.roomTypeId,
        label: roomType.name,
        totalInventory: roomType.totalInventory,
        inventoryMode: roomType.inventoryMode,
        days: roomType.days,
      })) ?? [],
    [inventory],
  );

  useEffect(() => {
    loadMonth().catch((caught: Error) => setError(caught.message));
  }, [activeMonth, propertyId]);

  async function loadMonth() {
    setLoading(true);
    setError("");
    try {
      const from = toIso(monthDays[0]);
      const to = toIso(monthDays[monthDays.length - 1]);
      setInventory(
        await apiRequest<PropertyInventoryResponse>(
          `/owner/properties/${propertyId}/inventory?from=${from}&to=${to}`,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function moveMonth(direction: -1 | 1) {
    setActiveMonth(monthStart.add(direction, "month").format("YYYY-MM"));
  }

  function getCellValue(rowId: string | number, date: string) {
    const row = rows.find((item) => String(item.id) === String(rowId));
    return (
      row?.days.find((day) => day.date === date) ?? {
        availabilityId: null,
        roomTypeId: Number(rowId),
        date,
        availableCount: 0,
        status: "Unavailable" as AvailabilityStatus,
      }
    );
  }

  async function applyRange(payload: CalendarRangeApplyPayload) {
    setError("");
    const roomTypeId = Number(payload.rowId);
    const row = rows.find((item) => item.roomTypeId === roomTypeId);
    const max = row?.totalInventory ?? 0;
    if (payload.value < 0) throw new Error("ظرفیت نمی‌تواند منفی باشد.");
    if (max === 1 && payload.value > 1)
      throw new Error("برای این اتاق ظرفیت فقط می‌تواند ۰ یا ۱ باشد.");
    if (payload.value > max)
      throw new Error(
        `ظرفیت انتخاب‌شده نمی‌تواند بیشتر از ${toPersianNumber(max)} باشد.`,
      );

    const items = payload.items.length
      ? payload.items.map((item) => ({
          roomTypeId: Number(item.rowId),
          date: item.date,
        }))
      : datesInRange(payload.startDate, payload.endDate).map((date) => ({
          roomTypeId,
          date,
        }));
    const updated = await apiRequest<InventoryDayResponse[]>(
      `/owner/properties/${propertyId}/inventory/bulk-cells`,
      {
        method: "POST",
        body: JSON.stringify({
          items,
          availableCount: payload.status === "Unavailable" ? 0 : payload.value,
          status: payload.status ?? "Available",
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
  }

  const monthTitle = monthStart.locale("fa").format("MMMM YYYY");

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden">
      <KoochCard
        className="w-full max-w-full min-w-0 overflow-hidden"
        variant="elevated"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-foreground">
              تقویم ظرفیت اتاق‌ها
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              روی یک سلول کلیک کنید و بازه را با دستگیره‌ها تغییر دهید.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <KoochButton
              onClick={() => moveMonth(-1)}
              size="sm"
              type="button"
              variant="outline"
            >
              ماه قبل
            </KoochButton>

            <strong className="min-w-32 rounded-lg bg-muted px-4 py-2 text-center text-foreground">
              {monthTitle}
            </strong>

            <KoochButton
              onClick={() => moveMonth(1)}
              size="sm"
              type="button"
              variant="outline"
            >
              ماه بعد
            </KoochButton>
          </div>
        </div>

        {loading && (
          <p className="mt-5 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            در حال بارگذاری موجودی...
          </p>
        )}

        {error && (
          <p className="mt-5 rounded-lg border border-destructive bg-card p-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 w-full max-w-full min-w-0 overflow-hidden">
          <CalendarRangeGridEditor
            calendarType="jalali"
            cellStateResolver={(_row, _date, day) => cellVariant(day)}
            days={gridDays}
            disabledDateResolver={(date) =>
              dayjs(date).isBefore(dayjs().startOf("day"), "day")
            }
            error={error}
            getCellValue={getCellValue}
            maxValueResolver={(row) => row.totalInventory ?? 0}
            minValueResolver={() => 0}
            mode="inventory"
            onApplyRange={applyRange}
            renderCell={(_row, _date, day, state) => (
              <div
                className={`grid h-full place-items-center text-base font-black transition md:text-lg ${cellColor(day, state)}`}
              >
                <span>{toPersianNumber(day.availableCount)}</span>
              </div>
            )}
            rows={rows}
            statusOptions={statusOptions}
            valueInputType="number"
            valueLabel="ظرفیت"
          />
        </div>
      </KoochCard>
    </div>
  );
}
