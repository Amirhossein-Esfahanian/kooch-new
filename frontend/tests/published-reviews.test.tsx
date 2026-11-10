import { fireEvent, render, screen, waitFor, renderHook, act, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { getRatingQuality, PublishedRating, PublishedReviewContent, PublishedReviewList, ReviewScoreList } from "@/components/reviews/PublishedReviews";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PublicReviewPage } from "@/lib/property-reviews";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/property-reviews", async original => ({ ...await original<typeof import("@/lib/property-reviews")>(), getPublicPropertyReviews: request }));
import { usePublicPropertyReviews } from "@/hooks/usePublicPropertyReviews";
import { KoochInfoHint } from "@/components/KoochInfoHint";
export const publicPage: PublicReviewPage = {
  summary: { count: 2, overallRating: 19 / 12, categories: { cleanlinessRating: 1.5, staffRating: 1.5, comfortRating: 1.5, facilitiesRating: 1.5, locationRating: 1.5, valueRating: 2 } },
  reviews: { items: [{ id: 1, guestDisplayName: "مهمان", submittedAtUtc: "2026-11-08T10:00:00Z", cleanlinessRating: 1, staffRating: 1, comfortRating: 1, facilitiesRating: 1, locationRating: 1, valueRating: 1, overallRating: 1, comment: "", ownerReply: { text: "پاسخ تأییدشده", publishedAtUtc: null } }], page: 1, pageSize: 1, totalCount: 2, totalPages: 2 },
};
beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue(publicPage); });
const listProps = { error: false, page: 1, onPage: vi.fn(), retry: vi.fn() };

it("separates property averages/count from individual ratings and keeps category details collapsed", () => {
  render(<PublishedReviewList {...listProps} data={publicPage} />);
  const summary = screen.getByRole("region", { name: "خلاصه امتیازهای اقامتگاه" });
  expect(within(summary).getByText("بر اساس ۲ نظر")).toBeTruthy();
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
  expect(screen.getByText("بر اساس ۲ نظر")).toBeTruthy(); expect(screen.queryByRole("meter")).toBeNull();
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
  expect(css).toContain("grid-template-columns: minmax(0, 10rem) minmax(0, 1fr)");
  expect(css).toContain("direction: rtl"); expect(css).toContain("@media (min-width: 640px)");
  ["weak", "average", "good", "veryGood", "excellent"].forEach(tone => expect(css).toContain(`.qualityTone[data-quality="${tone}"]`));
  expect(css).toContain("var(--theme-danger)"); expect(css).toContain("var(--theme-warning)"); expect(css).toContain("var(--theme-success)");
});
it("displays server averages to one decimal, rating-only reviews, public reply and bounded pagination", () => {
  const next = vi.fn(); render(<PublishedReviewList data={publicPage} error={false} page={1} onPage={next} retry={vi.fn()} />);
  expect(screen.getByText("۱٫۶")).toBeTruthy(); expect(screen.getByText("بدون توضیح")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "پاسخ اقامتگاه" })).toBeTruthy(); expect(screen.getByText("پاسخ تأییدشده")).toBeTruthy();
  screen.getAllByRole("button", { name: "صفحه قبل" }).forEach(button => expect((button as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(screen.getAllByRole("button", { name: "صفحه بعد" })[0]); expect(next).toHaveBeenCalledWith(2);
});

it.each([
  [0, "weak", "ضعیف"], [3.99, "weak", "ضعیف"], [4, "average", "متوسط"], [5.99, "average", "متوسط"],
  [6, "good", "خوب"], [7.99, "good", "خوب"], [8, "veryGood", "بسیار خوب"], [8.99, "veryGood", "بسیار خوب"],
  [9, "excellent", "عالی"], [10, "excellent", "عالی"],
])("shares exact quality boundaries for score %s", (score, tone, label) => {
  expect(getRatingQuality(score as number)).toEqual({ tone, label });
  render(<><PublishedRating summary={{ ...publicPage.summary, overallRating: score as number }} />
    <PublishedReviewContent review={{ ...publicPage.reviews.items[0], overallRating: score as number, cleanlinessRating: score as number }} /></>);
  expect(screen.getAllByText(label as string)).toHaveLength(2);
  expect(document.querySelectorAll(`[data-quality="${tone}"]`).length).toBeGreaterThanOrEqual(3);
});

it("omits repeated category scales, labels review dates and does not invent missing stay metadata", () => {
  const view = render(<ReviewScoreList scores={publicPage.summary.categories} />);
  expect(screen.queryByText(/از ۱۰|\/۱۰/)).toBeNull();
  expect(screen.getAllByRole("meter")[0].getAttribute("aria-valuetext")).toContain("از ۱۰");
  view.rerender(<PublishedReviewContent review={publicPage.reviews.items[0]} />);
  expect(screen.getByText(/تاریخ ثبت نظر:/)).toBeTruthy();
  expect(screen.queryByText(/نوع اتاق|تاریخ اقامت/)).toBeNull();
});

it.each([1, 2, 21])("uses Persian counted noun for %s reviews", count => {
  render(<PublishedRating summary={{ ...publicPage.summary, count }} />);
  expect(screen.getByText(`بر اساس ${count.toLocaleString("fa-IR")} نظر`)).toBeTruthy();
});

it("renders identical top/bottom controls from server totalCount and one parent page state", () => {
  const onPage = vi.fn();
  const props = { ...listProps, onPage, data: { ...publicPage, reviews: { ...publicPage.reviews, totalCount: 35, totalPages: 4 } } };
  const view = render(<PublishedReviewList {...props} />);
  const controls = screen.getAllByRole("navigation", { name: /صفحه‌بندی نظرات مهمانان/ }); expect(controls).toHaveLength(2);
  controls.forEach(nav => {
    expect(within(nav).getByText("۳۵ نظر")).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: "صفحه بعد" }));
  });
  expect(onPage.mock.calls).toEqual([[2], [2]]);
  view.rerender(<PublishedReviewList {...props} page={4} />);
  screen.getAllByRole("button", { name: "صفحه بعد" }).forEach(button => expect((button as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getAllByText("صفحه ۴ از ۴")).toHaveLength(2);
  expect(request).not.toHaveBeenCalled();
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

it("shows bounded recent ratings in server order with shared quality colors, keyboard focus and Escape", () => {
  const scores = [9, 4, 6, 8, 3];
  render(<PublishedRating summary={{ ...publicPage.summary, recentRatings: scores }} />);
  const trigger = screen.getByRole("button", { name: "نمایش امتیازهای اخیر" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.focus(trigger); expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const list = screen.getByRole("list", { name: "امتیازهای اخیر، از جدیدترین به قدیمی‌ترین" });
  const pills = within(list).getAllByRole("listitem"); expect(pills).toHaveLength(5);
  pills.forEach((pill, index) => {
    expect(pill.getAttribute("data-quality")).toBe(getRatingQuality(scores[index]).tone);
    expect(pill.textContent).toBe(scores[index].toLocaleString("fa-IR", { minimumFractionDigits: 1 }));
  });
  expect(screen.getByText(/راست به چپ/)).toBeTruthy();
  fireEvent.keyDown(trigger, { key: "Escape" }); expect(screen.queryByRole("note")).toBeNull();
  fireEvent.click(trigger); expect(screen.getByRole("note")).toBeTruthy();
  fireEvent.pointerDown(document.body); expect(screen.queryByRole("note")).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("supports hover into the popover and dismisses on pointer exit without stealing focus", () => {
  vi.useFakeTimers();
  try {
    render(<PublishedRating summary={{ ...publicPage.summary, recentRatings: [8] }} />);
    const trigger = screen.getByRole("button", { name: "نمایش امتیازهای اخیر" });
    const root = trigger.parentElement!;
    fireEvent.mouseEnter(root); expect(screen.getByRole("note")).toBeTruthy();
    fireEvent.mouseLeave(root); fireEvent.mouseEnter(screen.getByRole("note"));
    act(() => vi.advanceTimersByTime(200)); expect(screen.getByRole("note")).toBeTruthy();
    fireEvent.mouseLeave(root); act(() => vi.advanceTimersByTime(200)); expect(screen.queryByRole("note")).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("caps recent ratings at ten and handles missing/empty data without fabricated scores", () => {
  const view = render(<PublishedRating summary={{ ...publicPage.summary, recentRatings: Array.from({ length: 12 }, () => 8) }} />);
  fireEvent.click(screen.getByRole("button", { name: "نمایش امتیازهای اخیر" }));
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(10);
  view.rerender(<PublishedRating summary={publicPage.summary} />);
  expect(screen.getByText("امتیازهای اخیر در دسترس نیست.")).toBeTruthy(); expect(screen.queryByRole("list")).toBeNull();
  view.rerender(<PublishedRating summary={{ ...publicPage.summary, recentRatings: [] }} />);
  expect(screen.getByText("امتیازهای اخیر در دسترس نیست.")).toBeTruthy();
});

it("renders actual room and stay dates only when supplied, retaining the labeled submission date", () => {
  const review = { ...publicPage.reviews.items[0], roomTypeName: "سوئیت باغ", checkInDate: "2026-11-05", checkOutDate: "2026-11-07" };
  const view = render(<PublishedReviewContent review={review} />);
  const header = view.container.querySelector("header")!;
  expect(within(header).getByText("نوع اتاق: سوئیت باغ")).toBeTruthy();
  expect(header.querySelector('time[datetime="2026-11-05"]')).toBeTruthy();
  expect(header.querySelector('time[datetime="2026-11-07"]')).toBeTruthy();
  expect(within(header).getByText(/تاریخ ثبت نظر:/)).toBeTruthy();
  view.rerender(<PublishedReviewContent review={{ ...review, roomTypeName: null, checkInDate: null, checkOutDate: null }} />);
  expect(screen.queryByText(/نوع اتاق:|ورود:|خروج:/)).toBeNull();
});

it("preserves default shared info-hint click behavior without opting into review interactions", () => {
  render(<KoochInfoHint content="توضیح موجود" />);
  const trigger = screen.getByRole("button", { name: "نمایش توضیح" });
  fireEvent.focus(trigger); expect(screen.queryByRole("note")).toBeNull();
  fireEvent.click(trigger); expect(screen.getByRole("note")).toBeTruthy();
  fireEvent.click(trigger); expect(screen.queryByRole("note")).toBeNull();
});

it("keeps the recent-ratings popover within the viewport and associates its content with the trigger", () => {
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return this.getAttribute("role") === "note" ? new DOMRect(0, 0, 288, 150) : new DOMRect(10, 10, 24, 24);
  });
  try {
    render(<PublishedRating summary={{ ...publicPage.summary, recentRatings: [9] }} />);
    const trigger = screen.getByRole("button", { name: "نمایش امتیازهای اخیر" }); fireEvent.click(trigger);
    const note = screen.getByRole("note");
    expect(note.style.position).toBe("fixed"); expect(note.style.left).toBe("16px");
    expect(trigger.getAttribute("aria-describedby")).toBe(note.id);
  } finally { rect.mockRestore(); }
});
