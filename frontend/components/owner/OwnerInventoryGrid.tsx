"use client";

import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  AvailabilityStatus,
  InventoryDayResponse,
  PropertyInventoryResponse,
} from "@/lib/owner-api";

dayjs.extend(jalaliday);

type SelectedCell = {
  roomTypeId: number;
  date: string;
};

const statusLabels: Record<AvailabilityStatus, string> = {
  Available: "موجود",
  Unavailable: "ناموجود",
  OnRequest: "نیازمند استعلام",
};

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

function cellKey(roomTypeId: number, date: string) {
  return `${roomTypeId}|${date}`;
}

export function OwnerInventoryGrid({ propertyId }: { propertyId: number }) {
  const [activeMonth, setActiveMonth] = useState(() =>
    dayjs().calendar("jalali").format("YYYY-MM"),
  );
  const [inventory, setInventory] = useState<PropertyInventoryResponse | null>(
    null,
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [newCount, setNewCount] = useState(1);
  const [newStatus, setNewStatus] = useState<AvailabilityStatus>("Available");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  const selectedCells = useMemo<SelectedCell[]>(() => {
    return Array.from(selectedKeys).map((key) => {
      const [roomTypeId, date] = key.split("|");
      return { roomTypeId: Number(roomTypeId), date };
    });
  }, [selectedKeys]);

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
      setSelectedKeys(new Set());
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  function moveMonth(direction: -1 | 1) {
    setActiveMonth(monthStart.add(direction, "month").format("YYYY-MM"));
  }

  function isSelected(roomTypeId: number, date: string) {
    return selectedKeys.has(cellKey(roomTypeId, date));
  }

  function toggleCell(roomTypeId: number, date: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      const key = cellKey(roomTypeId, date);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRow(roomTypeId: number) {
    if (!inventory) return;
    const row = inventory.roomTypes.find(
      (roomType) => roomType.roomTypeId === roomTypeId,
    );
    if (!row) return;
    const keys = row.days.map((day) => cellKey(roomTypeId, day.date));
    const allSelected = keys.every((key) => selectedKeys.has(key));
    setSelectedKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => (allSelected ? next.delete(key) : next.add(key)));
      return next;
    });
  }

  function toggleColumn(date: string) {
    if (!inventory) return;
    const keys = inventory.roomTypes.map((roomType) =>
      cellKey(roomType.roomTypeId, date),
    );
    const allSelected = keys.every((key) => selectedKeys.has(key));
    setSelectedKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => (allSelected ? next.delete(key) : next.add(key)));
      return next;
    });
  }

  function maxSelectedInventory() {
    if (!inventory || selectedCells.length === 0) return 0;
    return selectedCells.reduce((min, cell) => {
      const roomType = inventory.roomTypes.find(
        (item) => item.roomTypeId === cell.roomTypeId,
      );
      const max =
        roomType?.inventoryMode === "NamedRooms"
          ? 1
          : (roomType?.totalInventory ?? 0);
      return Math.min(min, max);
    }, Number.MAX_SAFE_INTEGER);
  }

  function validateSelection() {
    if (!inventory || selectedCells.length === 0)
      return "حداقل یک سلول را انتخاب کنید.";
    const max = maxSelectedInventory();
    const effectiveCount = newStatus === "Unavailable" ? 0 : newCount;
    if (effectiveCount < 0) return "ظرفیت نمی‌تواند منفی باشد.";
    if (effectiveCount > max) {
      return `ظرفیت انتخاب‌شده نمی‌تواند بیشتر از ${toPersianNumber(max)} باشد.`;
    }
    return "";
  }

  async function applySelectedCells() {
    const validationError = validateSelection();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const effectiveCount = newStatus === "Unavailable" ? 0 : newCount;
    try {
      const updated = await apiRequest<InventoryDayResponse[]>(
        `/owner/properties/${propertyId}/inventory/bulk-cells`,
        {
          method: "POST",
          body: JSON.stringify({
            items: selectedCells,
            availableCount: effectiveCount,
            status: newStatus,
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
              days: roomType.days.map((day) => {
                return (
                  updateMap.get(cellKey(roomType.roomTypeId, day.date)) ?? day
                );
              }),
            })),
          },
      );
      setMessage("تغییرات ظرفیت ذخیره شد.");
      setSelectedKeys(new Set());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ذخیره تغییرات انجام نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  const monthTitle = monthStart.locale("fa").format("MMMM YYYY");

  return (
    <div className="space-y-5">
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">تقویم ظرفیت اتاق‌ها</h2>
            <p className="mt-1 text-sm text-slate-500">
              سلول‌ها، ردیف‌ها یا ستون‌ها را انتخاب کنید و از پنل ویرایش گروهی
              ظرفیت را تغییر دهید.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold hover:border-blue-300 hover:text-blue-700"
              onClick={() => moveMonth(-1)}
              type="button"
            >
              ماه قبل
            </button>
            <strong className="min-w-32 rounded-xl bg-slate-50 px-4 py-2 text-center text-slate-950">
              {monthTitle}
            </strong>
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold hover:border-blue-300 hover:text-blue-700"
              onClick={() => moveMonth(1)}
              type="button"
            >
              ماه بعد
            </button>
          </div>
        </div>

        {loading && (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            در حال بارگذاری موجودی...
          </p>
        )}
        {error && selectedCells.length === 0 && (
          <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-max border-separate border-spacing-1 bg-slate-50 p-1 text-sm">
            <thead>
              <tr>
                <th className="sticky right-0 z-20 min-w-[180px] rounded-xl bg-white p-3 text-right shadow-sm">
                  اتاق / نوع اتاق
                </th>
                {monthDays.map((date) => {
                  const iso = toIso(date);
                  const allSelected = inventory?.roomTypes.length
                    ? inventory.roomTypes.every((roomType) =>
                        selectedKeys.has(cellKey(roomType.roomTypeId, iso)),
                      )
                    : false;
                  const today = iso === dayjs().format("YYYY-MM-DD");
                  return (
                    <th
                      className={`min-w-[72px] rounded-xl bg-white p-2 text-center shadow-sm ${today ? "ring-2 ring-blue-300" : ""}`}
                      key={iso}
                    >
                      <label className="grid cursor-pointer gap-1">
                        <span className="text-[11px] font-bold text-slate-400">
                          {date.locale("fa").format("ddd")}
                        </span>
                        <span className="text-base font-black text-slate-800">
                          {date.locale("fa").format("D")}
                        </span>
                        <input
                          checked={allSelected}
                          className="mx-auto h-4 w-4 accent-blue-600"
                          onChange={() => toggleColumn(iso)}
                          type="checkbox"
                        />
                      </label>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {inventory?.roomTypes.map((roomType) => {
                const rowSelected =
                  roomType.days.length > 0 &&
                  roomType.days.every((day) =>
                    selectedKeys.has(cellKey(roomType.roomTypeId, day.date)),
                  );
                return (
                  <tr key={roomType.roomTypeId}>
                    <th className="sticky right-0 z-10 min-w-[180px] rounded-xl bg-white p-3 text-right align-middle shadow-sm">
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          checked={rowSelected}
                          className="h-4 w-4 accent-blue-600"
                          onChange={() => toggleRow(roomType.roomTypeId)}
                          type="checkbox"
                        />
                        <span>
                          <span className="block font-black text-slate-900">
                            {roomType.name}
                          </span>
                          <span className="mt-1 block text-xs text-slate-400">
                            {roomType.inventoryMode === "NamedRooms"
                              ? "۰/۱"
                              : `حداکثر ${toPersianNumber(roomType.totalInventory)}`}
                          </span>
                        </span>
                      </label>
                    </th>
                    {roomType.days.map((day) => {
                      const selected = isSelected(
                        roomType.roomTypeId,
                        day.date,
                      );
                      const unavailable = day.availableCount === 0;
                      const onRequest = day.status === "OnRequest";
                      const color = onRequest
                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                        : unavailable
                          ? "bg-slate-100 text-slate-500 border border-slate-200"
                          : "bg-blue-50 text-blue-700 border border-blue-100";
                      return (
                        <td
                          className={`rounded-xl p-2 text-center ${selected ? "border-2 border-blue-500 bg-blue-100 ring-2 ring-blue-200" : ""} ${color}`}
                          key={day.date}
                        >
                          <label className="grid cursor-pointer place-items-center gap-1">
                            <input
                              checked={selected}
                              className="h-4 w-4 accent-blue-600"
                              onChange={() =>
                                toggleCell(roomType.roomTypeId, day.date)
                              }
                              type="checkbox"
                            />
                            <span className="text-lg font-black">
                              {toPersianNumber(day.availableCount)}
                            </span>
                            <span className="text-[10px] font-bold">
                              {statusLabels[day.status]}
                            </span>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!inventory?.roomTypes.length && !loading && (
            <p className="p-6 text-center text-sm text-slate-500">
              هنوز اتاقی برای این اقامتگاه ثبت نشده است.
            </p>
          )}
        </div>

        {selectedCells.length > 0 && (
          <div className="sticky bottom-0 z-30 mt-5 rounded-t-3xl border-t border-blue-200 bg-white/95 px-4 py-4 shadow-[0_-16px_40px_-24px_rgba(15,23,42,0.15)] backdrop-blur-sm">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">
                  {toPersianNumber(selectedCells.length)} سلول انتخاب شده
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  برای اعمال تغییرات ظرفیت و وضعیت، از این پنل استفاده کنید.
                </p>
              </div>
              <div className="grid w-full gap-3 sm:max-w-xl sm:grid-cols-[1.4fr_1fr]">
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  ظرفیت جدید
                  <input
                    className="rounded-xl border border-slate-300 px-3 py-2"
                    disabled={newStatus === "Unavailable"}
                    min="0"
                    onChange={(event) =>
                      setNewCount(Number(event.target.value))
                    }
                    type="number"
                    value={newStatus === "Unavailable" ? 0 : newCount}
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  وضعیت
                  <select
                    className="rounded-xl border border-slate-300 px-3 py-2"
                    onChange={(event) =>
                      setNewStatus(event.target.value as AvailabilityStatus)
                    }
                    value={newStatus}
                  >
                    <option value="Available">موجود</option>
                    <option value="Unavailable">ناموجود</option>
                    <option value="OnRequest">نیازمند استعلام</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  className="rounded-xl bg-blue-600 px-4 py-3 font-black text-white hover:bg-blue-700 disabled:opacity-60"
                  disabled={saving}
                  onClick={applySelectedCells}
                  type="button"
                >
                  {saving ? "در حال ذخیره..." : "اعمال تغییرات"}
                </button>
                <button
                  className="rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-700"
                  onClick={() => setSelectedKeys(new Set())}
                  type="button"
                >
                  لغو انتخاب
                </button>
              </div>
            </div>
            {(error || message) && (
              <div className="mx-auto mt-3 max-w-7xl space-y-2 px-4">
                {error && (
                  <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                    {error}
                  </p>
                )}
                {message && (
                  <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                    {message}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
