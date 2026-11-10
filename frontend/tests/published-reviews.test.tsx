import { fireEvent, render, screen, waitFor, renderHook, act, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PublishedRating, PublishedReviewList, ReviewScoreList } from "@/components/reviews/PublishedReviews";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PublicReviewPage } from "@/lib/property-reviews";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/property-reviews", async original => ({ ...await original<typeof import("@/lib/property-reviews")>(), getPublicPropertyReviews: request }));
import { usePublicPropertyReviews } from "@/hooks/usePublicPropertyReviews";
export const publicPage: PublicReviewPage = {
  summary: { count: 2, overallRating: 19 / 12, categories: { cleanlinessRating: 1.5, staffRating: 1.5, comfortRating: 1.5, facilitiesRating: 1.5, locationRating: 1.5, valueRating: 2 } },
  reviews: { items: [{ id: 1, guestDisplayName: "مهمان", submittedAtUtc: "2026-11-08T10:00:00Z", cleanlinessRating: 1, staffRating: 1, comfortRating: 1, facilitiesRating: 1, locationRating: 1, valueRating: 1, overallRating: 1, comment: "", ownerReply: { text: "پاسخ تأییدشده", publishedAtUtc: null } }], page: 1, pageSize: 1, totalCount: 2, totalPages: 2 },
};
beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue(publicPage); });
const listProps = { error: false, page: 1, onPage: vi.fn(), retry: vi.fn() };

it("separates property averages/count from individual ratings and keeps category details collapsed", () => {
  render(<PublishedReviewList {...listProps} data={publicPage} />);
  const summary = screen.getByRole("region", { name: "خلاصه امتیازهای اقامتگاه" });
  expect(within(summary).getByText("بر اساس ۲ نظر منتشرشده")).toBeTruthy();
  expect(within(summary).getByText("۱٫۶")).toBeTruthy();
  const averages = within(summary).getAllByRole("meter"); expect(averages).toHaveLength(6);
  expect(averages[0].getAttribute("aria-valuenow")).toBe("1.5"); expect(averages[5].getAttribute("aria-valuenow")).toBe("2");
  const list = screen.getByRole("list", { name: "نظرات منتشرشدهٔ مهمانان" }); const card = within(list).getByRole("region", { name: "مهمان" });
  expect(within(card).getByText("۱٫۰")).toBeTruthy(); expect(card.querySelector("time")?.getAttribute("datetime")).toBe(publicPage.reviews.items[0].submittedAtUtc);
  const details = card.querySelector("details")!; expect(details.open).toBe(false);
  const toggle = within(card).getByText("جزئیات امتیازها"); expect(toggle.tagName).toBe("SUMMARY");
  toggle.focus(); expect(document.activeElement).toBe(toggle); fireEvent.click(toggle); expect(details.open).toBe(true);
  const individual = within(details).getAllByRole("meter"); expect(individual).toHaveLength(6);
  individual.forEach(meter => { expect(meter.getAttribute("aria-valuenow")).toBe("1"); expect(meter.getAttribute("aria-valuemax")).toBe("10"); });
  fireEvent.click(toggle); expect(details.open).toBe(false);
});

it("gives each review an independent disclosure and preserves real comment/approved reply text", () => {
  const first = publicPage.reviews.items[0]; const comment = "متن واقعی مهمان\nدر دو خط";
  render(<PublishedReviewList {...listProps} data={{ ...publicPage, reviews: { ...publicPage.reviews,
    items: [first, { ...first, id: 2, guestDisplayName: "مهمان دوم", comment, ownerReply: null }] } }} />);
  const list = screen.getByRole("list", { name: "نظرات منتشرشدهٔ مهمانان" }); const cards = within(list).getAllByRole("listitem");
  fireEvent.click(within(cards[0]).getByText("جزئیات امتیازها"));
  expect(cards[0].querySelector("details")?.open).toBe(true); expect(cards[1].querySelector("details")?.open).toBe(false);
  expect(within(cards[1]).getByText(comment, { normalizer: value => value }).textContent).toBe(comment);
  expect(within(cards[0]).getByRole("region", { name: "پاسخ اقامتگاه" }).textContent).toContain("پاسخ تأییدشده");
  expect(within(cards[1]).queryByRole("region", { name: "پاسخ اقامتگاه" })).toBeNull();
});

it("uses a compact sidebar score and exact published count without a repeated category grid", () => {
  const view = render(<PublishedRating summary={publicPage.summary} />);
  expect(screen.getByText("۱٫۶")).toBeTruthy(); expect(screen.getByText("از ۱۰")).toBeTruthy();
  expect(screen.getByText("بر اساس ۲ نظر منتشرشده")).toBeTruthy(); expect(screen.queryByRole("meter")).toBeNull();
  view.rerender(<PublishedRating summary={{ ...publicPage.summary, count: 0, overallRating: null }} />);
  expect(screen.getByText("هنوز امتیازی ثبت نشده")).toBeTruthy(); expect(screen.queryByText("از ۱۰")).toBeNull();
});

it("does not fabricate numeric values for unavailable category averages", () => {
  render(<ReviewScoreList scores={{ cleanlinessRating: null }} />); expect(screen.getAllByText("—")).toHaveLength(6);
  expect(screen.queryByRole("meter")).toBeNull();
});

it("keeps width, RTL spacing, responsive bars and disclosure focus scoped to published reviews", () => {
  const css = readFileSync(resolve("components/reviews/PublishedReviews.module.css"), "utf8");
  expect(css).toContain("max-width: 56rem"); expect(css).toContain("repeat(2, minmax(0, 1fr))");
  expect(css).toContain("padding-inline-end"); expect(css).toContain("@media (max-width: 420px)");
  expect(css).toContain(":focus-visible"); expect(css).toContain("min-height: 2.75rem"); expect(css).toContain("var(--ring)"); expect(css).not.toContain(":global");
});
it("displays server averages to one decimal, rating-only reviews, public reply and bounded pagination", () => {
  const next = vi.fn(); render(<PublishedReviewList data={publicPage} error={false} page={1} onPage={next} retry={vi.fn()} />);
  expect(screen.getByText("۱٫۶")).toBeTruthy(); expect(screen.getByText("بدون توضیح")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "پاسخ اقامتگاه" })).toBeTruthy(); expect(screen.getByText("پاسخ تأییدشده")).toBeTruthy();
  expect((screen.getByRole("button", { name: "صفحه قبل" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" })); expect(next).toHaveBeenCalledWith(2);
});
it("never fabricates a zero rating and supports loading, unavailable and retry", () => {
  const retry = vi.fn(); const props = { page: 1, onPage: vi.fn(), retry };
  const view = render(<PublishedReviewList {...props} data={null} error={false} />); expect(screen.getByRole("status")).toBeTruthy();
  view.rerender(<PublishedReviewList {...props} data={null} error />); fireEvent.click(screen.getByRole("button", { name: "دریافت دوباره نظرات" })); expect(retry).toHaveBeenCalledOnce();
  view.rerender(<PublishedReviewList {...props} data={{ ...publicPage, summary: { ...publicPage.summary, count: 0, overallRating: null }, reviews: { ...publicPage.reviews, items: [], totalPages: 0 } }} error={false} />);
  expect(screen.getByText("هنوز امتیازی ثبت نشده")).toBeTruthy(); expect(screen.queryByText(/از ۱۰/)).toBeNull();
});
it("loads once per page, refreshes on focus and ignores aborted old-property requests", async () => {
  const { result, rerender } = renderHook(({ slug }) => usePublicPropertyReviews(slug), { initialProps: { slug: "stay" } });
  await waitFor(() => expect(result.current.data).toEqual(publicPage)); expect(request).toHaveBeenCalledOnce();
  act(() => result.current.setPage(2)); await waitFor(() => expect(request).toHaveBeenLastCalledWith("stay", 2, expect.any(AbortSignal)));
  act(() => fireEvent.focus(window)); await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  let resolveOld!: (value: PublicReviewPage) => void; request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  act(() => result.current.retry()); await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
  rerender({ slug: "new-property" }); await waitFor(() => expect(request).toHaveBeenLastCalledWith("new-property", 1, expect.any(AbortSignal)));
  await act(async () => resolveOld({ ...publicPage, summary: { ...publicPage.summary, count: 999 } }));
  expect(result.current.data?.summary.count).toBe(2);
});
