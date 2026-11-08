import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeatherCard } from "@/components/weather/WeatherCard";
import { WeatherIcon } from "@/components/weather/WeatherIcon";
import type { WeatherState } from "@/hooks/useWeather";
import styles from "@/components/weather/WeatherCard.module.css";
import iconStyles from "@/components/weather/WeatherIcon.module.css";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWeatherLoader, getWeather, weatherBusinessDate, weatherForToday, weatherMidnightDelay, type WeatherResponse } from "@/lib/weather";
import { weatherFixture } from "./fixtures/weather";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-07T08:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("weather API and shared cache", () => {
  it("anchors only to Tehran today and expires the memory cache at the local date boundary", async () => {
    let now = Date.parse("2026-11-07T20:29:59.500Z");
    expect(weatherBusinessDate(now)).toBe("2026-11-07");
    expect(weatherMidnightDelay(now)).toBe(500);
    const fetcher = vi.fn().mockResolvedValue(weatherFixture());
    const loader = createWeatherLoader(fetcher, () => now);
    await loader.load();
    now += 500;
    expect(weatherBusinessDate(now)).toBe("2026-11-08");
    await loader.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not use booking query dates when fetching weather", async () => {
    window.history.replaceState(null, "", "/properties/test?checkIn=2027-04-01&checkOut=2027-04-07");
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => weatherFixture() });
    vi.stubGlobal("fetch", fetcher);
    await getWeather();
    expect(fetcher).toHaveBeenCalledWith("/api/backend/weather", { cache: "no-store" });
    expect(weatherForToday(weatherFixture(), weatherBusinessDate()).days[0].date).toBe("2026-11-07");
    window.history.replaceState(null, "", "/");
  });

  it("uses the public backend proxy and validates the actual contract", async () => {
    const data = weatherFixture();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
    vi.stubGlobal("fetch", fetcher);
    expect(await getWeather()).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith("/api/backend/weather", { cache: "no-store" });
  });

  it.each([
    { status: "setup_required" },
    { days: [{ ...weatherFixture().days[0], date: "2026-02-30" }] },
    { days: [{ ...weatherFixture().days[0], maxTemperature: null }] },
    { days: [{ ...weatherFixture().days[0], precipitationProbability: 101 }] },
    { days: [weatherFixture().days[0], weatherFixture().days[0]] },
    { status: "available", days: [] },
    { fetchedAtUtc: "invalid" },
  ])("rejects malformed forecasts rather than substituting numbers: %j", async (changes) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...weatherFixture(), ...changes }) }));
    await expect(getWeather()).rejects.toThrow("پاسخ آب‌وهوا معتبر نیست.");
  });

  it("accepts setup_required as an unavailable reason with no invented forecast", async () => {
    const data: WeatherResponse = { ...weatherFixture(), status: "unavailable", unavailableReason: "setup_required", fetchedAtUtc: null, days: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    expect(await getWeather()).toEqual(data);
  });

  it("rejects failed HTTP and network requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(getWeather()).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(getWeather()).rejects.toThrow();
  });

  it("deduplicates concurrent requests and reuses cached data for 30 minutes", async () => {
    let finish!: (value: WeatherResponse) => void;
    const startedAt = Date.now();
    let now = startedAt;
    const fetcher = vi.fn(() => new Promise<WeatherResponse>((resolve) => { finish = resolve; }));
    const loader = createWeatherLoader(fetcher, () => now);
    const first = loader.load();
    expect(loader.load()).toBe(first);
    finish(weatherFixture());
    await first;
    now = startedAt + 30 * 60 * 1000 - 1;
    expect(await loader.load()).toEqual(weatherFixture());
    expect(fetcher).toHaveBeenCalledTimes(1);
    now++;
    const expired = loader.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    finish(weatherFixture());
    await expired;
  });

  it("does not retain failures so an explicit retry can recover", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(weatherFixture());
    const loader = createWeatherLoader(fetcher);
    await expect(loader.load()).rejects.toThrow();
    expect(await loader.load()).toEqual(weatherFixture());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["no_snapshot", "setup_required", "forecast_expired"])("does not retain unavailable/%s after the backend recovers", async (reason) => {
    const unavailable: WeatherResponse = { ...weatherFixture(), status: "unavailable", unavailableReason: reason, fetchedAtUtc: null, days: [] };
    const fetcher = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(weatherFixture());
    const loader = createWeatherLoader(fetcher);
    expect((await loader.load()).status).toBe("unavailable");
    expect((await loader.load()).status).toBe("available");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await loader.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retain a formerly available forecast that lacks seven current Tehran days", async () => {
    const expired = weatherFixture();
    const current = weatherFixture();
    current.days = current.days.map((day) => ({ ...day, date: new Date(Date.parse(`${day.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10) }));
    const fetcher = vi.fn().mockResolvedValueOnce(expired).mockResolvedValueOnce(current);
    const loader = createWeatherLoader(fetcher, () => Date.parse("2026-11-08T08:00:00Z"));
    await loader.load();
    expect((await loader.load()).days[0].date).toBe("2026-11-08");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("reusable weather presentation", () => {
  it("marks Tehran today subtly and gives maximum and minimum distinct hierarchy", () => {
    render(<WeatherCard layout="horizontal" state={{ status: "loaded", data: weatherFixture() }} />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles[0].classList.contains(styles.today)).toBe(true);
    expect(tiles[0].querySelector('time[aria-current="date"]')).toBeTruthy();
    expect(tiles[1].querySelector('[aria-current]')).toBeNull();
    expect(tiles[0].querySelector(`.${styles.maximum}`)?.textContent).toContain("بیشینه");
    expect(tiles[0].querySelector(`.${styles.minimum}`)?.textContent).toContain("کمینه");
  });

  it("keeps motion finite, reduced-motion static, and compact styling scoped to horizontal tiles", () => {
    const css = readFileSync(resolve(process.cwd(), "components/weather/WeatherIcon.module.css"), "utf8");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("animation: none");
    expect(css).not.toContain("infinite");
    const cardCss = readFileSync(resolve(process.cwd(), "components/weather/WeatherCard.module.css"), "utf8");
    expect(cardCss).toContain("padding: .625rem .5rem");
    expect(cardCss).toContain(".horizontal .maximum bdi");
    expect(cardCss).toContain("var(--muted-foreground)");
  });

  it.each([
    ["clear-day", "rays"], ["partly-cloudy-day", "drift"], ["partly-cloudy-night", "drift"],
    ["rain", "drops"], ["showers-day", "drops"], ["showers-night", "drops"],
    ["thunder-showers-day", "drops"], ["thunder-showers-night", "drops"],
  ] as const)("maps %s to restrained %s motion only when enabled", (code, part) => {
    const { container, rerender } = render(<WeatherIcon code={code} animated />);
    expect(container.querySelector(`svg.${iconStyles.animated}`)).toBeTruthy();
    expect(container.querySelector(`.${iconStyles[part]}`)).toBeTruthy();
    rerender(<WeatherIcon code={code} />);
    expect(container.querySelector(`svg.${iconStyles.animated}`)).toBeNull();
  });

  it("offers seven accessible horizontal tiles with the same mapped values, dates and attribution", () => {
    render(<WeatherCard layout="horizontal" state={{ status: "loaded", data: weatherFixture() }} />);
    const card = screen.getByRole("region", { name: "پیش‌بینی آب‌وهوای کاشان" });
    expect(card.classList.contains(styles.horizontal)).toBe(true);
    expect(card.getAttribute("dir")).toBe("rtl");
    const row = within(card).getByRole("list", { name: "پیش‌بینی روزانه" });
    expect(row.tabIndex).toBe(0);
    row.focus();
    expect(document.activeElement).toBe(row);
    const tiles = within(row).getAllByRole("listitem");
    expect(tiles).toHaveLength(7);
    for (const [index, tile] of tiles.entries()) {
      expect(tile.querySelector("time")?.getAttribute("datetime")).toBe(weatherFixture().days[index].date);
      expect(tile.querySelector('[aria-hidden="true"]')).toBeTruthy();
      expect(tile.textContent).toContain("آفتابی");
      expect(tile.textContent).toContain("بیشینه");
      expect(tile.textContent).toContain("کمینه");
      expect(tile.textContent).toContain("احتمال بارش ۰٪");
    }
    expect(within(card).getByText(/آخرین به‌روزرسانی/)).toBeTruthy();
    expect(within(card).getByRole("link", { name: /Visual Crossing/ })).toBeTruthy();
  });

  it.each(["loading", "error", "stale", "unavailable", "forecast_expired"])("preserves %s in the horizontal layout", (mode) => {
    const state: WeatherState = mode === "loading" || mode === "error" ? { status: mode } : {
      status: "loaded", data: { ...weatherFixture(), status: mode === "stale" ? "stale" : "unavailable",
        unavailableReason: mode === "forecast_expired" ? "forecast_expired" : null, days: mode === "stale" ? weatherFixture().days : [] },
    };
    render(<WeatherCard layout="horizontal" onRetry={vi.fn()} state={state} />);
    expect(screen.getByRole("region").classList.contains(styles.horizontal)).toBe(true);
    expect(screen.getByRole(mode === "error" ? "alert" : "status")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(mode === "stale" ? 7 : 0);
    expect(screen.getByRole("link", { name: /Visual Crossing/ })).toBeTruthy();
  });

  it("keeps horizontal scrolling inside the row and seven equal desktop columns in scoped CSS", () => {
    const css = readFileSync(resolve(process.cwd(), "components/weather/WeatherCard.module.css"), "utf8");
    expect(css).toMatch(/\.horizontal \.days\s*\{[^}]*grid-auto-flow:\s*column/);
    expect(css).toMatch(/\.horizontal \.days\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
    expect(css).toContain("overscroll-behavior-inline: contain");
    expect(css).toContain(".horizontal .days:focus-visible");
  });

  it("updates an already open panel at Tehran midnight without relabeling yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T20:29:59Z"));
    const data = weatherFixture();
    data.days.push({ ...data.days[0], date: "2026-11-14" });
    const { container } = render(<WeatherCard state={{ status: "loaded", data }} />);
    expect(container.querySelector("li time")?.getAttribute("datetime")).toBe("2026-11-07");
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector("li time")?.getAttribute("datetime")).toBe("2026-11-08");
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByRole("status").textContent).toContain("به‌روز نیست");
  });

  it("does not show an incomplete or gapped current-day window as today's forecast", () => {
    const data = weatherFixture();
    expect(weatherForToday(data, "2026-11-08")).toMatchObject({ status: "unavailable", days: [] });
    data.days[3] = { ...data.days[3], date: "2026-11-15" };
    expect(weatherForToday(data, "2026-11-07")).toMatchObject({ status: "unavailable", days: [] });
  });

  it("shows Persian dates, real temperature ranges, zero precipitation and attribution", () => {
    render(<WeatherCard state={{ status: "loaded", data: weatherFixture() }} />);
    const card = screen.getByRole("region", { name: "پیش‌بینی آب‌وهوای کاشان" });
    expect(card.getAttribute("dir")).toBe("rtl");
    const days = within(card).getAllByRole("listitem");
    expect(days).toHaveLength(7);
    expect(days[0].textContent).toContain("شنبه");
    expect(days[0].textContent).toContain("۱۶ آبان");
    expect(days[0].textContent).toContain("بیشینه ۲۰°");
    expect(days[0].textContent).toContain("کمینه ‎−۴°");
    expect(days[0].textContent).toContain("احتمال بارش ۰٪");
    expect(screen.getByText(/آخرین به‌روزرسانی/).textContent).toContain("۱۱:۳۰");
    expect(screen.getByRole("link", { name: /Visual Crossing/ }).getAttribute("href")).toContain("visualcrossing.com");
    expect(days[0].querySelector("time")?.dateTime).toBe("2026-11-07");
  });

  it("caps at seven actual days and allows precipitation to be omitted", () => {
    const data = weatherFixture();
    data.days.push({ ...data.days[0], date: "2026-11-14" });
    render(<WeatherCard showPrecipitation={false} state={{ status: "loaded", data }} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.queryByText(/احتمال بارش/)).toBeNull();
  });

  it("labels stale data while retaining the last real forecast and timestamp", () => {
    render(<WeatherCard state={{ status: "loaded", data: { ...weatherFixture(), status: "stale" } }} />);
    expect(screen.getByRole("status").textContent).toContain("به‌روز نیست");
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText(/آخرین به‌روزرسانی/)).toBeTruthy();
  });

  it.each(["setup_required", "no_snapshot", "forecast_expired", "storage_unavailable"])("handles %s without forecast values", (reason) => {
    render(<WeatherCard state={{ status: "loaded", data: { ...weatherFixture(), status: "unavailable", unavailableReason: reason, days: [], fetchedAtUtc: null } }} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(reason === "setup_required" ? "راه‌اندازی" : "در دسترس نیست");
    expect(screen.queryByText(/°|احتمال بارش/)).toBeNull();
  });

  it("announces loading and offers an accessible retry after errors", () => {
    const retry = vi.fn();
    const { rerender } = render(<WeatherCard state={{ status: "loading" }} />);
    expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("در حال دریافت");
    rerender(<WeatherCard state={{ status: "error" }} onRetry={retry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("uses appropriate units and does not assume other configured locations are Kashan", () => {
    render(<WeatherCard state={{ status: "loaded", data: { ...weatherFixture(), locationKey: "other", unitGroup: "us" } }} />);
    expect(screen.queryByText(/کاشان/)).toBeNull();
    expect(screen.getByText("دما به درجهٔ فارنهایت")).toBeTruthy();
  });

  it.each(["clear-day", "clear-night", "cloudy", "partly-cloudy-day", "partly-cloudy-night", "rain", "showers-day", "showers-night", "snow", "snow-showers-day", "snow-showers-night", "wind", "fog", "thunder-rain", "thunder-showers-day", "thunder-showers-night", "unknown"])("renders a decorative vector for %s", (code) => {
    const { container } = render(<WeatherIcon code={code} />);
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
