import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CachedWeatherCard } from "@/components/weather/CachedWeatherCard";
import { weatherFixture } from "./fixtures/weather";

afterEach(() => { vi.unstubAllGlobals(); });

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
