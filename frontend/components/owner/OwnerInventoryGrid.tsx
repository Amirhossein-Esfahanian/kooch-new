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
  return new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(Number(value));
}

function jalaliMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return dayjs().calendar("jalali").year(year).month(monthNumber - 1).date(1).startOf("day");
}

function toIso(date: Dayjs) {
  return date.calendar("gregory").format("YYYY-MM-DD");
}

function datesInRange(startDate: string, endDate: string) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const totalDays = Math.max(0, end.diff(start, "day"));
  return Array.from({ length: totalDays + 1 }, (_, index) => start.add(index, "day").format("YYYY-MM-DD"));
}

function cellKey(roomTypeId: number, date: string) {
  return `${roomTypeId}|${date}`;
}

function cellColor(day: InventoryDayResponse, state: CalendarRangeGridCellState) {
  if (state.disabled) return "bg-slate-100 text-slate-400";
  if (state.selected) return "bg-[var(--theme-primary-light)] text-[var(--theme-text)]";
  if (day.status === "OnRequest") return "bg-amber-50 text-amber-800";
  if (day.availableCount === 0) return "bg-rose-50 text-rose-700";
  return "bg-[var(--theme-surface-muted)] text-[var(--theme-text)]";
}

function cellVariant(day: InventoryDayResponse) {
  if (day.status === "OnRequest") return "onRequest" as const;
  if (day.availableCount === 0) return "unavailable" as const;
  return "available" as const;
}

export function OwnerInventoryGrid({ propertyId }: { propertyId: number }) {
  const [activeMonth, setActiveMonth] = useState(() => dayjs().calendar("jalali").format("YYYY-MM"));
  const [inventory, setInventory] = useState<PropertyInventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const monthStart = useMemo(() => jalaliMonthStart(activeMonth), [activeMonth]);
  const monthDays = useMemo(() => {
    const totalDays = monthStart.daysInMonth();
    return Array.from({ length: totalDays }, (_, index) => monthStart.add(index, "day"));
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
      setInventory(await apiRequest<PropertyInventoryResponse>(`/owner/properties/${propertyId}/inventory?from=${from}&to=${to}`));
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  function moveMonth(direction: -1 | 1) {
    setActiveMonth(monthStart.add(direction, "month").format("YYYY-MM"));
  }

  function getCellValue(rowId: string | number, date: string) {
    const row = rows.find((item) => item.id === rowId);
    return row?.days.find((day) => day.date === date) ?? {
      availabilityId: null,
      roomTypeId: Number(rowId),
      date,
      availableCount: 0,
      status: "Unavailable" as AvailabilityStatus,
    };
  }

  async function applyRange(payload: CalendarRangeApplyPayload) {
    setError("");
    setMessage("");
    const roomTypeId = Number(payload.rowId);
    const row = rows.find((item) => item.roomTypeId === roomTypeId);
    const max = row?.totalInventory ?? 0;
    if (payload.value < 0) throw new Error("ظرفیت نمی‌تواند منفی باشد.");
    if (max === 1 && payload.value > 1) throw new Error("برای این اتاق ظرفیت فقط می‌تواند ۰ یا ۱ باشد.");
    if (payload.value > max) throw new Error(`ظرفیت انتخاب‌شده نمی‌تواند بیشتر از ${toPersianNumber(max)} باشد.`);

    const items = payload.items.length
      ? payload.items.map((item) => ({ roomTypeId: Number(item.rowId), date: item.date }))
      : datesInRange(payload.startDate, payload.endDate).map((date) => ({ roomTypeId, date }));
    const updated = await apiRequest<InventoryDayResponse[]>(`/owner/properties/${propertyId}/inventory/bulk-cells`, {
      method: "POST",
      body: JSON.stringify({
        items,
        availableCount: payload.status === "Unavailable" ? 0 : payload.value,
        status: payload.status ?? "Available",
      }),
    });

    const updateMap = new Map(updated.map((item) => [cellKey(item.roomTypeId, item.date), item]));
    setInventory((current) =>
      current && {
        ...current,
        roomTypes: current.roomTypes.map((roomType) => ({
          ...roomType,
          days: roomType.days.map((day) => updateMap.get(cellKey(roomType.roomTypeId, day.date)) ?? day),
        })),
      },
    );
    setMessage("تغییرات ظرفیت ذخیره شد.");
  }

  const monthTitle = monthStart.locale("fa").format("MMMM YYYY");

  return (
    <div className="space-y-5">
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">تقویم ظرفیت اتاق‌ها</h2>
            <p className="mt-1 text-sm text-slate-500">
              روی یک سلول کلیک کنید و بازه را با دستگیره‌ها تغییر دهید.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]" onClick={() => moveMonth(-1)} type="button">
              ماه قبل
            </button>
            <strong className="min-w-32 rounded-xl bg-slate-50 px-4 py-2 text-center text-slate-950">
              {monthTitle}
            </strong>
            <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]" onClick={() => moveMonth(1)} type="button">
              ماه بعد
            </button>
          </div>
        </div>

        {loading && <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">در حال بارگذاری موجودی...</p>}
        {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

        <div className="mt-5">
          <CalendarRangeGridEditor
            calendarType="jalali"
            cellStateResolver={(_row, _date, day) => cellVariant(day)}
            days={gridDays}
            disabledDateResolver={(date) => dayjs(date).isBefore(dayjs().startOf("day"), "day")}
            error={error}
            getCellValue={getCellValue}
            maxValueResolver={(row) => row.totalInventory ?? 0}
            message={message}
            minValueResolver={() => 0}
            mode="inventory"
            onApplyRange={applyRange}
            renderCell={(_row, _date, day, state) => (
              <div className={`grid h-full place-items-center text-base font-black transition md:text-lg ${cellColor(day, state)}`}>
                <span>{toPersianNumber(day.availableCount)}</span>
              </div>
            )}
            rows={rows}
            statusOptions={statusOptions}
            valueInputType="number"
            valueLabel="ظرفیت"
          />
        </div>
      </section>
    </div>
  );
}
