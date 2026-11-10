import { fireEvent, render, screen, waitFor, renderHook, act } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PublishedReviewList } from "@/components/reviews/PublishedReviews";
import type { PublicReviewPage } from "@/lib/property-reviews";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/property-reviews", async original => ({ ...await original<typeof import("@/lib/property-reviews")>(), getPublicPropertyReviews: request }));
import { usePublicPropertyReviews } from "@/hooks/usePublicPropertyReviews";
export const publicPage: PublicReviewPage = {
  summary: { count: 2, overallRating: 19 / 12, categories: { cleanlinessRating: 1.5, staffRating: 1.5, comfortRating: 1.5, facilitiesRating: 1.5, locationRating: 1.5, valueRating: 2 } },
  reviews: { items: [{ id: 1, guestDisplayName: "مهمان", submittedAtUtc: "2026-11-08T10:00:00Z", cleanlinessRating: 1, staffRating: 1, comfortRating: 1, facilitiesRating: 1, locationRating: 1, valueRating: 1, overallRating: 1, comment: "", ownerReply: { text: "پاسخ تأییدشده", publishedAtUtc: null } }], page: 1, pageSize: 1, totalCount: 2, totalPages: 2 },
};
beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue(publicPage); });
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
