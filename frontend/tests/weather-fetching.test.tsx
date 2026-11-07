import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CachedWeatherCard } from "@/components/weather/CachedWeatherCard";
import { weatherFixture } from "./fixtures/weather";
import { weatherBusinessDate } from "@/lib/weather";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-07T08:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("deduplicates card requests, supports retry, and reuses the shared snapshot on remount", async () => {
  let finish!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<><CachedWeatherCard /><CachedWeatherCard /></>);
  await screen.findAllByRole("alert");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getAllByRole("button", { name: "تلاش دوباره" })[0]);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => { finish({ ok: true, json: async () => weatherFixture() }); });
  await screen.findByRole("list", { name: "پیش‌بینی روزانه" });
  view.unmount();
  render(<CachedWeatherCard />);
  await screen.findByRole("list", { name: "پیش‌بینی روزانه" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("revalidates cached HTTP weather when an open panel crosses Tehran midnight", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T20:29:59Z"));
  const fetcher = vi.fn().mockImplementation(async () => {
    const data = weatherFixture();
    if (weatherBusinessDate() === "2026-11-08") {
      data.days = data.days.map((day) => ({ ...day, date: new Date(Date.parse(`${day.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10) }));
    }
    return { ok: true, json: async () => data };
  });
  vi.stubGlobal("fetch", fetcher);
  const { container } = render(<CachedWeatherCard />);
  await act(async () => { await Promise.resolve(); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(container.querySelector("li time")?.getAttribute("datetime")).toBe("2026-11-07");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.querySelector("li time")?.getAttribute("datetime")).toBe("2026-11-08");
});
