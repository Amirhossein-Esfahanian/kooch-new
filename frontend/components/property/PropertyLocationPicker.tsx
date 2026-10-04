"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";

import { KoochButton } from "@/components/KoochButton";
import { mapProvider } from "@/lib/maps/map-provider";
import {
  fromMapPosition,
  KASHAN_MAP_CENTER,
  normalizeCoordinate,
  toMapPosition,
} from "@/lib/maps/property-coordinates";
import type { PropertyCoordinates } from "@/lib/maps/property-coordinates";

export type { PropertyCoordinates } from "@/lib/maps/property-coordinates";

type PropertyLocationPickerProps = {
  value: PropertyCoordinates | null;
  onChange: (value: PropertyCoordinates | null) => void;
  disabled?: boolean;
};

type MapStatus = "loading" | "ready" | "warning" | "unavailable";

type PendingUserValue = {
  active: boolean;
  value: PropertyCoordinates | null;
};

function coordinatesEqual(
  first: PropertyCoordinates | null,
  second: PropertyCoordinates | null,
) {
  return (
    first === second ||
    (first !== null &&
      second !== null &&
      first.latitude === second.latitude &&
      first.longitude === second.longitude)
  );
}

export function PropertyLocationPicker({
  value,
  onChange,
  disabled = false,
}: PropertyLocationPickerProps) {
  const headingId = useId();
  const descriptionId = useId();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const markerConstructorRef = useRef<
    typeof import("maplibre-gl").Marker | null
  >(null);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const currentValueRef = useRef(value);
  const pendingUserValueRef = useRef<PendingUserValue>({
    active: false,
    value: null,
  });
  const suppressMarkerGestureClickRef = useRef(false);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");

  onChangeRef.current = onChange;
  disabledRef.current = disabled;
  currentValueRef.current = value;

  const emitUserValue = (nextValue: PropertyCoordinates | null) => {
    pendingUserValueRef.current = { active: true, value: nextValue };
    onChangeRef.current(nextValue);
  };

  const syncMarker = (coordinates: PropertyCoordinates | null) => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (!coordinates) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const position = toMapPosition(coordinates);

    if (!markerRef.current) {
      const Marker = markerConstructorRef.current;

      if (!Marker) {
        return;
      }

      const marker = new Marker({ draggable: !disabledRef.current })
        .setLngLat(position)
        .addTo(map);

      marker.on("dragstart", () => {
        suppressMarkerGestureClickRef.current = true;
      });

      marker.on("dragend", () => {
        if (disabledRef.current) {
          return;
        }

        const nextCoordinates = fromMapPosition(marker.getLngLat());
        emitUserValue(nextCoordinates);
      });

      markerRef.current = marker;
      return;
    }

    markerRef.current.setLngLat(position);
  };

  const selectCoordinates = (coordinates: PropertyCoordinates) => {
    const normalizedCoordinates = {
      latitude: normalizeCoordinate(coordinates.latitude),
      longitude: normalizeCoordinate(coordinates.longitude),
    };

    syncMarker(normalizedCoordinates);
    emitUserValue(normalizedCoordinates);
  };

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    let handleLoad: (() => void) | null = null;
    let handleError: (() => void) | null = null;
    let handleClick:
      | ((event: { lngLat: { lat: number; lng: number } }) => void)
      | null = null;
    let handleMouseDown: (() => void) | null = null;

    async function initializeMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      try {
        const { Map, Marker } = await import("maplibre-gl");

        if (disposed || !mapContainerRef.current) {
          return;
        }

        const initialCoordinates = currentValueRef.current;
        markerConstructorRef.current = Marker;
        map = new Map({
          container: mapContainerRef.current,
          style: mapProvider.style,
          center: toMapPosition(initialCoordinates ?? KASHAN_MAP_CENTER),
          zoom: initialCoordinates ? 14 : 11,
        });
        mapRef.current = map;

        handleLoad = () => setMapStatus("ready");
        handleError = () =>
          setMapStatus((currentStatus) =>
            currentStatus === "loading" ? "unavailable" : "warning",
          );
        handleClick = (event) => {
          if (suppressMarkerGestureClickRef.current) {
            suppressMarkerGestureClickRef.current = false;
            return;
          }

          if (!disabledRef.current) {
            selectCoordinates(fromMapPosition(event.lngLat));
          }
        };
        handleMouseDown = () => {
          suppressMarkerGestureClickRef.current = false;
        };

        map.on("load", handleLoad);
        map.on("error", handleError);
        map.on("mousedown", handleMouseDown);
        map.on("click", handleClick);

        if (initialCoordinates) {
          syncMarker(initialCoordinates);
        }
      } catch (error) {
        if (!disposed) {
          setMapStatus("unavailable");
          if (process.env.NODE_ENV !== "production") {
            console.error("Property location map could not initialize.", error);
          }
        }
      }
    }

    void initializeMap();

    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      markerConstructorRef.current = null;

      if (map) {
        if (handleLoad) map.off("load", handleLoad);
        if (handleError) map.off("error", handleError);
        if (handleMouseDown) map.off("mousedown", handleMouseDown);
        if (handleClick) map.off("click", handleClick);
        map.remove();
      }

      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pendingUserValue = pendingUserValueRef.current;
    const isControlledUserEcho =
      pendingUserValue.active &&
      coordinatesEqual(pendingUserValue.value, value);
    pendingUserValueRef.current.active = false;

    syncMarker(value);

    if (value && mapRef.current && !isControlledUserEcho) {
      mapRef.current.jumpTo({ center: toMapPosition(value) });
    }
  }, [value?.latitude, value?.longitude]);

  useEffect(() => {
    markerRef.current?.setDraggable(!disabled);
  }, [disabled]);

  const handleClear = () => {
    syncMarker(null);
    emitUserValue(null);
  };

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={headingId}
      className="grid gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground" id={headingId}>
            موقعیت اقامتگاه روی نقشه
          </h2>
          <p
            className="mt-1 text-sm leading-6 text-muted-foreground"
            id={descriptionId}
          >
            روی نقشه کلیک کنید یا نشانگر را جابه‌جا کنید.
          </p>
        </div>

        <KoochButton
          disabled={disabled || !value}
          onClick={handleClear}
          size="sm"
          type="button"
          variant="outline"
        >
          پاک کردن موقعیت
        </KoochButton>
      </div>

      <div className="relative h-72 w-full overflow-hidden rounded-xl border border-border bg-muted sm:h-80">
        <div
          aria-label="نقشه انتخاب موقعیت اقامتگاه"
          className="h-full w-full"
          dir="ltr"
          ref={mapContainerRef}
        />

        {mapStatus === "loading" && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-0 grid place-items-center bg-background/80 px-4 text-center text-sm font-semibold text-muted-foreground"
            role="status"
          >
            در حال بارگذاری نقشه…
          </div>
        )}

        {(mapStatus === "unavailable" || mapStatus === "warning") && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-3 top-3 rounded-lg border border-border bg-background/95 px-3 py-2 text-center text-xs font-semibold text-foreground"
            role="status"
          >
            {mapStatus === "unavailable"
              ? "نقشه در دسترس نیست؛ انتخاب موقعیت فعلاً امکان‌پذیر نیست."
              : "بارگذاری بخشی از نقشه با مشکل روبه‌رو شد."}
          </div>
        )}
      </div>
    </section>
  );
}
