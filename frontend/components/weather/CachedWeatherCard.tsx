"use client";

import { useWeather } from "@/hooks/useWeather";
import { WeatherCard, type WeatherCardLayout } from "./WeatherCard";

export function CachedWeatherCard({ className, layout }: { className?: string; layout?: WeatherCardLayout }) {
  const { state, retry } = useWeather();
  return <WeatherCard className={className} layout={layout} onRetry={retry} state={state} />;
}
