"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GuestSelector, GuestSelectorValue } from "@/components/GuestSelector";
import { KoochCompactDateRangePicker } from "@/components/KoochCompactDateRangePicker";
import { KoochSvgIcon } from "@/components/KoochSvgIcon";

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

function normalizeValues(
  values?: Partial<AccommodationSearchValues>,
): AccommodationSearchValues {
  const children = Math.max(0, values?.children ?? 0);
  const childAges = (values?.childAges ?? []).slice(0, children);

  while (childAges.length < children) {
    childAges.push(5);
  }

  return {
    q: values?.q ?? "",
    city: values?.city ?? "",
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

  if (values.q.trim()) {
    query.set("q", values.q.trim());
  }

  if (values.city.trim()) {
    query.set("city", values.city.trim());
  }

  if (values.checkIn) {
    query.set("checkIn", values.checkIn);
  }

  if (values.checkOut) {
    query.set("checkOut", values.checkOut);
  }

  query.set("rooms", Math.max(1, values.rooms).toString());
  query.set("adults", Math.max(1, values.adults).toString());
  query.set("children", Math.max(0, values.children).toString());

  if (values.childAges.length) {
    query.set("childAges", values.childAges.join(","));
  }

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

  const [values, setValues] = useState(() => normalizeValues(initialValues));

  const [internalSuggestions, setInternalSuggestions] = useState<
    AccommodationSuggestion[]
  >([]);

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
    if (
      !enableSuggestions ||
      suggestions.length > 0 ||
      values.q.trim().length < 1
    ) {
      setInternalSuggestions([]);
      return;
    }

    const controller = new AbortController();

    const query = new URLSearchParams({
      q: values.q.trim(),
    });

    if (values.city.trim()) {
      query.set("city", values.city.trim());
    }

    fetch(`/api/backend/properties/suggestions?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((items: AccommodationSuggestion[]) => setInternalSuggestions(items))
      .catch(() => {
        if (!controller.signal.aborted) {
          setInternalSuggestions([]);
        }
      });

    return () => controller.abort();
  }, [enableSuggestions, suggestions.length, values.city, values.q]);

  const fieldClass = `${
    variant === "hero" ? "h-16" : "h-[60px]"
  } w-full rounded-lg border border-[var(--theme-border)] px-4 text-sm font-bold text-[var(--theme-foreground)] outline-none transition placeholder:text-[var(--theme-muted-foreground)] focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]`;

  const labelClass =
    "grid gap-2 text-sm font-bold text-[var(--theme-foreground)] ";

  const shellClass =
    variant === "hero"
      ? "relative z-10 mx-auto  w-full max-w-[860px] rounded-xl border border-slate-200 bg-[#f8f7f9] p-4 pb-5 shadow-2xl sm:p-6 sm:pb-14"
      : variant === "sidebar"
        ? "rounded-xl  border border-slate-200 bg-[#f8f7f9] p-4 shadow-sm"
        : "rounded-xl border border-slate-200 bg-[#f8f7f9] p-4 shadow-sm";
  function update(next: Partial<AccommodationSearchValues>) {
    setValues((current) =>
      normalizeValues({
        ...current,
        ...next,
      }),
    );
  }

  const visibleSuggestions =
    suggestions.length > 0 ? suggestions : internalSuggestions;

  function submit(event: FormEvent) {
    event.preventDefault();

    const normalized = normalizeValues(values);

    onSearch?.(normalized);

    if (redirectToResults) {
      router.push(`${resultsPath}?${buildSearchParams(normalized).toString()}`);
    }
  }

  const destinationField = (
    <label className={`${labelClass} relative`}>
      <span className="sr-only">مقصد</span>

      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-[var(--theme-muted-foreground)]"
        >
          <svg
            fill="none"
            height="22"
            viewBox="0 0 24 24"
            width="22"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.7"
            />
          </svg>
        </span>

        <input
          aria-label="مقصد"
          className={`${fieldClass} ps-12`}
          onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
          onChange={(event) => {
            update({
              q: event.target.value,
            });

            setShowSuggestions(true);
            onQueryChange?.(event.target.value);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder="نام اقامتگاه یا مقصد"
          value={values.q}
        />
      </div>

      {enableSuggestions &&
        showSuggestions &&
        visibleSuggestions.length > 0 && (
          <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[#fff] text-right shadow-xl">
            {visibleSuggestions.map((suggestion) => (
              <button
                className="block w-full px-4 py-3 text-right text-sm font-bold text-[var(--theme-foreground)] transition hover:bg-[var(--theme-accent)]"
                key={suggestion.slug ?? suggestion.id ?? suggestion.name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  update({
                    q: suggestion.name,
                    city: suggestion.city ?? values.city,
                  });

                  setShowSuggestions(false);
                }}
                type="button"
              >
                {suggestion.name}

                {suggestion.city && (
                  <span className="me-2 text-xs font-semibold text-[var(--theme-muted-foreground)]">
                    {suggestion.city}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
    </label>
  );

  const datePicker = (
    <KoochCompactDateRangePicker
      calendarType="jalali"
      disablePastDates
      fieldSize="standard"
      onChange={(nextValue) =>
        update({
          checkIn: nextValue.startDate,
          checkOut: nextValue.endDate,
        })
      }
      value={{
        startDate: values.checkIn,
        endDate: values.checkOut,
      }}
    />
  );

  const guestSelector = (
    <GuestSelector
      label=""
      controlClassName={fieldClass}
      icon={<KoochSvgIcon src="/svgs/users-3.svg" size="lg" />}
      onChange={(nextGuests: GuestSelectorValue) => update(nextGuests)}
      value={{
        rooms: values.rooms,
        adults: values.adults,
        children: values.children,
        childAges: values.childAges,
      }}
    />
  );

  const searchButton = (
    <button
      className={
        variant === "hero"
          ? "h-16 w-full rounded-full bg-[var(--theme-primary)] px-8 text-base font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-[var(--theme-primary-hover)] sm:absolute sm:-bottom-8 sm:left-1/2 sm:w-[58%] sm:-translate-x-1/2"
          : "h-[60px] w-full rounded-lg bg-[var(--theme-primary)] px-6 text-sm font-bold text-white transition hover:bg-[var(--theme-primary-hover)]"
      }
      type="submit"
    >
      {searchButtonText}
    </button>
  );

  return (
    <form className={`${shellClass} ${className}`} dir="rtl" onSubmit={submit}>
      {(showTitle || title || subtitle) && (
        <div className="mb-5 text-right">
          {title && (
            <h2 className="text-xl font-bold text-[var(--theme-foreground)] sm:text-2xl">
              {title}
            </h2>
          )}

          {subtitle && (
            <p className="mt-2 text-sm font-medium text-[var(--theme-muted-foreground)]">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {variant === "hero" ? (
        <div className="grid gap-3">
          {/* Row 1: destination */}
          {destinationField}

          {/* Row 2:
              Mobile: dates then guests
              Desktop: dates + guests side by side */}
          <div className="grid gap-3 sm:grid-cols-[1.15fr_0.85fr]">
            {datePicker}
            {guestSelector}
          </div>

          {/* Search action */}
          <div className="pt-1 sm:pt-3">{searchButton}</div>
        </div>
      ) : (
        <div
          className={
            variant === "compact"
              ? "grid gap-4 lg:grid-cols-[1.15fr_1.65fr_1.05fr_auto] lg:items-end"
              : "grid gap-4"
          }
        >
          {destinationField}
          {datePicker}
          {guestSelector}
          {searchButton}
        </div>
      )}
    </form>
  );
}
