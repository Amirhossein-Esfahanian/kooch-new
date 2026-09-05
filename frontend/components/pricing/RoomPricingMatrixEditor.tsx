"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarGridDay,
  CalendarRangeApplyPayload,
  CalendarSelectionEditor,
} from "@/components/CalendarRangeGridEditor";

type PricingMatrixRoom = {
  id: number | string;
  label: string;
  totalInventory?: number;
  isActive?: boolean;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function toPersianNumber(value: string | number) {
  return new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(
    Number(value),
  );
}

function toPersianDigits(value: string | number) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

export interface RoomPricingMatrixEditorProps<
  RowType extends PricingMatrixRoom,
> {
  rows: RowType[]; // rooms (columns)
  days: CalendarGridDay[]; // rows (days)
  getCellValue: (rowId: RowType["id"], date: string) => any;
  onApplyRange: (payload: CalendarRangeApplyPayload) => Promise<void> | void;
  confirmApplyRange?: (
    payload: CalendarRangeApplyPayload,
  ) => Promise<boolean> | boolean;
  onCopyPricing?: (payload: CalendarRangeApplyPayload) => Promise<void> | void;
  pricingCurrencyLabel?: string;
  pricingMinValue?: number;
  pricingMaxValue?: number;
  quickPricePresets?: number[];
  pricingCellSize?: string; // e.g. 'w-20 h-12'
  dayColumnSize?: string; // e.g. 'w-32'
  pricingValueResolver?: (value: any) => { basePrice: number };
  /** Blocks selecting a date, for example past days. */
  disabledDateResolver?: (date: string) => boolean;
  readonly?: boolean;
  childPrice?: number | null;
  extraGuestPrice?: number | null;
}

export function RoomPricingMatrixEditor<RowType extends PricingMatrixRoom>({
  rows,
  days,
  getCellValue,
  onApplyRange,
  confirmApplyRange,
  onCopyPricing,
  pricingCurrencyLabel,
  pricingMinValue = 0,
  pricingMaxValue = Number.MAX_SAFE_INTEGER,
  quickPricePresets = [],
  dayColumnSize = "w-14 min-w-14 max-w-14 sm:w-16 sm:min-w-16 sm:max-w-16 md:w-20 md:min-w-20 md:max-w-20",
  pricingValueResolver = (v: any) => ({ basePrice: v?.basePrice ?? 0 }),
  disabledDateResolver,
  readonly = false,
}: RoomPricingMatrixEditorProps<RowType>) {
  const [selection, setSelection] = useState(() => new Set<string>());
  const [editorValue, setEditorValue] = useState<number | "">("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");

  const selectedItems = useMemo(() => Array.from(selection), [selection]);
  const selectedCells = useMemo(() => {
    return selectedItems
      .map((key) => {
        const [roomId, date] = key.split("|");
        return {
          roomId: isNaN(Number(roomId)) ? roomId : Number(roomId),
          date,
        };
      })
      .filter((cell) => Boolean(cell.date));
  }, [selectedItems]);

  const selectedDayCount = useMemo(() => {
    return new Set(selectedCells.map((cell) => cell.date)).size;
  }, [selectedCells]);

  const selectedValues = useMemo(() => {
    return selectedCells
      .map((cell) => {
        const value = getCellValue(cell.roomId, cell.date);
        return pricingValueResolver(value)?.basePrice ?? 0;
      })
      .filter((value) => Number.isFinite(value));
  }, [selectedCells, getCellValue, pricingValueResolver]);

  const hasMixedValues =
    selectedValues.length > 0 && new Set(selectedValues).size > 1;
  const currentPrefillValue =
    selectedValues.length > 0 && !hasMixedValues ? selectedValues[0] : null;

  useEffect(() => {
    if (!selectedValues.length) {
      setEditorValue("");
      return;
    }

    if (!hasMixedValues && currentPrefillValue !== null) {
      setEditorValue(currentPrefillValue);
    } else {
      setEditorValue("");
    }
  }, [currentPrefillValue, hasMixedValues, selectedValues.length]);

  useEffect(() => {
    if (selectedItems.length === 0) {
      setPanelOpen(false);
    }
  }, [selectedItems.length]);

  function keyFor(roomId: number | string, date: string) {
    return `${roomId}|${date}`;
  }

  function toggleCell(roomId: number | string, date: string) {
    if (readonly) return;
    if (disabledDateResolver?.(date)) return;
    const k = keyFor(roomId, date);
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleDayRow(date: string) {
    if (readonly) return;
    if (disabledDateResolver?.(date)) return;
    setSelection((s) => {
      const next = new Set(s);
      // check selectable cells for the date across rooms
      const selectableKeys = rows
        .filter((r) => !disabledDateResolver?.(date))
        .map((r) => keyFor(r.id, date));
      const allSelected = selectableKeys.every((k) => s.has(k));
      if (allSelected) {
        for (const k of selectableKeys) next.delete(k);
      } else {
        for (const k of selectableKeys) next.add(k);
      }
      return next;
    });
  }

  function toggleRoomColumn(roomId: number | string) {
    if (readonly) return;
    setSelection((s) => {
      const next = new Set(s);
      // only consider selectable dates
      const selectableDates = days.filter(
        (d) => !disabledDateResolver?.(d.date),
      );
      const keys = selectableDates.map((d) => keyFor(roomId, d.date));
      const allSelected = keys.every((k) => s.has(k));
      if (allSelected) {
        for (const k of keys) next.delete(k);
      } else {
        for (const k of keys) next.add(k);
      }
      return next;
    });
  }

  function clearSelections() {
    setSelection(new Set());
    setEditorValue("");
  }

  function buildPayloadForApply(value: number): CalendarRangeApplyPayload {
    const items = selectedItems
      .map((key) => {
        const [roomId, date] = key.split("|");
        return {
          rowId: isNaN(Number(roomId)) ? roomId : Number(roomId),
          date,
        };
      })
      .filter((item) => Boolean(item.date))
      .sort(
        (first, second) =>
          String(first.rowId).localeCompare(String(second.rowId)) ||
          first.date.localeCompare(second.date),
      );

    const dates = items.map((item) => item.date).sort();

    return {
      rowId: items[0]?.rowId ?? rows[0]?.id ?? "",
      startDate: dates[0] ?? days[0]?.date ?? "",
      endDate: dates[dates.length - 1] ?? days[days.length - 1]?.date ?? "",
      value,
      basePrice: value,
      items,
      selectionRangeCount: items.length,
    } satisfies CalendarRangeApplyPayload;
  }

  async function applyValue(value: number) {
    if (selectedItems.length === 0) return;
    const payload = buildPayloadForApply(value);

    if (confirmApplyRange && !(await confirmApplyRange(payload))) return;

    setSaving(true);
    setEditorError("");
    try {
      await onApplyRange(payload);
      toast.success(
        `قیمت برای ${toPersianNumber(selectedItems.length)} سلول اعمال شد.`,
      );
      clearSelections();
      setPanelOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "اعمال قیمت با خطا مواجه شد.";
      setEditorError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApply(value: number) {
    if (!selectedItems.length) return;
    if (!Number.isFinite(value)) {
      setEditorError("برای قیمت مقدار معتبر وارد کنید.");
      return;
    }
    if (value < pricingMinValue || value > pricingMaxValue) {
      setEditorError(
        `مبلغ باید بین ${formatPrice(pricingMinValue)} و ${formatPrice(
          pricingMaxValue,
        )} باشد.`,
      );
      return;
    }
    await applyValue(value);
  }

  async function copyPricingSelection() {
    if (!onCopyPricing || selectedItems.length === 0) return;
    const value =
      typeof editorValue === "number"
        ? editorValue
        : (currentPrefillValue ?? 0);
    setSaving(true);
    setEditorError("");
    try {
      await onCopyPricing(buildPayloadForApply(value));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "کپی قیمت‌ها انجام نشد.";
      setEditorError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 max-w-5xl" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {selectedItems.length > 0
            ? `${toPersianNumber(selectedDayCount)} روز انتخاب شده`
            : "برای ویرایش قیمت، سلول‌هایی را انتخاب کنید."}
        </div>
      </div>

      <CalendarSelectionEditor
        error={editorError}
        mixedPricingValue={hasMixedValues}
        mode="pricing"
        onCancel={() => {
          clearSelections();
          setPanelOpen(false);
          setEditorError("");
        }}
        onCopyPricing={onCopyPricing ? copyPricingSelection : undefined}
        onOpenChange={setPanelOpen}
        onPriceValueChange={(value) => {
          setEditorValue(value);
          setEditorError("");
        }}
        onSave={() => {
          if (typeof editorValue === "number" && Number.isFinite(editorValue)) {
            return handleApply(editorValue);
          }
        }}
        open={panelOpen}
        priceValue={typeof editorValue === "number" ? editorValue : Number.NaN}
        pricingCurrencyLabel={pricingCurrencyLabel}
        quickPricePresets={quickPricePresets}
        saving={saving}
        selectedCount={selectedItems.length}
        selectedDayCount={selectedDayCount}
        selectionRangeCount={selectedItems.length}
      />

      <div className="mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[30rem] max-w-[64rem] table-fixed border-collapse text-right">
            <thead>
              <tr>
                <th
                  className={`${dayColumnSize} border border-border bg-muted px-2 py-2 text-center font-bold`}
                >
                  روز
                </th>
                {rows.map((r) => (
                  <th
                    key={r.id}
                    onClick={() => toggleRoomColumn(r.id)}
                    className="h-24 min-w-[7rem] max-w-[8.5rem] cursor-pointer border border-border bg-card px-2 py-2 text-center align-top transition hover:bg-muted"
                    title={r.label}
                  >
                    <span className="block truncate whitespace-normal break-words text-xs font-semibold leading-5 text-foreground sm:text-sm">
                      {r.label}
                    </span>
                    <span className="mt-1 block text-[10px] font-medium text-muted-foreground sm:text-xs">
                      موجودی: {toPersianNumber(r.totalInventory ?? 0)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const isDisabled = Boolean(disabledDateResolver?.(d.date));
                return (
                  <tr key={d.date}>
                    <th
                      onClick={() => !isDisabled && toggleDayRow(d.date)}
                      className={`${dayColumnSize} border border-border p-2 text-center align-middle ${isDisabled ? "cursor-not-allowed bg-muted" : "cursor-pointer hover:bg-muted/70"}`}
                    >
                      <span
                        className={`block text-xs font-bold ${isDisabled ? "text-muted-foreground" : "text-foreground"} sm:text-sm`}
                      >
                        {toPersianDigits(d.label)}
                      </span>
                      <span
                        className={`block text-[10px] font-medium ${isDisabled ? "text-muted-foreground/70" : "text-muted-foreground"} sm:text-xs`}
                      >
                        <span className="sm:hidden">
                          {d.weekdayShort ?? d.weekday.slice(0, 1)}
                        </span>
                        <span className="hidden sm:inline">{d.weekday}</span>
                      </span>
                    </th>
                    {rows.map((r) => {
                      const cell = getCellValue(r.id, d.date) ?? {};
                      const basePrice =
                        pricingValueResolver(cell)?.basePrice ?? 0;
                      const isActive = cell.isActive ?? r.isActive ?? true;
                      const cellInventory =
                        cell.available ??
                        cell.inventory ??
                        cell.capacity ??
                        "-";
                      const k = keyFor(r.id, d.date);
                      const selected = selection.has(k);
                      const disabled = readonly || isDisabled;
                      return (
                        <td
                          key={String(r.id) + "|" + d.date}
                          className="h-20 min-h-20 border border-border p-0 text-center align-middle sm:h-20 md:h-24"
                        >
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => toggleCell(r.id, d.date)}
                            className={`h-full w-full p-2 text-center transition ${selected ? "bg-primary/15 ring-1 ring-inset ring-primary" : disabled ? "bg-muted text-muted-foreground" : "bg-card hover:bg-muted/70"}`}
                          >
                            <div
                              className={`font-bold ${disabled ? "text-muted-foreground" : "text-foreground"}`}
                            >
                              {formatPrice(basePrice)}
                            </div>
                            <div
                              className={`text-[10px] sm:text-xs ${disabled ? "text-muted-foreground/70" : "text-foreground"}`}
                            >
                              {isActive ? "فعال" : "غیرفعال"}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {typeof cellInventory === "number"
                                ? toPersianNumber(cellInventory)
                                : toPersianDigits(cellInventory)}
                            </div>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default RoomPricingMatrixEditor;
