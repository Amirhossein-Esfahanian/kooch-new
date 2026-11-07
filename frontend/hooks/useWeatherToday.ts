"use client";

import { useEffect, useState } from "react";
import { weatherBusinessDate, weatherMidnightDelay } from "@/lib/weather";

export function useWeatherToday() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(timer);
      setToday(weatherBusinessDate());
      timer = setTimeout(update, weatherMidnightDelay());
    }
    update();
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  return today;
}
