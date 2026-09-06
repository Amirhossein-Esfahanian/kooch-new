"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarGridDay,
  CalendarRangeApplyPayload,
  CalendarSelectionEditor,
} from "@/components/CalendarRangeGridEditor";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";

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
  /** Optional confirmation gate before applying the selected pricing cells. */
  confirmApplyRange?: (
    payload: CalendarRangeApplyPayload,
  ) => Promise<boolean> | boolean;
  /** Optional action for copying the selected cells between guest pricing types. */
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
  /** Marks holidays for destructive/red date styling. */
  holidayDateResolver?: (date: string) => boolean;
  /** Reads the daily sellable inventory used only for the compact matrix ratio. */
  getInventoryValue?: (
    rowId: RowType["id"],
    date: string,
  ) => { availableCount: number; totalInventory: number } | null;
  /** Keeps the matrix footprint stable while prices are loading. */
  loading?: boolean;
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
  pricingMinValue,
  pricingMaxValue,
  quickPricePresets = [],
  pricingCellSize = "w-[6.5rem] min-w-[6.5rem] max-w-[6.5rem]",
  dayColumnSize = "w-[5.25rem] min-w-[5.25rem] max-w-[5.25rem]",
  pricingValueResolver = (v: any) => ({ basePrice: v?.basePrice ?? 0 }),
  disabledDateResolver,
  holidayDateResolver,
  getInventoryValue,
  loading = false,
  readonly = false,
}: RoomPricingMatrixEditorProps<RowType>) {
  const [selection, setSelection] = useState(() => new Set<string>());
  const [editorValue, setEditorValue] = useState<number | "">("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const matrixRootRef = useRef<HTMLDivElement | null>(null);
  const matrixViewportRef = useRef<HTMLDivElement | null>(null);
  const [matrixViewportHeight, setMatrixViewportHeight] = useState<
    number | null
  >(null);

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

  const selectedRoomLabels = useMemo(() => {
    const selectedRoomIds = new Set(
      selectedCells.map((cell) => String(cell.roomId)),
    );
    return rows
      .filter((row) => selectedRoomIds.has(String(row.id)))
      .map((row) => row.label);
  }, [rows, selectedCells]);

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
      setLocalError("");
    }
  }, [selectedItems.length]);

  useLayoutEffect(() => {
    const viewport = matrixViewportRef.current;
    if (!viewport) return;

    let frame = 0;
    const updateHeight = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = viewport.getBoundingClientRect();
        const bottomGap = 16;
        const available = Math.floor(window.innerHeight - rect.top - bottomGap);
        setMatrixViewportHeight(Math.max(300, available));
      });
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateHeight)
        : null;
    if (matrixRootRef.current) resizeObserver?.observe(matrixRootRef.current);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateHeight);
      resizeObserver?.disconnect();
    };
  }, [loading, rows.length, days.length]);

  useLayoutEffect(() => {
    if (loading) return;
    const viewport = matrixViewportRef.current;
    if (!viewport) return;

    const frame = window.requestAnimationFrame(() => {
      const todayRow = viewport.querySelector<HTMLElement>(
        '[data-pricing-today="true"]',
      );
      if (!todayRow) return;

      const viewportRect = viewport.getBoundingClientRect();
      const rowRect = todayRow.getBoundingClientRect();
      const stickyHeaderHeight =
        viewport
          .querySelector<HTMLElement>("[data-pricing-matrix-header]")
          ?.getBoundingClientRect().height ?? 44;
      const targetTop = Math.max(
        0,
        viewport.scrollTop +
          rowRect.top -
          viewportRect.top -
          stickyHeaderHeight -
          6,
      );
      viewport.scrollTo({ top: targetTop, behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [days, loading, rows.length]);

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
    setLocalError("");
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
    if (selectedItems.length === 0 || saving) return;
    const payload = buildPayloadForApply(value);
    setSaving(true);
    setLocalError("");
    try {
      if (confirmApplyRange && !(await confirmApplyRange(payload))) return;
      await onApplyRange(payload);
      toast.success(
        `قیمت برای ${toPersianNumber(selectedItems.length)} سلول اعمال شد.`,
      );
      clearSelections();
      setPanelOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "اعمال قیمت با خطا مواجه شد.";
      setLocalError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function isOutlierValue(value: number) {
    if (typeof pricingMinValue === "number" && value < pricingMinValue) {
      return true;
    }
    if (typeof pricingMaxValue === "number" && value > pricingMaxValue) {
      return true;
    }
    return false;
  }

  async function handleApply(value: number) {
    if (!selectedItems.length || !Number.isFinite(value)) return;

    // When the parent supplies the authoritative confirmation flow, use it
    // instead of showing this component's legacy outlier dialog as well.
    if (!confirmApplyRange && isOutlierValue(value)) {
      setPendingValue(value);
      setConfirmOpen(true);
      return;
    }

    await applyValue(value);
  }

  async function handleCopyPricing() {
    if (!onCopyPricing || selectedItems.length === 0) return;

    const payload = buildPayloadForApply(
      typeof editorValue === "number"
        ? editorValue
        : (currentPrefillValue ?? 0),
    );

    try {
      setLocalError("");
      await onCopyPricing(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "کپی قیمت‌ها انجام نشد.";
      setLocalError(message);
      toast.error(message);
    }
  }

  return (
    <div ref={matrixRootRef} className="mt-5 w-full min-w-0" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {selectedItems.length > 0
            ? `${toPersianNumber(selectedDayCount)} روز انتخاب شده`
            : "برای ویرایش قیمت، سلول‌هایی را انتخاب کنید."}
        </div>
      </div>

      <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div
          ref={matrixViewportRef}
          aria-busy={loading}
          className="w-full min-w-0 overflow-auto overscroll-contain"
          style={
            matrixViewportHeight
              ? { height: `${matrixViewportHeight}px` }
              : { height: "min(62vh, 560px)" }
          }
        >
          {loading ? (
            <div className="min-h-full bg-card p-3" role="status">
              <div className="ml-auto w-full max-w-[27rem] overflow-hidden rounded-lg border border-border/70">
                <div className="grid grid-cols-[5.25rem_repeat(3,6.5rem)] border-b border-border bg-muted/70">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div
                      className="h-11 border-l border-border/70 last:border-l-0"
                      key={index}
                    />
                  ))}
                </div>
                {Array.from({ length: 9 }, (_, rowIndex) => (
                  <div
                    className="grid grid-cols-[5.25rem_repeat(3,6.5rem)] border-b border-border/60 last:border-b-0"
                    key={rowIndex}
                  >
                    {Array.from({ length: 4 }, (_, columnIndex) => (
                      <div
                        className={`h-10 border-l border-border/60 last:border-l-0 ${columnIndex === 0 ? "bg-muted/40" : "bg-card"}`}
                        key={columnIndex}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-right text-xs font-medium text-muted-foreground">
                در حال بارگذاری قیمت‌ها…
              </p>
            </div>
          ) : (
            <table className="ml-auto w-max min-w-max table-fixed border-separate border-spacing-0 text-right text-xs">
              <thead data-pricing-matrix-header>
                <tr>
                  <th
                    className={`${dayColumnSize} sticky right-0 top-0 z-50 h-11 border-b border-l border-border bg-muted px-1.5 py-1 text-center font-bold shadow-sm`}
                  >
                    روز
                  </th>
                  {rows.map((r) => (
                    <th
                      key={r.id}
                      onClick={() => toggleRoomColumn(r.id)}
                      className={`${pricingCellSize} sticky top-0 z-40 h-11 cursor-pointer border-b border-l border-border bg-card px-1.5 py-1 text-center align-middle shadow-sm transition duration-150 ease-out hover:bg-muted`}
                      title={r.label}
                    >
                      <span className="block truncate text-[11px] font-semibold leading-4 text-foreground">
                        {r.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const isDisabled = Boolean(disabledDateResolver?.(d.date));
                  const isHoliday =
                    holidayDateResolver?.(d.date) ?? d.weekday.includes("جمعه");
                  return (
                    <tr
                      key={d.date}
                      data-pricing-today={d.isToday ? "true" : undefined}
                      className={d.isToday ? "bg-primary/[0.04]" : undefined}
                    >
                      <th
                        onClick={() => !isDisabled && toggleDayRow(d.date)}
                        className={`${dayColumnSize} sticky right-0 z-30 h-10 border-b border-l border-border px-1 py-0.5 text-center align-middle shadow-sm ${d.isToday ? "bg-primary/[0.08] ring-1 ring-inset ring-primary/50" : isDisabled ? "bg-muted" : "bg-card"} ${isDisabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/70"}`}
                      >
                        <div className="flex items-baseline justify-center gap-1 whitespace-nowrap">
                          <span
                            className={`text-[11px] font-bold leading-4 ${isHoliday ? (isDisabled ? "text-destructive/70" : "text-destructive") : isDisabled ? "text-muted-foreground" : "text-foreground"}`}
                          >
                            {toPersianDigits(d.label)}
                          </span>
                          <span
                            className={`text-[9px] font-medium leading-3 ${isHoliday ? (isDisabled ? "text-destructive/60" : "text-destructive") : isDisabled ? "text-muted-foreground/70" : "text-muted-foreground"}`}
                          >
                            <span className="sm:hidden">
                              {d.weekdayShort ?? d.weekday.slice(0, 1)}
                            </span>
                            <span className="hidden sm:inline">
                              {d.weekday}
                            </span>
                          </span>
                        </div>
                      </th>
                      {rows.map((r) => {
                        const cell = getCellValue(r.id, d.date) ?? {};
                        const basePrice =
                          pricingValueResolver(cell)?.basePrice ?? 0;
                        const inventoryValue =
                          getInventoryValue?.(r.id, d.date) ?? null;
                        const k = keyFor(r.id, d.date);
                        const selected = selection.has(k);
                        const disabled = readonly || isDisabled;
                        const inventoryLabel =
                          inventoryValue && inventoryValue.totalInventory > 0
                            ? `${toPersianNumber(inventoryValue.availableCount)}/${toPersianNumber(inventoryValue.totalInventory)}`
                            : "—";
                        return (
                          <td
                            key={String(r.id) + "|" + d.date}
                            className={`${pricingCellSize} h-10 border-b border-l border-border p-0 text-center align-middle`}
                          >
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => toggleCell(r.id, d.date)}
                              className={`h-full w-full px-1 py-0.5 text-center transition duration-150 ease-out ${selected ? "bg-primary/15 ring-1 ring-inset ring-primary" : disabled ? "bg-muted text-muted-foreground" : d.isToday ? "bg-primary/[0.04] hover:bg-primary/[0.08]" : "bg-card hover:bg-muted/70"}`}
                            >
                              <div
                                className={`truncate text-[11px] font-bold leading-4 ${disabled ? "text-muted-foreground" : "text-foreground"}`}
                                title={formatPrice(basePrice)}
                              >
                                {formatPrice(basePrice)}
                              </div>
                              <div
                                className={`truncate text-[9px] leading-3 ${disabled ? "text-muted-foreground/70" : "text-muted-foreground"}`}
                                title="موجودی روز / ظرفیت کل"
                              >
                                {inventoryLabel}
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
          )}
        </div>
      </div>

      <CalendarSelectionEditor
        error={localError}
        mixedPricingValue={hasMixedValues}
        mode="pricing"
        onCancel={clearSelections}
        onCopyPricing={
          onCopyPricing ? () => void handleCopyPricing() : undefined
        }
        onOpenChange={setPanelOpen}
        onPriceValueChange={(value) => {
          setEditorValue(value);
          setLocalError("");
        }}
        onSave={() => {
          if (typeof editorValue === "number" && Number.isFinite(editorValue)) {
            return handleApply(editorValue);
          }
          setLocalError("قیمت معتبر وارد کنید.");
        }}
        open={panelOpen}
        priceValue={typeof editorValue === "number" ? editorValue : Number.NaN}
        pricingCurrencyLabel={pricingCurrencyLabel}
        quickPricePresets={quickPricePresets}
        saving={saving}
        selectedCount={selectedItems.length}
        selectedDayCount={selectedDayCount}
        selectedRoomLabels={selectedRoomLabels}
        selectionRangeCount={selectedItems.length}
        valueInputType="number"
        valueLabel="نرخ اتاق"
      />

      <KoochConfirmDialog
        cancelText="انصراف"
        confirmText="ادامه و اعمال"
        description="قیمت واردشده خارج از بازه‌ی مجاز است. آیا ادامه می‌دهید؟"
        onConfirm={async () => {
          if (pendingValue !== null) {
            await applyValue(pendingValue);
            setPendingValue(null);
            setConfirmOpen(false);
          }
        }}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title="تایید قیمت خارج از محدوده"
        variant="warning"
      />
    </div>
  );
}

export default RoomPricingMatrixEditor;
