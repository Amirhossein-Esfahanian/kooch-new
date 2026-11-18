import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(), apiRequest: api,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2035-02-01T12:00:00Z"));
  api.mockReset();
  api.mockImplementation(async (path: string) => {
    if (path === "/admin/properties") return [{ id: 10, name: "اقامتگاه آزمون" }];
    throw new Error(`Unexpected API request: ${path}`);
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, media: "", onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    return new Response(JSON.stringify({ from: url.searchParams.get("from"), to: url.searchParams.get("to"),
      isRangeFullyCovered: true, coveredSolarYearFrom: null, coveredSolarYearTo: null,
      lastSuccessfulSyncAtUtc: null, days: [] }), { status: 200 });
  }));
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses the real labeled shared picker in a separate calendar dialog and commits only after confirmation", async () => {
  render(<ManualReservationDialog context="admin" fixedPropertyId={10} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  const wizard = await screen.findByRole("dialog", { name: "افزودن رزرو" });
  expect(wizard.closest("[dir]")?.getAttribute("dir")).toBe("rtl");
  expect(wizard.className).toContain("max-w-3xl");
  const trigger = within(wizard).getByRole("button", { name: /^ورود:/ });
  expect(trigger.getAttribute("data-field-size")).toBe("compact");
  expect(Array.from(trigger.querySelectorAll("[data-date-label]")).map(label => label.textContent))
    .toEqual(["ورود", "خروج"]);
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
  const calendar = screen.getAllByRole("dialog").find(dialog => dialog !== wizard)!;
  expect(wizard.contains(calendar)).toBe(false);
  const days = Array.from(calendar.querySelectorAll<HTMLButtonElement>("[data-calendar-date]"))
    .filter(day => !day.disabled);
  expect(days.length).toBeGreaterThan(1);
  fireEvent.click(days[0]);
  fireEvent.click(days[1]);
  expect(trigger.querySelector("[data-date-primary]")).toBeNull();
  fireEvent.click(within(calendar).getByRole("button", { name: "تایید" }));
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  expect(trigger.querySelectorAll("[data-date-primary]")).toHaveLength(2);
  expect(within(trigger).getByText("ورود")).toBeTruthy();
  expect(within(trigger).getByText("خروج")).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  expect(api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});
