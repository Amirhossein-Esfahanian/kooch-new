"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";

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
function shortWeekdayLabel(value: string) {
  return value.trim().slice(0, 1);
}

function toPersianDigits(value: string | number) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

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
  if (state.selected) return "bg-[var(--theme-primary-soft)] text-foreground";
  if (day.status === "Unavailable" || day.availableCount === 0)
    return "bg-red-50 text-foreground dark:bg-red-950/20";
  if (day.status === "OnRequest")
    return "bg-amber-50 text-foreground dark:bg-amber-400/20";
  return "bg-card text-foreground";
}

function cellVariant(day: InventoryDayResponse) {
  if (day.status === "OnRequest") return "onRequest" as const;
  if (day.availableCount === 0) return "unavailable" as const;
  return "available" as const;
}

function statusLabel(status: AvailabilityStatus | undefined) {
  return (
    statusOptions.find((option) => option.value === status)?.label ?? "نامشخص"
  );
}

export function OwnerInventoryGrid({
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
  const [inventory, setInventory] = useState<PropertyInventoryResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkConfirmPayload, setBulkConfirmPayload] =
    useState<CalendarRangeApplyPayload | null>(null);
  const bulkConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );

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
        const weekday = date.locale("fa").format("ddd");

        return {
          date: iso,
          label: toPersianDigits(date.locale("fa").format("D")),
          weekday,
          weekdayShort: shortWeekdayLabel(weekday),
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
  const roomsHref =
    context === "admin"
      ? `/admin/properties/${propertyId}/rooms`
      : `/owner/properties/${propertyId}/rooms`;
  const hasLoadedInventory = inventory !== null;
  const hasRooms = rows.length > 0;
  const hasInventoryInSelectedRange = rows.some((row) =>
    row.days.some((day) => day.availabilityId != null),
  );
  const shouldShowNoRoomsState = hasLoadedInventory && !hasRooms;
  const shouldShowNoInventoryWarning =
    hasLoadedInventory && hasRooms && !hasInventoryInSelectedRange;

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

  function getBulkConfirmDetails(payload: CalendarRangeApplyPayload | null) {
    if (!payload) {
      return {
        affectedDays: 0,
        capacity: "-",
        rangeCount: 0,
        roomNames: "-",
        status: "-",
      };
    }

    const selectedRoomIds = new Set(
      payload.items.map((item) => String(item.rowId)),
    );
    const selectedDates = new Set(payload.items.map((item) => item.date));
    const roomNames = rows
      .filter((row) => selectedRoomIds.has(String(row.id)))
      .map((row) => row.label);

    return {
      affectedDays: selectedDates.size,
      capacity:
        payload.status === "Unavailable" ? "0" : toPersianNumber(payload.value),
      rangeCount: payload.selectionRangeCount ?? 1,
      roomNames: roomNames.length > 0 ? roomNames.join("، ") : "-",
      status: statusLabel(payload.status),
    };
  }

  function shouldConfirmBulkApply(payload: CalendarRangeApplyPayload) {
    const affectedDays = new Set(payload.items.map((item) => item.date)).size;
    return affectedDays > 14 || (payload.selectionRangeCount ?? 1) > 3;
  }

  function resolveBulkConfirmation(confirmed: boolean) {
    bulkConfirmResolverRef.current?.(confirmed);
    bulkConfirmResolverRef.current = null;
    setBulkConfirmOpen(false);
    setBulkConfirmPayload(null);
  }

  function confirmBulkApply(payload: CalendarRangeApplyPayload) {
    if (!shouldConfirmBulkApply(payload)) return true;
    return new Promise<boolean>((resolve) => {
      bulkConfirmResolverRef.current = resolve;
      setBulkConfirmPayload(payload);
      setBulkConfirmOpen(true);
    });
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

  const monthTitle = toPersianDigits(
    monthStart.locale("fa").format("MMMM YYYY"),
  );
  const bulkConfirmDetails = getBulkConfirmDetails(bulkConfirmPayload);

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
                بعد از ساخت اتاق‌ها می‌توانید ظرفیت روزانه را ثبت کنید.
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
            {shouldShowNoInventoryWarning && (
              <KoochAlert
                className="mt-5"
                dir="rtl"
                title="ظرفیت ثبت نشده"
                variant="warning"
              >
                هنوز ظرفیتی برای این اقامتگاه ثبت نشده است.
              </KoochAlert>
            )}
            {shouldShowNoInventoryWarning && (
              <p className="mt-3 rounded-xl border border-border bg-muted px-4 py-3 text-right text-sm font-semibold text-muted-foreground">
                برای این بازه هنوز ظرفیتی ثبت نشده است.
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
                confirmApplyRange={confirmBulkApply}
                onApplyRange={applyRange}
                renderCell={(_row, _date, day, state) => (
                  <div
                    className={`grid h-full place-items-center text-xs font-semibold transition sm:text-sm md:text-base lg:text-lg ${cellColor(day, state)}`}
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
          </>
        )}

        <KoochConfirmDialog
          cancelText="انصراف"
          confirmText="تایید و ذخیره"
          description="این تغییر روی تعداد زیادی روز یا اتاق اعمال می‌شود. آیا مطمئن هستید؟"
          onConfirm={() => resolveBulkConfirmation(true)}
          onOpenChange={(open) => {
            if (!open) resolveBulkConfirmation(false);
            else setBulkConfirmOpen(true);
          }}
          open={bulkConfirmOpen}
          title="تغییر گروهی ظرفیت"
          variant="warning"
        >
          <dl className="grid gap-3 rounded-lg border border-border bg-muted p-3 text-right text-sm">
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">
                تعداد روزهای اثرگرفته
              </dt>
              <dd className="font-black text-foreground">
                {toPersianNumber(bulkConfirmDetails.affectedDays)} روز در{" "}
                {toPersianNumber(bulkConfirmDetails.rangeCount)} بازه
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">اتاق‌ها</dt>
              <dd className="font-black text-foreground">
                {bulkConfirmDetails.roomNames}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">وضعیت</dt>
              <dd className="font-black text-foreground">
                {bulkConfirmDetails.status}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-bold text-muted-foreground">ظرفیت</dt>
              <dd className="font-black text-foreground">
                {bulkConfirmDetails.capacity}
              </dd>
            </div>
          </dl>
        </KoochConfirmDialog>
      </KoochCard>
    </div>
  );
}
