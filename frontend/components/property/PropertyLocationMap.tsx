"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { mapProvider } from "@/lib/maps/map-provider";
import {
  isLatitude,
  isLongitude,
  toMapPosition,
} from "@/lib/maps/property-coordinates";
import type { PropertyCoordinates } from "@/lib/maps/property-coordinates";

type PropertyLocationMapProps = {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  propertyName?: string;
};

type MapStatus = "loading" | "ready" | "warning" | "unavailable";

export function getValidPublicLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): PropertyCoordinates | null {
  const isValid =
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    isLatitude(latitude) &&
    isLongitude(longitude);

  return isValid ? { latitude, longitude } : null;
}

function markerLabel(propertyName?: string) {
  return propertyName
    ? `موقعیت اقامتگاه ${propertyName}`
    : "موقعیت اقامتگاه";
}

export function PropertyLocationMap({
  latitude,
  longitude,
  propertyName,
}: PropertyLocationMapProps) {
  const headingId = useId();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const currentCoordinatesRef = useRef<PropertyCoordinates | null>(null);
  const currentPropertyNameRef = useRef(propertyName);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const coordinates = getValidPublicLocation(latitude, longitude);
  const hasCoordinates = coordinates !== null;

  currentCoordinatesRef.current = coordinates;
  currentPropertyNameRef.current = propertyName;

  useEffect(() => {
    if (!hasCoordinates || !mapContainerRef.current || mapRef.current) {
      return;
    }

    let disposed = false;
    let map: MapLibreMap | null = null;
    let marker: MapLibreMarker | null = null;
    let handleLoad: (() => void) | null = null;
    let handleError: (() => void) | null = null;
    setMapStatus("loading");

    async function initializeMap() {
      try {
        const { Map, Marker } = await import("maplibre-gl");
        const coordinates = currentCoordinatesRef.current;

        if (disposed || !mapContainerRef.current || !coordinates) {
          return;
        }

        map = new Map({
          center: toMapPosition(coordinates),
          container: mapContainerRef.current,
          style: mapProvider.style,
          zoom: 14,
        });
        mapRef.current = map;

        marker = new Marker({ draggable: false })
          .setLngLat(toMapPosition(coordinates))
          .addTo(map);
        marker
          .getElement()
          .setAttribute("aria-label", markerLabel(currentPropertyNameRef.current));
        marker.getElement().setAttribute("role", "img");
        markerRef.current = marker;

        handleLoad = () => setMapStatus("ready");
        handleError = () =>
          setMapStatus((currentStatus) =>
            currentStatus === "loading" ? "unavailable" : "warning",
          );
        map.on("load", handleLoad);
        map.on("error", handleError);
      } catch (error) {
        if (!disposed) {
          setMapStatus("unavailable");
          if (process.env.NODE_ENV !== "production") {
            console.error("Public property location map could not initialize.", error);
          }
        }
      }
    }

    void initializeMap();

    return () => {
      disposed = true;
      marker?.remove();
      markerRef.current = null;

      if (map) {
        if (handleLoad) map.off("load", handleLoad);
        if (handleError) map.off("error", handleError);
        map.remove();
      }

      mapRef.current = null;
    };
  }, [hasCoordinates]);

  useEffect(() => {
    if (!hasCoordinates || !mapRef.current || !markerRef.current) {
      return;
    }

    const nextCoordinates = currentCoordinatesRef.current;
    if (!nextCoordinates) {
      return;
    }

    const position = toMapPosition(nextCoordinates);
    markerRef.current.setLngLat(position);
    mapRef.current.jumpTo({ center: position });
  }, [hasCoordinates, latitude, longitude]);

  useEffect(() => {
    markerRef.current
      ?.getElement()
      .setAttribute("aria-label", markerLabel(propertyName));
  }, [propertyName]);

  if (!hasCoordinates) {
    return null;
  }

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2 className="text-2xl font-bold" id={headingId}>
        موقعیت اقامتگاه
      </h2>
      <div className="relative mt-4 h-64 w-full overflow-hidden rounded-2xl bg-slate-200 sm:h-80 lg:h-96">
        <div
          aria-label={markerLabel(propertyName)}
          className="h-full w-full"
          dir="ltr"
          ref={mapContainerRef}
          role="region"
        />
        {mapStatus === "loading" && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-0 grid place-items-center bg-white/80 px-4 text-center text-sm font-semibold text-slate-600"
            role="status"
          >
            در حال بارگذاری نقشه…
          </div>
        )}
        {mapStatus === "unavailable" && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100 px-4 text-center text-sm font-semibold text-slate-600"
            role="status"
          >
            نقشه در حال حاضر در دسترس نیست.
          </div>
        )}
        {mapStatus === "warning" && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-white/95 px-3 py-2 text-center text-xs font-semibold text-slate-700 shadow-sm"
            role="status"
          >
            بارگذاری بخشی از نقشه با مشکل روبه‌رو شد.
          </div>
        )}
      </div>
    </section>
  );
}
