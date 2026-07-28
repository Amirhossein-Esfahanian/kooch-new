"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dayjs } from "dayjs";
import {
  getHolidayCalendarDays,
  getVisibleMonthGregorianRange,
  holidayCalendarRangeKey,
  type HolidayCalendarDay,
  type HolidayCalendarDaysResponse,
  type HolidayCalendarRange,
  type HolidayCalendarType,
} from "@/lib/holiday-calendar";

type HolidayCalendarFetcher = typeof getHolidayCalendarDays;

type InFlightRequest = {
  controller: AbortController;
  promise: Promise<HolidayCalendarDaysResponse>;
};

export function createHolidayCalendarRangeLoader(
  fetcher: HolidayCalendarFetcher = getHolidayCalendarDays,
) {
  const completed = new Map<string, HolidayCalendarDaysResponse>();
  const inFlight = new Map<string, InFlightRequest>();

  return {
    load(range: HolidayCalendarRange) {
      const key = holidayCalendarRangeKey(range);
      const cached = completed.get(key);
      if (cached) return Promise.resolve(cached);

      const pending = inFlight.get(key);
      if (pending) return pending.promise;

      const controller = new AbortController();
      const promise = fetcher(range.from, range.to, controller.signal)
        .then((response) => {
          completed.set(key, response);
          return response;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, { controller, promise });
      return promise;
    },
    cancelExcept(activeKey: string | null) {
      for (const [key, request] of inFlight) {
        if (key === activeKey) continue;
        inFlight.delete(key);
        request.controller.abort();
      }
    },
    dispose() {
      for (const request of inFlight.values()) request.controller.abort();
      inFlight.clear();
    },
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function useShowsTwoCalendarMonths(enabled: boolean) {
  const [showsTwoMonths, setShowsTwoMonths] = useState(
    () =>
      enabled &&
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 640px)").matches,
  );

  useEffect(() => {
    if (!enabled) {
      setShowsTwoMonths(false);
      return;
    }

    const media = window.matchMedia("(min-width: 640px)");
    const update = () => setShowsTwoMonths(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [enabled]);

  return showsTwoMonths;
}

export function useHolidayCalendarMonths({
  visibleMonth,
  calendarType,
  includeResponsiveSecondMonth = false,
  enabled = true,
}: {
  visibleMonth: Dayjs;
  calendarType: HolidayCalendarType;
  includeResponsiveSecondMonth?: boolean;
  enabled?: boolean;
}) {
  const showsTwoMonths = useShowsTwoCalendarMonths(includeResponsiveSecondMonth);
  const monthCount: 1 | 2 = showsTwoMonths ? 2 : 1;
  const range = useMemo(
    () => getVisibleMonthGregorianRange(visibleMonth, calendarType, monthCount),
    [calendarType, monthCount, visibleMonth],
  );
  const loaderRef = useRef<ReturnType<typeof createHolidayCalendarRangeLoader> | null>(null);
  if (!loaderRef.current) loaderRef.current = createHolidayCalendarRangeLoader();

  const [response, setResponse] = useState<HolidayCalendarDaysResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const loader = loaderRef.current!;
    if (!enabled) {
      loader.cancelExcept(null);
      setResponse(null);
      setLoading(false);
      setError(null);
      return;
    }

    const key = holidayCalendarRangeKey(range);
    let active = true;
    loader.cancelExcept(key);
    setResponse(null);
    setLoading(true);
    setError(null);
    void loader.load(range).then(
      (nextResponse) => {
        if (!active) return;
        setResponse(nextResponse);
        setLoading(false);
      },
      (nextError: unknown) => {
        if (!active || isAbortError(nextError)) return;
        setResponse(null);
        setError(nextError instanceof Error ? nextError : new Error("Holiday calendar could not be loaded."));
        setLoading(false);
      },
    );

    return () => {
      active = false;
    };
  }, [enabled, range]);

  useEffect(() => () => loaderRef.current?.dispose(), []);

  const holidayByDate = useMemo<ReadonlyMap<string, HolidayCalendarDay>>(
    () => new Map(response?.days.map((day) => [day.date, day]) ?? []),
    [response],
  );

  return {
    holidayByDate,
    loading,
    error,
    range,
    coverage: response
      ? {
          isRangeFullyCovered: response.isRangeFullyCovered,
          coveredSolarYearFrom: response.coveredSolarYearFrom,
          coveredSolarYearTo: response.coveredSolarYearTo,
          lastSuccessfulSyncAtUtc: response.lastSuccessfulSyncAtUtc,
        }
      : null,
  };
}
