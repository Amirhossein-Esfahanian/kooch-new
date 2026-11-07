import type { WeatherResponse } from "@/lib/weather";

export function weatherFixture(): WeatherResponse {
  return {
    status: "available", unavailableReason: null, locationKey: "kashan", provider: "VisualCrossing",
    attribution: "Weather data by Visual Crossing", unitGroup: "metric", fetchedAtUtc: "2026-11-07T08:00:00Z",
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-11-${String(7 + index).padStart(2, "0")}`,
      minTemperature: index === 0 ? -4 : 10, maxTemperature: 20 + index,
      precipitationProbability: 0, conditions: "آفتابی", icon: "clear-day",
    })),
  };
}
