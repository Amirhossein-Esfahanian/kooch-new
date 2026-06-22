"use client";

import {
  CSSProperties,
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

type DragMode = "start" | "end" | null;
type SelectionMode = "range" | "single";

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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [activeRange, setActiveRange] = useState<RangeSelection | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("range");
  const [isDesktop, setIsDesktop] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 8, left: 16 });
  const [value, setValue] = useState(1);
  const [status, setStatus] = useState<AvailabilityStatus>("Available");
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function endDrag() {
      setDragMode(null);
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

  const normalizedRange = activeRange ? normalizeRange(activeRange) : null;
  const selectedItems = useMemo(() => {
    return Array.from(selectedKeys).map((key) => {
      const separator = key.indexOf("|");
      return { rowId: key.slice(0, separator), date: key.slice(separator + 1) };
    });
  }, [selectedKeys]);
  const selectedCount = selectedItems.length;

  useEffect(() => {
    if (selectedCount === 0) setIsMinimized(false);
  }, [selectedCount]);

  const firstSelectedRow = useMemo(
    () =>
      rows.find((row) =>
        selectedItems.some((item) => String(row.id) === item.rowId),
      ) ?? null,
    [rows, selectedItems],
  );
  const activeRow = useMemo(
    () =>
      rows.find((row) => normalizedRange && row.id === normalizedRange.rowId) ??
      firstSelectedRow,
    [firstSelectedRow, normalizedRange, rows],
  );

  useLayoutEffect(() => {
    function updatePosition() {
      if (!isDesktop || !selectedCount || !wrapperRef.current) return;
      const wrapper = wrapperRef.current;
      const selectedCells = Array.from(
        wrapper.querySelectorAll<HTMLElement>(
          "[data-calendar-selected='true']",
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
  }, [activeRange, days, isDesktop, selectedCount, selectedKeys]);

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

  function replaceRange(range: RangeSelection) {
    const normalized = normalizeRange(range);
    setSelectedKeys(
      new Set(
        rangeKeys(normalized.rowId, normalized.startIndex, normalized.endIndex),
      ),
    );
    setActiveRange(normalized);
  }

  function toggleCell(rowId: Row["id"], dayIndex: number) {
    if (dayDisabled(dayIndex)) return;
    const key = keyOf(rowId, days[dayIndex].date);
    setLocalError("");
    if (selectionMode === "range") {
      replaceRange({ rowId, startIndex: dayIndex, endIndex: dayIndex });
      return;
    }
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setActiveRange(null);
  }

  function toggleRow(row: Row) {
    if (readonly) return;
    const keys = days
      .filter((day) => !disabledDateResolver?.(day.date))
      .map((day) => keyOf(row.id, day.date));
    const allSelected =
      keys.length > 0 && keys.every((key) => selectedKeys.has(key));
    setSelectedKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => (allSelected ? next.delete(key) : next.add(key)));
      return next;
    });
    setActiveRange(null);
  }

  function toggleColumn(dayIndex: number) {
    if (dayDisabled(dayIndex)) return;
    const date = days[dayIndex].date;
    const keys = rows.map((row) => keyOf(row.id, date));
    const allSelected =
      keys.length > 0 && keys.every((key) => selectedKeys.has(key));
    setSelectedKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => (allSelected ? next.delete(key) : next.add(key)));
      return next;
    });
    setActiveRange(null);
  }

  function startHandleDrag(
    modeName: Exclude<DragMode, null>,
    event: PointerEvent,
  ) {
    if (selectionMode !== "range") return;
    event.stopPropagation();
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    setDragMode(modeName);
  }

  function extendHandle(rowId: Row["id"], dayIndex: number) {
    if (
      !dragMode ||
      !activeRange ||
      activeRange.rowId !== rowId ||
      dayDisabled(dayIndex)
    )
      return;
    const next =
      dragMode === "start"
        ? { ...activeRange, startIndex: dayIndex }
        : { ...activeRange, endIndex: dayIndex };
    replaceRange(next);
  }

  function validate() {
    if (!activeRow || selectedItems.length === 0)
      return "حداقل یک خانه را انتخاب کنید.";
    const selectedRows = new Set(selectedItems.map((item) => item.rowId));
    const rowsToCheck = rows.filter((row) => selectedRows.has(String(row.id)));
    const effectiveValue = status === "Unavailable" ? 0 : value;

    for (const row of rowsToCheck) {
      const min = minValueResolver?.(row) ?? 0;
      const max = maxValueResolver?.(row) ?? Number.MAX_SAFE_INTEGER;
      if (effectiveValue < min)
        return `${valueLabel} نمی‌تواند کمتر از ${toPersianNumber(min)} باشد.`;
      if ((row.totalInventory ?? max) === 1 && effectiveValue > 1)
        return "برای این اتاق ظرفیت فقط می‌تواند ۰ یا ۱ باشد.";
      if (effectiveValue > max)
        return `${valueLabel} نمی‌تواند بیشتر از ${toPersianNumber(max)} باشد.`;
    }
    return "";
  }

  async function applySelection() {
    const validation = validate();
    if (validation || selectedItems.length === 0) {
      setLocalError(validation);
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
      setSelectedKeys(new Set());
      setActiveRange(null);
    } catch (caught) {
      setLocalError(
        caught instanceof Error ? caught.message : "ذخیره تغییرات انجام نشد.",
      );
    } finally {
      setSaving(false);
    }
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
                {toPersianNumber(selectedCount)} خانه انتخاب شده
              </p>
            </div>
            {/* <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600" onClick={() => { setSelectedKeys(new Set()); setActiveRange(null); }} type="button">
          لغو
        </button> */}
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
              onClick={() => {
                setSelectedKeys(new Set());
                setActiveRange(null);
              }}
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

        <button
          aria-label="بازکردن پنل ویرایش"
          className={`fixed bottom-4 right-4 z-[60] grid h-12 w-12 place-items-center rounded-full bg-[var(--theme-primary)] text-white shadow-2xl ring-1 ring-black/5 transition-all duration-[250ms] ease-out hover:bg-[var(--theme-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] focus-visible:ring-offset-2 md:bottom-6 md:right-6 ${
            isMinimized
              ? "visible scale-100 opacity-100"
              : "pointer-events-none invisible scale-95 opacity-0"
          }`}
          onClick={() => setIsMinimized(false)}
          title="بازکردن پنل ویرایش"
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M4 20h4l10.5-10.5a2.83 2.83 0 0 0-4-4L4 16v4Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            <path
              d="m13.5 6.5 4 4"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
        </button>
      </>
    ) : null;

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="mb-3 hidden items-center justify-end gap-3 md:flex">
        <span className="text-sm font-bold text-[var(--theme-muted-text)]">
          حالت انتخاب:
        </span>
        <div className="inline-flex rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-1">
          {[
            { value: "range" as const, label: "انتخاب بازه‌ای" },
            { value: "single" as const, label: "انتخاب تکی" },
          ].map((option) => (
            <button
              className={`rounded-lg px-3 py-1.5 text-sm font-black transition ${
                selectionMode === option.value
                  ? "bg-[var(--theme-primary)] text-white shadow-sm"
                  : "text-[var(--theme-muted-text)] hover:text-[var(--theme-text)]"
              }`}
              key={option.value}
              onClick={() => {
                setSelectionMode(option.value);
                setSelectedKeys(new Set());
                setActiveRange(null);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {editorPanel &&
        (isDesktop && typeof document !== "undefined"
          ? createPortal(editorPanel, document.body)
          : editorPanel)}
      {false && selectedCount > 0 && activeRow && (
        <div
          className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-[var(--theme-primary-border)] bg-white p-4 shadow-2xl md:absolute md:inset-x-auto md:bottom-auto md:left-[var(--calendar-popup-left)] md:top-[var(--calendar-popup-top)] md:w-[360px]"
          style={
            {
              "--calendar-popup-left": `${popupPosition.left}px`,
              "--calendar-popup-top": `${popupPosition.top}px`,
            } as CSSProperties
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-black text-slate-950">
                {mode === "inventory" ? "ویرایش ظرفیت" : "ویرایش بازه"}
              </h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {toPersianNumber(selectedCount)} خانه انتخاب شده
              </p>
            </div>
            <button
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600"
              onClick={() => {
                setSelectedKeys(new Set());
                setActiveRange(null);
              }}
              type="button"
            >
              لغو
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-bold text-slate-700">
              {valueLabel}
              <input
                className="rounded-xl border border-slate-300 h-11 px-3 outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]"
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
                  className="rounded-xl border border-slate-300 h-11 px-3 outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]"
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
              onClick={() => {
                setSelectedKeys(new Set());
                setActiveRange(null);
              }}
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
      )}

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
                  const rangeStart = Boolean(
                    selectionMode === "range" &&
                    normalizedRange?.rowId === row.id &&
                    normalizedRange.startIndex === dayIndex,
                  );
                  const rangeEnd = Boolean(
                    selectionMode === "range" &&
                    normalizedRange?.rowId === row.id &&
                    normalizedRange.endIndex === dayIndex,
                  );
                  const inRange = Boolean(
                    selectionMode === "range" &&
                    normalizedRange?.rowId === row.id &&
                    dayIndex > normalizedRange.startIndex &&
                    dayIndex < normalizedRange.endIndex,
                  );
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
                      className={`relative h-10 min-w-[68px] select-none border border-[var(--theme-border)] p-0 text-center md:h-11 ${disabled ? "cursor-not-allowed bg-slate-100" : dragMode ? "cursor-ew-resize" : "cursor-pointer"} ${selected ? "bg-[var(--theme-primary-light)] shadow-inner ring-1 ring-inset ring-[var(--theme-primary)]" : ""}`}
                      data-calendar-selected={selected ? "true" : undefined}
                      key={`${row.id}-${day.date}`}
                      onPointerEnter={() => extendHandle(row.id, dayIndex)}
                    >
                      <button
                        className={`h-full w-full ${dragMode ? "cursor-ew-resize" : ""}`}
                        disabled={disabled}
                        onClick={() => toggleCell(row.id, dayIndex)}
                        type="button"
                      >
                        {renderCell(row, day.date, cellValue, state)}
                      </button>
                      {rangeStart && (
                        <button
                          aria-label="تغییر شروع بازه"
                          className="absolute right-0 top-1/2 z-20 hidden h-[18px] w-[18px] translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-[var(--theme-primary)] shadow-md ring-2 ring-white md:grid"
                          onPointerDown={(event) =>
                            startHandleDrag("start", event)
                          }
                          type="button"
                        >
                          <span className="h-2.5 w-[2px] rounded bg-white/90" />
                          <span className="absolute h-2.5 w-[2px] translate-x-1 rounded bg-white/90" />
                        </button>
                      )}
                      {rangeEnd && (
                        <button
                          aria-label="تغییر پایان بازه"
                          className="absolute left-0 top-1/2 z-20 hidden h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-[var(--theme-primary)] shadow-md ring-2 ring-white md:grid"
                          onPointerDown={(event) =>
                            startHandleDrag("end", event)
                          }
                          type="button"
                        >
                          <span className="h-2.5 w-[2px] rounded bg-white/90" />
                          <span className="absolute h-2.5 w-[2px] translate-x-1 rounded bg-white/90" />
                        </button>
                      )}
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
