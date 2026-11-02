"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GuestSelectorValue } from "@/components/GuestSelector";
import {
  initialAvailabilityContextKey, readBookingContext, writeBookingContext,
  type BookingDates, type BookingUrlContext, type PropertyEntryKind,
} from "@/lib/booking-context";

export function useBookingUrlContext(kind: PropertyEntryKind, slug: string) {
  const query = useSearchParams().toString();
  const [context, setContext] = useState(() => readBookingContext(new URLSearchParams(query)));
  const [autoCheckKey, setAutoCheckKey] = useState(() => initialAvailabilityContextKey(new URLSearchParams(query), slug));
  const current = useRef({ context, query });
  const ownWrites = useRef(new Set<string>());
  const route = `/${kind}/${encodeURIComponent(slug)}`;
  const observedRoute = useRef(route);

  useEffect(() => {
    // Query identity is not navigation; don't reset edits when Next returns a new wrapper.
    const routeChanged = observedRoute.current !== route;
    observedRoute.current = route;
    if (routeChanged) ownWrites.current.clear();
    if (!routeChanged && (ownWrites.current.delete(query) || current.current.query === query)) return;
    const next = readBookingContext(new URLSearchParams(query));
    current.current = { context: next, query };
    setContext(next);
    setAutoCheckKey(initialAvailabilityContextKey(new URLSearchParams(query), slug));
  }, [query, route, slug]);

  function update(next: BookingUrlContext) {
    const params = writeBookingContext(next, new URLSearchParams(current.current.query));
    const nextQuery = params.toString();
    const previousQuery = current.current.query;
    current.current = { context: next, query: nextQuery };
    setContext(next);
    if (nextQuery === previousQuery) return;
    ownWrites.current.add(nextQuery);
    // Next copies its own internal history state and updates useSearchParams for this
    // native replace; forwarding its private state would bypass that integration.
    window.history.replaceState(null, "",
      `${route}?${nextQuery}${window.location.hash}`);
  }

  return {
    dates: context.dates, guests: context.guests,
    setDates: (dates: BookingDates) => update({ ...current.current.context, dates }),
    setGuests: (guests: GuestSelectorValue) => update({ ...current.current.context, guests }),
    autoCheckInitialContextKey: autoCheckKey,
  };
}
