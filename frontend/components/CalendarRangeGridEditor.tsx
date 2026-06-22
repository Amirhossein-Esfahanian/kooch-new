"use client";

import {
  PointerEvent,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AvailabilityStatus } from "@/lib/owner-api";
import { toast } from "sonner";

export type CalendarGridRow = {
  id: number | string;
  label: string;
  totalInventory?: number;
};

export type CalendarGridDay = {
  date: string;
  label: string;
  weekday: string;
  isToday?: boolean;
};

export type CalendarRangeGridCellState = {
  selected: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
  inRange: boolean;
  disabled: boolean;
  variant?: "available" | "unavailable" | "reserved" | "onRequest" | "default";
};

export type CalendarRangeApplyPayload = {
  rowId: number | string;
  startDate: string;
  endDate: string;
  value: number;
  status?: AvailabilityStatus;
  /** All selected cells. Range selections and scattered multi-select both save through this list. */
  items: { rowId: number | string; date: string }[];
};

export interface CalendarRangeGridEditorProps<
  Row extends CalendarGridRow,
  Value,
> {
  /** Rows shown in the grid. Inventory passes room types; pricing/discounts can pass their own rows later. */
  rows: Row[];
  /** Visible days. Parent owns Jalali/Gregorian conversion; dates must be Gregorian ISO strings. */
  days: CalendarGridDay[];
  /** Reads the current value for one cell. */
  getCellValue: (rowId: Row["id"], date: string) => Value;
  /** Renders the visible cell content. Keep labels out of cells; the editor owns selection UI. */
  renderCell: (
    row: Row,
    date: string,
    value: Value,
    state: CalendarRangeGridCellState,
  ) => ReactNode;
  /** Saves selected cells/range. `items` contains the exact selected cells. */
  onApplyRange: (payload: CalendarRangeApplyPayload) => Promise<void> | void;
  /** Current editor mode. Inventory uses capacity/status; pricing can reuse this with price fields later. */
  mode: "inventory" | "pricing";
  /** Label for the main value input, for example ظرفیت or قیمت. */
  valueLabel: string;
  /** Input type for the main value field. */
  valueInputType?: "number" | "text";
  /** Minimum valid value for a row. */
  minValueResolver?: (row: Row) => number;
  /** Maximum valid value for a row. */
  maxValueResolver?: (row: Row) => number;
  /** Optional status selector, used by inventory. */
  statusOptions?: { value: AvailabilityStatus; label: string }[];
  /** Blocks selecting a date, for example past days. Row/column selection and dragging skip these. */
  disabledDateResolver?: (date: string) => boolean;
  /** Semantic cell state for reusable styling: available, unavailable, reserved, onRequest. */
  cellStateResolver?: (
    row: Row,
    date: string,
    value: Value,
  ) => CalendarRangeGridCellState["variant"];
  /** Informational calendar type; parent controls actual conversion. */
  calendarType?: "jalali" | "gregorian";
  /** Read-only mode disables selection but keeps the grid visible. */
  readonly?: boolean;
  /** Optional parent error. */
  error?: string;
  /** Optional parent success message. */
  message?: string;
}

type RangeSelection = {
  rowId: number | string;
  startIndex: number;
  endIndex: number;
};

type SelectedRange = {
  id: string;
  roomTypeId: number | string;
  startDate: string;
  endDate: string;
  mode: SelectionMode;
};

type SelectionMode = "range" | "single";
type DragTarget = { selectionId: string; edge: "start" | "end" } | null;

function toPersianNumber(value: string | number) {
  return new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(
    Number(value),
  );
}

function keyOf(rowId: number | string, date: string) {
  return `${rowId}|${date}`;
}

function normalizeRange(range: RangeSelection): RangeSelection {
  return range.startIndex <= range.endIndex
    ? range
    : { ...range, startIndex: range.endIndex, endIndex: range.startIndex };
}

export function CalendarRangeGridEditor<Row extends CalendarGridRow, Value>({
  rows,
  days,
  getCellValue,
  renderCell,
  onApplyRange,
  mode,
  valueLabel,
  valueInputType = "number",
  minValueResolver,
  maxValueResolver,
  statusOptions,
  disabledDateResolver,
  cellStateResolver,
  readonly = false,
  error,
  message,
}: CalendarRangeGridEditorProps<Row, Value>) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const selectionSequence = useRef(0);
  const [selectedRanges, setSelectedRanges] = useState<SelectedRange[]>([]);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("range");
  const [isDesktop, setIsDesktop] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);
  const [popupPosition, setPopupPosition] = useState({ top: 8, left: 16 });
  const [value, setValue] = useState(1);
  const [status, setStatus] = useState<AvailabilityStatus>("Available");
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function endDrag() {
      setDragTarget(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    function syncMode() {
      const desktop = media.matches;
      setIsDesktop(desktop);
      setSelectionMode(desktop ? "range" : "single");
    }

    syncMode();
    media.addEventListener("change", syncMode);
    return () => media.removeEventListener("change", syncMode);
  }, []);

  useEffect(() => {
    if (selectionMode !== "single") return;
    setSelectedRanges((current) => {
      if (!current.some((selection) => selection.mode === "range")) return current;
      const converted: SelectedRange[] = [];
      current.forEach((selection) => {
        if (selection.mode !== "range") {
          converted.push(selection);
          return;
        }
        const startIndex = days.findIndex((day) => day.date === selection.startDate);
        const endIndex = days.findIndex((day) => day.date === selection.endDate);
        if (startIndex < 0 || endIndex < 0) return;
        rangeKeys(selection.roomTypeId, startIndex, endIndex).forEach((key) => {
          const date = key.slice(key.indexOf("|") + 1);
          converted.push({
            id: makeSelectionId(),
            roomTypeId: selection.roomTypeId,
            startDate: date,
            endDate: date,
            mode: "single",
          });
        });
      });
      return converted;
    });
  }, [days, selectionMode]);

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    selectedRanges.forEach((range) => {
      const startIndex = days.findIndex((day) => day.date === range.startDate);
      const endIndex = days.findIndex((day) => day.date === range.endDate);
      if (startIndex < 0 || endIndex < 0) return;
      rangeKeys(range.roomTypeId, startIndex, endIndex).forEach((key) => keys.add(key));
    });
    return keys;
  }, [days, selectedRanges]);
  const selectedItems = useMemo(() => {
    return Array.from(selectedKeys).map((key) => {
      const separator = key.indexOf("|");
      return { rowId: key.slice(0, separator), date: key.slice(separator + 1) };
    });
  }, [selectedKeys]);
  const selectedCount = selectedItems.length;

  useEffect(() => {
    if (selectedRanges.length === 0) {
      setActiveSelectionId(null);
      setIsMinimized(true);
      return;
    }
    if (!selectedRanges.some((range) => range.id === activeSelectionId)) {
      setActiveSelectionId(selectedRanges[0].id);
    }
  }, [activeSelectionId, selectedRanges]);

  const activeSelection = useMemo(
    () => selectedRanges.find((range) => range.id === activeSelectionId) ?? selectedRanges[0] ?? null,
    [activeSelectionId, selectedRanges],
  );
  const activeRange = useMemo<RangeSelection | null>(() => {
    if (!activeSelection) return null;
    const startIndex = days.findIndex((day) => day.date === activeSelection.startDate);
    const endIndex = days.findIndex((day) => day.date === activeSelection.endDate);
    return startIndex < 0 || endIndex < 0 ? null : normalizeRange({ rowId: activeSelection.roomTypeId, startIndex, endIndex });
  }, [activeSelection, days]);
  const activeRow = useMemo(
    () => rows.find((row) => activeSelection && row.id === activeSelection.roomTypeId) ?? null,
    [activeSelection, rows],
  );

  useLayoutEffect(() => {
    function updatePosition() {
      if (!isDesktop || !selectedCount || !wrapperRef.current) return;
      const wrapper = wrapperRef.current;
      const selectedCells = Array.from(
        wrapper.querySelectorAll<HTMLElement>(
          "[data-calendar-active-selected='true']",
        ),
      );
      if (!selectedCells.length) return;

      const rects = selectedCells.map((cell) => cell.getBoundingClientRect());
      const rangeRect = rects.reduce(
        (current, rect) => ({
          top: Math.min(current.top, rect.top),
          right: Math.max(current.right, rect.right),
          bottom: Math.max(current.bottom, rect.bottom),
          left: Math.min(current.left, rect.left),
        }),
        {
          top: rects[0].top,
          right: rects[0].right,
          bottom: rects[0].bottom,
          left: rects[0].left,
        },
      );
      const popupWidth = popupRef.current?.offsetWidth || 360;
      const popupHeight = popupRef.current?.offsetHeight || 220;
      const gap = 10;
      const hasRoomAbove = rangeRect.top - popupHeight - gap >= 8;
      const top = hasRoomAbove
        ? rangeRect.top - popupHeight - gap
        : Math.min(
            window.innerHeight - popupHeight - 8,
            rangeRect.bottom + gap,
          );
      const centeredLeft =
        rangeRect.left +
        (rangeRect.right - rangeRect.left) / 2 -
        popupWidth / 2;

      setPopupPosition({
        top: Math.max(8, top),
        left: Math.min(
          Math.max(8, centeredLeft),
          window.innerWidth - popupWidth - 8,
        ),
      });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [activeRange, days, isDesktop, selectedCount]);

  function dayDisabled(dayIndex: number) {
    return Boolean(readonly || disabledDateResolver?.(days[dayIndex].date));
  }

  function rangeKeys(
    rowId: Row["id"] | string | number,
    startIndex: number,
    endIndex: number,
  ) {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    return days
      .slice(start, end + 1)
      .filter((day) => !disabledDateResolver?.(day.date))
      .map((day) => keyOf(rowId, day.date));
  }

  function makeSelectionId() {
    selectionSequence.current += 1;
    return `selection-${selectionSequence.current}`;
  }

  function overlapsExistingRange(range: RangeSelection, excludeId?: string) {
    const normalized = normalizeRange(range);
    const startDate = days[normalized.startIndex].date;
    const endDate = days[normalized.endIndex].date;
    return selectedRanges.some((selection) =>
      selection.id !== excludeId &&
      selection.roomTypeId === normalized.rowId &&
      startDate <= selection.endDate &&
      endDate >= selection.startDate);
  }

  function showOverlapError() {
    toast.error("این بازه با بازه انتخاب‌شده قبلی همپوشانی دارد", { id: "calendar-range-overlap" });
  }

  function mergeAdjacentRanges(range: RangeSelection, excludeId?: string) {
    let normalized = normalizeRange(range);
    const mergedIds = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const selection of selectedRanges) {
        if (selection.id === excludeId || mergedIds.has(selection.id) || selection.mode !== "range" || selection.roomTypeId !== normalized.rowId) continue;
        const start = days.findIndex((day) => day.date === selection.startDate);
        const end = days.findIndex((day) => day.date === selection.endDate);
        if (end + 1 === normalized.startIndex || normalized.endIndex + 1 === start) {
          normalized = normalizeRange({ rowId: normalized.rowId, startIndex: Math.min(start, normalized.startIndex), endIndex: Math.max(end, normalized.endIndex) });
          mergedIds.add(selection.id);
          changed = true;
        }
      }
    }
    return { normalized, mergedIds };
  }

  function addRange(range: RangeSelection, rangeMode: SelectionMode = selectionMode) {
    let normalized = normalizeRange(range);
    if (overlapsExistingRange(normalized)) {
      showOverlapError();
      return;
    }
    const mergedIds = new Set<string>();
    if (rangeMode === "range") {
      const merged = mergeAdjacentRanges(normalized);
      normalized = merged.normalized;
      merged.mergedIds.forEach((id) => mergedIds.add(id));
    }
    const id = makeSelectionId();
    setSelectedRanges((current) => [...current.filter((selection) => !mergedIds.has(selection.id)), {
      id,
      roomTypeId: normalized.rowId,
      startDate: days[normalized.startIndex].date,
      endDate: days[normalized.endIndex].date,
      mode: rangeMode,
    }]);
    setActiveSelectionId(id);
  }

  function replaceTemporaryOneDayRange(selectionId: string, range: RangeSelection) {
    let normalized = normalizeRange(range);
    if (overlapsExistingRange(normalized, selectionId)) {
      showOverlapError();
      return;
    }
    const merged = mergeAdjacentRanges(normalized, selectionId);
    normalized = merged.normalized;
    const id = makeSelectionId();
    setSelectedRanges((current) => [...current.filter((selection) =>
      selection.id !== selectionId && !merged.mergedIds.has(selection.id)), {
      id,
      roomTypeId: normalized.rowId,
      startDate: days[normalized.startIndex].date,
      endDate: days[normalized.endIndex].date,
      mode: "range",
    }]);
    setActiveSelectionId(id);
  }

  function updateRange(selectionId: string, range: RangeSelection) {
    let normalized = normalizeRange(range);
    if (overlapsExistingRange(normalized, selectionId)) {
      showOverlapError();
      return;
    }
    const selection = selectedRanges.find((item) => item.id === selectionId);
    const merged = selection?.mode === "range" ? mergeAdjacentRanges(normalized, selectionId) : { normalized, mergedIds: new Set<string>() };
    normalized = merged.normalized;
    setSelectedRanges((current) => current.filter((item) => !merged.mergedIds.has(item.id)).map((item) => item.id === selectionId
      ? { ...item, roomTypeId: normalized.rowId, startDate: days[normalized.startIndex].date, endDate: days[normalized.endIndex].date }
      : item));
  }

  function removeSelection(selectionId: string) {
    setSelectedRanges((current) => current.filter((selection) => selection.id !== selectionId));
    setActiveSelectionId((current) => current === selectionId ? null : current);
  }

  function clearSelections() {
    setSelectedRanges([]);
    setActiveSelectionId(null);
    setIsMinimized(true);
    setLocalError("");
  }

  function removeDateFromRows(rowIds: Set<string>, dayIndex: number) {
    setSelectedRanges((current) => current.flatMap((selection) => {
      if (!rowIds.has(String(selection.roomTypeId))) return [selection];
      const start = days.findIndex((day) => day.date === selection.startDate);
      const end = days.findIndex((day) => day.date === selection.endDate);
      if (dayIndex < start || dayIndex > end) return [selection];
      if (start === end) return [];
      if (dayIndex === start) return [{ ...selection, startDate: days[start + 1].date }];
      if (dayIndex === end) return [{ ...selection, endDate: days[end - 1].date }];
      return [
        { ...selection, endDate: days[dayIndex - 1].date },
        { ...selection, id: makeSelectionId(), startDate: days[dayIndex + 1].date },
      ];
    }));
  }

  function toggleCell(rowId: Row["id"], dayIndex: number) {
    if (dayDisabled(dayIndex)) return;
    setLocalError("");
    if (selectionMode === "range") {
      const nextRange = { rowId, startIndex: dayIndex, endIndex: dayIndex };
      const temporaryOneDayRange = activeSelection?.mode === "range" && activeSelection.startDate === activeSelection.endDate
        ? activeSelection
        : null;
      if (temporaryOneDayRange) replaceTemporaryOneDayRange(temporaryOneDayRange.id, nextRange);
      else addRange(nextRange);
      return;
    }
    const exactSelection = selectedRanges.find((selection) =>
      selection.mode === "single" && selection.roomTypeId === rowId && selection.startDate === days[dayIndex].date && selection.endDate === days[dayIndex].date);
    if (exactSelection) removeSelection(exactSelection.id);
    else addRange({ rowId, startIndex: dayIndex, endIndex: dayIndex }, "single");
  }

  function toggleRow(row: Row) {
    if (readonly) return;
    const keys = days
      .filter((day) => !disabledDateResolver?.(day.date))
      .map((day) => keyOf(row.id, day.date));
    const allSelected =
      keys.length > 0 && keys.every((key) => selectedKeys.has(key));
    if (allSelected) {
      setSelectedRanges((current) => current.filter((selection) => selection.roomTypeId !== row.id));
    } else if (days.length) {
      const id = makeSelectionId();
      setSelectedRanges((current) => [...current.filter((selection) => selection.roomTypeId !== row.id), {
        id,
        roomTypeId: row.id,
        startDate: days[0].date,
        endDate: days[days.length - 1].date,
        mode: "single",
      }]);
      setActiveSelectionId(id);
    }
  }

  function toggleColumn(dayIndex: number) {
    if (dayDisabled(dayIndex)) return;
    const date = days[dayIndex].date;
    const keys = rows.map((row) => keyOf(row.id, date));
    const allSelected =
      keys.length > 0 && keys.every((key) => selectedKeys.has(key));
    if (allSelected) removeDateFromRows(new Set(rows.map((row) => String(row.id))), dayIndex);
    else rows.filter((row) => !selectedKeys.has(keyOf(row.id, date))).forEach((row) => addRange({ rowId: row.id, startIndex: dayIndex, endIndex: dayIndex }, "single"));
  }

  function startHandleDrag(selectionId: string, edge: "start" | "end", event: PointerEvent) {
    if (selectionMode !== "range") return;
    event.stopPropagation();
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    setActiveSelectionId(selectionId);
    setDragTarget({ selectionId, edge });
  }

  function extendHandle(rowId: Row["id"], dayIndex: number) {
    if (!dragTarget || dayDisabled(dayIndex)) return;
    const selection = selectedRanges.find((range) => range.id === dragTarget.selectionId);
    if (!selection || selection.roomTypeId !== rowId) return;
    const startIndex = days.findIndex((day) => day.date === selection.startDate);
    const endIndex = days.findIndex((day) => day.date === selection.endDate);
    if (startIndex < 0 || endIndex < 0) return;
    updateRange(selection.id, dragTarget.edge === "start"
      ? { rowId, startIndex: dayIndex, endIndex }
      : { rowId, startIndex, endIndex: dayIndex });
  }

  function validate() {
    if (selectedItems.length === 0)
      return "حداقل یک خانه را انتخاب کنید.";
    const selectedRows = new Set(selectedItems.map((item) => item.rowId));
    const rowsToCheck = rows.filter((row) => selectedRows.has(String(row.id)));
    const effectiveValue = status === "Unavailable" ? 0 : value;

    for (const row of rowsToCheck) {
      const min = minValueResolver?.(row) ?? 0;
      const max = maxValueResolver?.(row) ?? Number.MAX_SAFE_INTEGER;
      if (effectiveValue < min || ((row.totalInventory ?? max) === 1 && effectiveValue > 1) || effectiveValue > max)
        return mode === "inventory"
          ? "ظرفیت وارد شده برای برخی اتاق‌ها معتبر نیست"
          : `${valueLabel} برای برخی ردیف‌ها معتبر نیست.`;
    }
    return "";
  }

  async function applySelection() {
    const validation = validate();
    if (validation || selectedItems.length === 0) {
      setLocalError(validation);
      if (validation) toast.error(validation, { id: "calendar-save-error" });
      return;
    }

    const sortedItems = selectedItems
      .slice()
      .sort(
        (first, second) =>
          String(first.rowId).localeCompare(String(second.rowId)) ||
          first.date.localeCompare(second.date),
      );
    setSaving(true);
    setLocalError("");
    try {
      await onApplyRange({
        rowId: sortedItems[0].rowId,
        startDate: sortedItems[0].date,
        endDate: sortedItems[sortedItems.length - 1].date,
        value: status === "Unavailable" ? 0 : value,
        status,
        items: sortedItems,
      });
      clearSelections();
      toast.success(mode === "inventory" ? "ظرفیت با موفقیت ذخیره شد" : "تغییرات با موفقیت ذخیره شد");
    } catch (caught) {
      const saveError = caught instanceof Error ? caught.message : "ذخیره تغییرات انجام نشد.";
      setLocalError(saveError);
      toast.error(saveError, { id: "calendar-save-error" });
    } finally {
      setSaving(false);
    }
  }

  function selectionLabel(range: SelectedRange) {
    const row = rows.find((item) => item.id === range.roomTypeId);
    const startDay = days.find((day) => day.date === range.startDate);
    const endDay = days.find((day) => day.date === range.endDate);
    const dates = range.startDate === range.endDate
      ? (startDay?.label ?? range.startDate)
      : `${startDay?.label ?? range.startDate}–${endDay?.label ?? range.endDate}`;
    return `${row?.label ?? range.roomTypeId} | ${dates}`;
  }

  const editorPanel =
    selectedCount > 0 && activeRow ? (
      <>
        <div
          aria-hidden={isMinimized}
          className={`fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-[var(--theme-primary-border)] bg-white p-4 shadow-2xl transition-all duration-[250ms] ease-out md:inset-x-auto md:bottom-auto md:w-[360px] ${
            isMinimized
              ? "pointer-events-none invisible scale-95 opacity-0"
              : "visible scale-100 opacity-100"
          }`}
          ref={popupRef}
          style={{
            left: isDesktop ? popupPosition.left : undefined,
            top: isDesktop ? popupPosition.top : undefined,
          }}
        >
          <button
            aria-label="کوچک‌کردن پنل ویرایش"
            className="flex items-center justify-center absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-lg font-black leading-none text-slate-500 transition hover:border-[var(--theme-primary-border)] hover:bg-[var(--theme-primary-soft)] hover:text-[var(--theme-primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
            onClick={() => setIsMinimized(true)}
            title="کوچک‌ کردن"
            type="button"
          >
            <span aria-hidden="true" className="relative top-[1px]">
              —
            </span>
          </button>
          <div className="flex items-start justify-between gap-3 pr-9">
            <div>
              <h3 className="font-black text-slate-950">
                {mode === "inventory" ? "ویرایش ظرفیت" : "ویرایش بازه"}
              </h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {toPersianNumber(selectedCount)} خانه در {toPersianNumber(selectedRanges.length)} بازه انتخاب شده
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-bold text-slate-700">
              {valueLabel}
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]"
                disabled={status === "Unavailable"}
                min={
                  activeRow ? (minValueResolver?.(activeRow as Row) ?? 0) : 0
                }
                onChange={(event) => setValue(Number(event.target.value))}
                type={valueInputType}
                value={status === "Unavailable" ? 0 : value}
              />
            </label>
            {statusOptions && (
              <label className="flex flex-col gap-2 text-sm font-bold text-slate-700">
                وضعیت
                <select
                  className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]"
                  onChange={(event) =>
                    setStatus(event.target.value as AvailabilityStatus)
                  }
                  value={status}
                >
                  {statusOptions?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {(localError || error || message) && (
            <div className="mt-3 grid gap-2">
              {(localError || error) && (
                <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                  {localError || error}
                </p>
              )}
              {message && (
                <p className="rounded-xl bg-[var(--theme-primary-soft)] p-3 text-sm font-semibold text-[var(--theme-primary-text)]">
                  {message}
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
              onClick={clearSelections}
              type="button"
            >
              لغو
            </button>
            <button
              className="rounded-xl bg-[var(--theme-primary)] px-5 py-2 text-sm font-black text-white hover:bg-[var(--theme-primary-hover)] disabled:opacity-60"
              disabled={saving}
              onClick={applySelection}
              type="button"
            >
              {saving ? "در حال ذخیره..." : "ذخیره"}
            </button>
          </div>
        </div>

      </>
    ) : null;

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-sm font-bold text-[var(--theme-muted-text)]">حالت انتخاب:</span>
            <div className="inline-flex rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-1">
              {[
                { value: "range" as const, label: "انتخاب بازه‌ای" },
                { value: "single" as const, label: "انتخاب تکی" },
              ].map((option) => (
                <button
                  className={`rounded-lg px-3 py-1.5 text-sm font-black transition ${selectionMode === option.value ? "bg-[var(--theme-primary)] text-white shadow-sm" : "text-[var(--theme-muted-text)] hover:text-[var(--theme-text)]"}`}
                  key={option.value}
                  onClick={() => setSelectionMode(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs font-bold text-[var(--theme-muted-text)] md:hidden">حالت انتخاب تکی</span>
          {selectedRanges.length > 0 && (
            <button
              className="rounded-lg border border-[var(--theme-danger)] bg-white px-3 py-2 text-xs font-black text-[var(--theme-danger)] transition hover:bg-[var(--theme-danger-soft)]"
              onClick={clearSelections}
              type="button"
            >
              پاک کردن انتخاب‌ها
            </button>
          )}
        </div>
        {selectedRanges.length > 0 && isMinimized && (
          <button
            aria-label="بازکردن پنل ویرایش"
            className="grid h-12 w-32 place-items-center rounded-md bg-[var(--theme-primary)] text-white shadow-lg ring-1 ring-black/5 transition hover:bg-[var(--theme-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] focus-visible:ring-offset-2"
            onClick={() => setIsMinimized(false)}
            title="بازکردن پنل ویرایش"
            type="button"
          >
            <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.83 2.83 0 0 0-4-4L4 16v4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /><path d="m13.5 6.5 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>
            <span className="text-xs font-normal text-white">{toPersianNumber(selectedCount)} خانه انتخاب شده</span>
          </button>
        )}
      </div>
      {editorPanel &&
        (isDesktop && typeof document !== "undefined"
          ? createPortal(editorPanel, document.body)
          : editorPanel)}
      <div className="overflow-x-auto rounded-2xl border border-[var(--theme-border)]">
        <table className="min-w-max border-collapse bg-white text-sm">
          <thead>
            <tr>
              <th className="sticky right-0 z-30 min-w-[180px] border border-[var(--theme-border)] bg-white p-3 text-right shadow-sm">
                اتاق / نوع اتاق
              </th>
              {days.map((day, dayIndex) => {
                const disabled = dayDisabled(dayIndex);
                return (
                  <th
                    className={`min-w-[68px] border border-[var(--theme-border)] bg-white p-0 text-center ${day.isToday ? "ring-2 ring-[var(--theme-primary-border)]" : ""}`}
                    key={day.date}
                  >
                    <button
                      className={`h-full w-full px-2 py-2 ${disabled ? "cursor-not-allowed text-slate-300" : "hover:bg-[var(--theme-primary-soft)]"}`}
                      disabled={disabled}
                      onClick={() => toggleColumn(dayIndex)}
                      type="button"
                    >
                      <span className="block text-[11px] font-bold text-slate-400">
                        {day.weekday}
                      </span>
                      <span className="block text-base font-black text-slate-800">
                        {day.label}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th className="sticky right-0 z-30 min-w-[180px] border border-[var(--theme-border)] bg-white p-0 text-right align-middle shadow-sm">
                  <button
                    className="h-full w-full px-3 py-2 text-right hover:bg-[var(--theme-primary-soft)]"
                    onClick={() => toggleRow(row)}
                    type="button"
                  >
                    <span className="block font-black text-slate-900">
                      {row.label}
                    </span>
                  </button>
                </th>
                {days.map((day, dayIndex) => {
                  const cellValue = getCellValue(row.id, day.date);
                  const disabled = dayDisabled(dayIndex);
                  const selected = selectedKeys.has(keyOf(row.id, day.date));
                  const rangesForCell = selectedRanges.filter((range) => {
                    if (range.roomTypeId !== row.id) return false;
                    const start = days.findIndex((item) => item.date === range.startDate);
                    const end = days.findIndex((item) => item.date === range.endDate);
                    return dayIndex >= Math.min(start, end) && dayIndex <= Math.max(start, end);
                  });
                  const endingRanges = selectedRanges.filter((range) => range.roomTypeId === row.id && range.endDate === day.date);
                  const startingRanges = selectedRanges.filter((range) => range.roomTypeId === row.id && range.startDate === day.date);
                  const rangeStart = selectedRanges.some((range) => range.roomTypeId === row.id && range.startDate === day.date);
                  const rangeEnd = endingRanges.length > 0;
                  const inRange = rangesForCell.some((range) => range.startDate !== day.date && range.endDate !== day.date);
                  const activeSelected = Boolean(activeRange?.rowId === row.id && dayIndex >= activeRange.startIndex && dayIndex <= activeRange.endIndex);
                  const state = {
                    selected,
                    rangeStart,
                    rangeEnd,
                    inRange,
                    disabled,
                    variant: cellStateResolver?.(row, day.date, cellValue),
                  };

                  return (
                    <td
                      className={`relative h-10 min-w-[68px] select-none border border-[var(--theme-border)] p-0 text-center md:h-11 ${disabled ? "cursor-not-allowed bg-slate-100" : dragTarget ? "cursor-ew-resize" : "cursor-pointer"} ${selected ? "bg-[var(--theme-primary-light)] shadow-inner ring-1 ring-inset ring-[var(--theme-primary)]" : ""}`}
                      data-calendar-selected={selected ? "true" : undefined}
                      data-calendar-active-selected={activeSelected ? "true" : undefined}
                      key={`${row.id}-${day.date}`}
                      onPointerEnter={() => extendHandle(row.id, dayIndex)}
                    >
                      <button
                        className={`h-full w-full ${dragTarget ? "cursor-ew-resize" : ""}`}
                        disabled={disabled}
                        onClick={() => toggleCell(row.id, dayIndex)}
                        type="button"
                      >
                        {renderCell(row, day.date, cellValue, state)}
                      </button>
                      {selectionMode === "range" && startingRanges.filter((range) => range.mode === "range").map((range) => (
                        <button
                          aria-label="تغییر شروع بازه"
                          className="absolute right-0 top-1/2 z-20 hidden h-[18px] w-[18px] translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-[var(--theme-primary)] shadow-md ring-2 ring-white md:grid"
                          key={`start-handle-${range.id}`}
                          onPointerDown={(event) => startHandleDrag(range.id, "start", event)}
                          type="button"
                        >
                          <span className="h-2.5 w-[2px] rounded bg-white/90" />
                          <span className="absolute h-2.5 w-[2px] translate-x-1 rounded bg-white/90" />
                        </button>
                      ))}
                      {selectionMode === "range" && endingRanges.filter((range) => range.mode === "range").map((range) => (
                        <button
                          aria-label="تغییر پایان بازه"
                          className="absolute left-0 top-1/2 z-20 hidden h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-[var(--theme-primary)] shadow-md ring-2 ring-white md:grid"
                          key={`end-handle-${range.id}`}
                          onPointerDown={(event) => startHandleDrag(range.id, "end", event)}
                          type="button"
                        >
                          <span className="h-2.5 w-[2px] rounded bg-white/90" />
                          <span className="absolute h-2.5 w-[2px] translate-x-1 rounded bg-white/90" />
                        </button>
                      ))}
                      {selectionMode === "range" && endingRanges.filter((range) => range.mode === "range").map((range) => (
                        <button
                          aria-label={`حذف انتخاب ${selectionLabel(range)}`}
                          className="absolute left-0 top-0 z-20 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--theme-danger)] bg-white text-[11px] font-black text-[var(--theme-danger)] shadow-md hover:bg-[var(--theme-danger-soft)]"
                          key={range.id}
                          onClick={(event) => { event.stopPropagation(); removeSelection(range.id); }}
                          type="button"
                        >
                          X
                        </button>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">
            هنوز موردی برای نمایش ثبت نشده است.
          </p>
        )}
      </div>
    </div>
  );
}
