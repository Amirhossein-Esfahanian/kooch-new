import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketplaceWeatherCard } from "@/components/weather/MarketplaceWeatherCard";
import { ApiRequestError } from "@/lib/owner-api";
import { getLiveTestWeather, liveWeatherError } from "@/lib/weather-live-test";
import { weatherFixture } from "./fixtures/weather";

const auth = vi.hoisted(() => ({ authenticated: true, platformRole: "SuperAdmin", user: { userId: 1 } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => auth }));
vi.mock("@/hooks/useWeather", () => ({ useWeather: () => ({
  state: { status: "loaded", data: weatherFixture() }, retry: vi.fn(),
}) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-07T08:00:00Z"));
  vi.stubEnv("NODE_ENV", "development");
  auth.authenticated = true; auth.platformRole = "SuperAdmin"; auth.user = { userId: 1 };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("makes no diagnostic request before a click; displays direct results inside the same panel without caching them", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => weatherFixture() });
  vi.stubGlobal("fetch", fetcher);
  const view = render(<MarketplaceWeatherCard />);
  const button = await screen.findByRole("button", { name: "دریافت مستقیم آب‌وهوا" });
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(button);
  await screen.findByText("داده آزمایشی مستقیم");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("/api/backend/weather/test-live", expect.objectContaining({ cache: "no-store" }));
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
  expect(screen.getByRole("region").getAttribute("dir")).toBe("rtl");
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  view.unmount();
  render(<MarketplaceWeatherCard />);
  expect(screen.queryByText("داده آزمایشی مستقیم")).toBeNull();
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("disables duplicate clicks and retains the normal cached forecast after a sanitized failure", async () => {
  let finish!: (response: unknown) => void;
  const fetcher = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  render(<MarketplaceWeatherCard />);
  const button = await screen.findByRole("button", { name: "دریافت مستقیم آب‌وهوا" });
  fireEvent.click(button); fireEvent.click(button);
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toContain("در حال دریافت مستقیم");
  await act(async () => finish({ ok: false, status: 502, json: async () => ({ category: "Authentication", httpStatusCode: 401, message: "private provider URL" }) }));
  expect((await screen.findByRole("alert")).textContent).toContain("Authentication");
  expect(screen.getByRole("alert").textContent).toContain("401");
  expect(screen.getByRole("alert").textContent).not.toContain("private provider URL");
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
  expect(screen.queryByText("داده آزمایشی مستقیم")).toBeNull();
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
});

it.each(["production", "test"])("hides the diagnostic in %s", (mode) => {
  vi.stubEnv("NODE_ENV", mode);
  render(<MarketplaceWeatherCard />);
  expect(screen.queryByRole("button", { name: "دریافت مستقیم آب‌وهوا" })).toBeNull();
});

it.each(["Client", "AdminAssistant"])("hides the diagnostic for %s", (role) => {
  auth.platformRole = role;
  render(<MarketplaceWeatherCard />);
  expect(screen.queryByRole("button", { name: "دریافت مستقیم آب‌وهوا" })).toBeNull();
});

it("hides the diagnostic and forgets direct results on logout", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => weatherFixture() }));
  const view = render(<MarketplaceWeatherCard />);
  fireEvent.click(await screen.findByRole("button", { name: "دریافت مستقیم آب‌وهوا" }));
  await screen.findByText("داده آزمایشی مستقیم");
  auth.authenticated = false;
  view.rerender(<MarketplaceWeatherCard />);
  expect(screen.queryByText("داده آزمایشی مستقیم")).toBeNull();
  expect(screen.queryByRole("button", { name: "دریافت مستقیم آب‌وهوا" })).toBeNull();
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
});

it("rejects malformed direct forecasts and never displays arbitrary error text", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...weatherFixture(), days: [{ date: "bad" }] }) }));
  await expect(getLiveTestWeather(new AbortController().signal)).rejects.toThrow();
  expect(liveWeatherError(new Error("secret"))).not.toContain("secret");
  expect(liveWeatherError(new ApiRequestError("secret", 403, { category: "secret", httpStatusCode: "secret" }))).not.toContain("secret");
});
