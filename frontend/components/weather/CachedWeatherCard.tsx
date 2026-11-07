"use client";

import { useWeather } from "@/hooks/useWeather";
import { WeatherCard } from "./WeatherCard";

export function CachedWeatherCard({ className }: { className?: string }) {
  const { state, retry } = useWeather();
  return <WeatherCard className={className} onRetry={retry} state={state} />;
}
