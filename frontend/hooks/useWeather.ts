"use client";

import { useCallback, useEffect, useState } from "react";
import { createWeatherLoader, type WeatherResponse } from "@/lib/weather";
import { useWeatherToday } from "./useWeatherToday";

export type WeatherState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; data: WeatherResponse };

const sharedWeather = createWeatherLoader();

export function useWeather() {
  const today = useWeatherToday();
  const [state, setState] = useState<WeatherState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!today) return;
    let active = true;
    setState({ status: "loading" });
    void sharedWeather.load().then(
      (data) => { if (active) setState({ status: "loaded", data }); },
      () => { if (active) setState({ status: "error" }); },
    );
    return () => { active = false; };
  }, [attempt, today]);
  return { state, retry };
}
