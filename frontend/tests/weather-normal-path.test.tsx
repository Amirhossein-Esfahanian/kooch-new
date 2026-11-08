import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarketplaceWeatherCard } from "@/components/weather/MarketplaceWeatherCard";
import { weatherFixture } from "./fixtures/weather";

vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({
  authenticated: true, platformRole: "SuperAdmin", user: { userId: 1 },
}) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("automatically renders recovered normal cached weather without clicking the separate diagnostic action", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T08:00:00Z"));
  const data = weatherFixture();
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...data, status: "unavailable", unavailableReason: "no_snapshot", days: [], fetchedAtUtc: null }) })
    .mockResolvedValueOnce({ ok: true, json: async () => data });
  vi.stubGlobal("fetch", fetcher);

  const first = render(<MarketplaceWeatherCard />);
  await screen.findByText("پیش‌بینی آب‌وهوا در حال حاضر در دسترس نیست.");
  expect(fetcher).toHaveBeenCalledTimes(1);
  first.unmount();

  render(<MarketplaceWeatherCard />);
  const row = await screen.findByRole("list", { name: "پیش‌بینی روزانه" });
  expect(within(row).getAllByRole("listitem")).toHaveLength(7);
  expect(row.tabIndex).toBe(0);
  expect(screen.queryByText(/آخرین به‌روزرسانی|احتمال بارش|دما به درجه/)).toBeNull();
  expect(screen.getByRole("link", { name: /Visual Crossing/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "دریافت مستقیم آب‌وهوا" })).toBeTruthy();
  expect(screen.queryByText("داده آزمایشی مستقیم")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [path, options] of fetcher.mock.calls) {
    expect(path).toBe("/api/backend/weather");
    expect(options.cache).toBe("no-store");
  }
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
