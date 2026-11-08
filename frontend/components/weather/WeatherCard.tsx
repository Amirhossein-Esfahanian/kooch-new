"use client";

import { useId, type ReactNode } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import type { WeatherState } from "@/hooks/useWeather";
import { useWeatherToday } from "@/hooks/useWeatherToday";
import { weatherDayLabel, weatherForToday, weatherNumber } from "@/lib/weather";
import { WeatherIcon } from "./WeatherIcon";
import styles from "./WeatherCard.module.css";

export type WeatherCardLayout = "vertical" | "horizontal";

export function WeatherCard({ state, onRetry, className = "", notice, layout = "vertical" }: {
  state: WeatherState; onRetry?: () => void; className?: string; notice?: ReactNode; layout?: WeatherCardLayout;
}) {
  const headingId = useId();
  const today = useWeatherToday();
  const data = state.status === "loaded" && today ? weatherForToday(state.data, today) : null;
  const days = data && data.status !== "unavailable" ? data.days.slice(0, 7) : [];
  const unit = data?.unitGroup === "us" ? "فارنهایت" : "سانتی‌گراد";
  return <KoochCard aria-busy={state.status === "loading"} aria-labelledby={headingId} className={`${styles.card} ${layout === "horizontal" ? styles.horizontal : ""} ${className}`} dir="rtl">
    <h2 className={styles.heading} id={headingId}>پیش‌بینی آب‌وهوا{data?.locationKey === "kashan" ? "ی کاشان" : ""}</h2>
    <div className={styles.message}>
      {notice}
      {state.status === "loading" && <p role="status">در حال دریافت آب‌وهوا…</p>}
      {state.status === "error" && <p role="alert">دریافت آب‌وهوا ممکن نشد. دوباره تلاش کنید.</p>}
      {data?.status === "stale" && <p role="status">این پیش‌بینی به‌روز نیست؛ آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود.</p>}
      {data?.status === "unavailable" && <p role="status">{data.unavailableReason === "setup_required"
        ? "اطلاعات آب‌وهوا هنوز آماده نیست؛ راه‌اندازی این سرویس باید تکمیل شود."
        : "پیش‌بینی آب‌وهوا در حال حاضر در دسترس نیست."}</p>}
    </div>
    {state.status === "error" && onRetry && <KoochButton className={styles.retry} onClick={onRetry} size="sm" variant="outline">تلاش دوباره</KoochButton>}
    {days.length > 0 && <>
      <ul aria-label="پیش‌بینی روزانه" className={styles.days} tabIndex={layout === "horizontal" ? 0 : undefined}>{days.map((day) => {
        const label = weatherDayLabel(day.date);
        return <li key={day.date} className={day.date === today ? styles.today : undefined}>
          <time dateTime={day.date} aria-current={day.date === today ? "date" : undefined}><strong>{label.weekday}</strong><span>{label.date}</span></time>
          <span className={styles.icon}><WeatherIcon code={day.icon} animated={layout === "horizontal"} /></span>
          <div className={styles.forecast}>
            <p className={styles.conditions}>{day.conditions}</p>
            <p className={styles.temperatures}>
              <span className={styles.maximum}>بیشینه <bdi>{weatherNumber.format(day.maxTemperature)}°</bdi></span>
              <span className={styles.minimum}>کمینه <bdi>{weatherNumber.format(day.minTemperature)}°</bdi></span>
              <span className="sr-only">{unit}</span>
            </p>
          </div>
        </li>;
      })}</ul>
    </>}
    <div className={styles.footer}>
      <p className={styles.attribution}>منبع: <a href="https://www.visualcrossing.com/weather-data" rel="noopener noreferrer" target="_blank" lang="en" dir="ltr">Visual Crossing<span className="sr-only"> (باز شدن در پنجرهٔ جدید)</span></a></p>
    </div>
  </KoochCard>;
}
