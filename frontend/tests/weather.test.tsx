import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeatherCard } from "@/components/weather/WeatherCard";
import { WeatherIcon } from "@/components/weather/WeatherIcon";
import { createWeatherLoader, getWeather, type WeatherResponse } from "@/lib/weather";
import { weatherFixture } from "./fixtures/weather";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("weather API and shared cache", () => {
  it("uses the public backend proxy and validates the actual contract", async () => {
    const data = weatherFixture();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
    vi.stubGlobal("fetch", fetcher);
    expect(await getWeather()).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith("/api/backend/weather");
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
    let now = 0;
    const fetcher = vi.fn(() => new Promise<WeatherResponse>((resolve) => { finish = resolve; }));
    const loader = createWeatherLoader(fetcher, () => now);
    const first = loader.load();
    expect(loader.load()).toBe(first);
    finish(weatherFixture());
    await first;
    now = 30 * 60 * 1000 - 1;
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
});

describe("reusable weather presentation", () => {
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

  it.each(["clear-night", "cloudy", "rain", "snow", "wind", "fog", "thunder-rain", "unknown"])("renders a decorative vector for %s", (code) => {
    const { container } = render(<WeatherIcon code={code} />);
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
