"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GuestSelector, GuestSelectorValue } from "@/components/GuestSelector";
import { SharedDateRangePicker } from "@/components/SharedDateRangePicker";

export type AccommodationSearchValues = {
  q: string;
  city: string;
  checkIn: string | null;
  checkOut: string | null;
  rooms: number;
  adults: number;
  children: number;
  childAges: number[];
};

export interface AccommodationSearchBoxProps {
  /** Initial search values, usually from URL params or homepage defaults. */
  initialValues?: Partial<AccommodationSearchValues>;
  /** Visual layout: hero for homepage, compact for results header, sidebar for vertical filters. */
  variant?: "hero" | "compact" | "sidebar";
  /** Show optional title/subtitle above the fields. */
  showTitle?: boolean;
  title?: string;
  subtitle?: string;
  /** Called on submit with normalized search values. */
  onSearch?: (values: AccommodationSearchValues) => void;
  /** Redirect to resultsPath with URL-safe query params on submit. */
  redirectToResults?: boolean;
  /** Results route used when redirectToResults is true. */
  resultsPath?: string;
  className?: string;
  /** Enables future suggestion UI. Current component calls onQueryChange as user types. */
  enableSuggestions?: boolean;
  suggestions?: AccommodationSuggestion[];
  onQueryChange?: (q: string) => void;
  /** Override button text. */
  searchButtonText?: string;
}

export type AccommodationSuggestion = {
  id?: number;
  name: string;
  englishName?: string | null;
  slug?: string;
  city?: string;
};

const defaultCity = "Kashan";

function normalizeValues(values?: Partial<AccommodationSearchValues>): AccommodationSearchValues {
  const children = Math.max(0, values?.children ?? 0);
  const childAges = (values?.childAges ?? []).slice(0, children);
  while (childAges.length < children) childAges.push(5);
  return {
    q: values?.q ?? "",
    city: values?.city ?? defaultCity,
    checkIn: values?.checkIn ?? null,
    checkOut: values?.checkOut ?? null,
    rooms: Math.max(1, values?.rooms ?? 1),
    adults: Math.max(1, values?.adults ?? 2),
    children,
    childAges,
  };
}

function buildSearchParams(values: AccommodationSearchValues) {
  const query = new URLSearchParams();
  if (values.q.trim()) query.set("q", values.q.trim());
  query.set("city", values.city.trim() || defaultCity);
  if (values.checkIn) query.set("checkIn", values.checkIn);
  if (values.checkOut) query.set("checkOut", values.checkOut);
  query.set("rooms", Math.max(1, values.rooms).toString());
  query.set("adults", Math.max(1, values.adults).toString());
  query.set("children", Math.max(0, values.children).toString());
  if (values.childAges.length) query.set("childAges", values.childAges.join(","));
  return query;
}

export function AccommodationSearchBox({
  initialValues,
  variant = "compact",
  showTitle = false,
  title,
  subtitle,
  onSearch,
  redirectToResults = false,
  resultsPath = "/properties",
  className = "",
  enableSuggestions = false,
  suggestions = [],
  onQueryChange,
  searchButtonText = "جستجوی اقامتگاه",
}: AccommodationSearchBoxProps) {
  const router = useRouter();
  const [values, setValues] = useState<AccommodationSearchValues>(() => normalizeValues(initialValues));
  const [internalSuggestions, setInternalSuggestions] = useState<AccommodationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    setValues(normalizeValues(initialValues));
  }, [
    initialValues?.q,
    initialValues?.city,
    initialValues?.checkIn,
    initialValues?.checkOut,
    initialValues?.rooms,
    initialValues?.adults,
    initialValues?.children,
    initialValues?.childAges?.join(","),
  ]);

  useEffect(() => {
    if (!enableSuggestions || suggestions.length > 0 || values.q.trim().length < 1) {
      setInternalSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      q: values.q.trim(),
      city: values.city || defaultCity,
    });

    fetch(`/api/backend/properties/suggestions?${query.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((items: AccommodationSuggestion[]) => setInternalSuggestions(items))
      .catch(() => {
        if (!controller.signal.aborted) setInternalSuggestions([]);
      });

    return () => controller.abort();
  }, [enableSuggestions, suggestions.length, values.city, values.q]);

  const fieldClass =
    "h-[60px] w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]";
  const dateControlClass =
    "flex h-[60px] w-full items-center rounded-xl border bg-white px-4 text-right text-sm transition";
  const labelClass = "grid gap-2 text-sm font-bold text-slate-700";

  const shellClass =
    variant === "hero"
      ? "relative z-10 mx-auto w-full max-w-[860px] rounded-3xl border border-slate-200 bg-[#f5f6fa] p-4 pb-5 shadow-2xl sm:p-6 sm:pb-14"
      : variant === "sidebar"
        ? "rounded-2xl border border-slate-200 bg-[#f5f6fa] p-4 shadow-sm"
        : "rounded-2xl border border-slate-200 bg-[#f5f6fa] p-4 shadow-sm";

  const gridClass =
    variant === "compact"
      ? "grid gap-4 lg:grid-cols-[1.15fr_1.65fr_1.05fr_auto] lg:items-end"
      : "grid gap-4";

  function update(next: Partial<AccommodationSearchValues>) {
    setValues((current) => normalizeValues({ ...current, ...next }));
  }

  const visibleSuggestions = suggestions.length > 0 ? suggestions : internalSuggestions;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeValues(values);
    onSearch?.(normalized);
    if (redirectToResults) {
      router.push(`${resultsPath}?${buildSearchParams(normalized).toString()}`);
    }
  }

  return (
    <form className={`${shellClass} ${className}`} dir="rtl" onSubmit={submit}>
      {(showTitle || title || subtitle) && (
        <div className="mb-5 text-right">
          {title && <h2 className="text-xl font-black text-slate-950">{title}</h2>}
          {subtitle && <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>}
        </div>
      )}

      <div className={gridClass}>
        <label className={`${labelClass} relative`}>
          مقصد
          <input
            className={fieldClass}
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
            onChange={(event) => {
              update({ q: event.target.value });
              setShowSuggestions(true);
              onQueryChange?.(event.target.value);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="جستجوی اقامتگاه در کاشان"
            value={values.q}
          />
          {enableSuggestions && showSuggestions && visibleSuggestions.length > 0 && (
            <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white text-right shadow-xl">
              {visibleSuggestions.map((suggestion) => (
                <button
                  className="block w-full px-4 py-3 text-right text-sm font-bold text-slate-800 hover:bg-blue-50"
                  key={suggestion.slug ?? suggestion.id ?? suggestion.name}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    update({ q: suggestion.name, city: suggestion.city ?? values.city });
                    setShowSuggestions(false);
                  }}
                  type="button"
                >
                  {suggestion.name}
                  {suggestion.city && <span className="mr-2 text-xs font-semibold text-slate-400">{suggestion.city}</span>}
                </button>
              ))}
            </div>
          )}
        </label>

        <SharedDateRangePicker
          calendarType="jalali"
          controlClassName={dateControlClass}
          disablePastDates
          labelsAbove
          onChange={(nextValue) => update({ checkIn: nextValue.startDate, checkOut: nextValue.endDate })}
          placeholderEnd="انتخاب تاریخ"
          placeholderStart="انتخاب تاریخ"
          showFieldLabels={false}
          value={{ startDate: values.checkIn, endDate: values.checkOut }}
        />

        <GuestSelector
          controlClassName={fieldClass}
          onChange={(nextGuests: GuestSelectorValue) => update(nextGuests)}
          value={{
            rooms: values.rooms,
            adults: values.adults,
            children: values.children,
            childAges: values.childAges,
          }}
        />

        <button
          className={
            variant === "hero"
              ? "h-12 w-full rounded-full bg-[var(--theme-primary)] px-8 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-[var(--theme-primary-hover)] sm:absolute sm:bottom-[-24px] sm:left-1/2 sm:w-[58%] sm:-translate-x-1/2"
              : "h-[60px] w-full rounded-xl bg-[var(--theme-primary)] px-6 text-sm font-black text-white transition hover:bg-[var(--theme-primary-hover)]"
          }
          type="submit"
        >
          {searchButtonText}
        </button>
      </div>
    </form>
  );
}
