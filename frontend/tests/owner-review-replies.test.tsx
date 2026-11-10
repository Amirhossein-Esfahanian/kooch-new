import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/owner-api";
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(),
  session: { authenticated: true, loading: false, workspaces: ["owner"], user: { userId: 2 } },
  property: { propertyId: 2, routePropertyIsValid: true, effectivePermissions: { Reviews: { view: true, edit: true } } } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({ useOwnerProperty: () => mocks.property }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ OwnerLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/property-reviews", async original => ({ ...await original<typeof import("@/lib/property-reviews")>(), getOwnerReviews: mocks.list, saveOwnerReply: mocks.save }));
import { OwnerReviewsPage } from "@/components/reviews/OwnerReviewsPage";
import { metadata } from "@/app/owner/properties/[id]/reviews/page";
import { OwnerReviewCard } from "@/components/reviews/OwnerReviewCard";
import type { OwnerReview } from "@/lib/property-reviews";
import { formatDateTime } from "@/lib/account-reservations";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const review = { id: 1, guestDisplayName: "مهمان", submittedAtUtc: "2026-11-08T10:00:00Z", cleanlinessRating: 1, staffRating: 2, comfortRating: 3, facilitiesRating: 4, locationRating: 5, valueRating: 6, overallRating: 3.5, comment: "", ownerReply: { text: "پاسخ عمومی قبلی", publishedAtUtc: null } };
const reply = { id: 4, reviewId: 1, body: "پیش‌نویس خصوصی", moderationStatus: "Rejected", revision: 3, rejectionReason: "اطلاعات شخصی را حذف کنید", publishedBody: "پاسخ عمومی قبلی", publishedAtUtc: null };
const page = { items: [{ review, reply }], page: 1, pageSize: 20, totalCount: 1, totalPages: 2 };
const cardItem: OwnerReview = { review, reply: { ...reply, moderationStatus: "Rejected" } };
beforeEach(() => { vi.clearAllMocks(); mocks.session.authenticated = true; mocks.property.propertyId = 2; mocks.property.routePropertyIsValid = true; mocks.property.effectivePermissions.Reviews = { view: true, edit: true }; mocks.list.mockResolvedValue(page); mocks.save.mockResolvedValue(reply); });
it("uses only global selected property, retains approved public snapshot and private draft, filters and paginates", async () => {
  render(<OwnerReviewsPage />); await screen.findByText("پیش‌نویس خصوصی");
  expect(screen.getByText("پاسخ عمومی قبلی")).toBeTruthy(); expect(screen.getByText(/دلیل رد پاسخ:/)).toBeTruthy();
  expect(screen.queryByLabelText(/انتخاب اقامتگاه/)).toBeNull();
  fireEvent.change(screen.getByLabelText("وضعیت پاسخ"), { target: { value: "PendingApproval" } });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(2, "PendingApproval", 1, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" })); await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(2, "PendingApproval", 2, expect.any(AbortSignal)));
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
it("sends a revisioned response once through shared dialog and announces moderation requirement", async () => {
  render(<OwnerReviewsPage />); const button = await screen.findByRole("button", { name: "ویرایش پاسخ" }); button.focus(); fireEvent.click(button);
  const input = await screen.findByLabelText("متن پاسخ (الزامی)"); expect((input as HTMLTextAreaElement).value).toBe(reply.body);
  await screen.findByRole("button", { name: "ارسال پاسخ برای تأیید" });
  fireEvent.change(input, { target: { value: "پاسخ اصلاح‌شده" } }); fireEvent.click(screen.getByRole("button", { name: "ارسال پاسخ برای تأیید" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(2, 1, "پاسخ اصلاح‌شده", 3, expect.any(AbortSignal)));
  await screen.findByText(/پاسخ برای تأیید مدیر کل ارسال شد/); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("guards view/reply permissions and unauthenticated sessions without trusting URL scope", async () => {
  mocks.property.effectivePermissions.Reviews.edit = false; const view = render(<OwnerReviewsPage />); await screen.findByText("پیش‌نویس خصوصی");
  expect(screen.queryByRole("button", { name: "ویرایش پاسخ" })).toBeNull();
  view.unmount(); mocks.list.mockClear(); mocks.property.routePropertyIsValid = false; const invalid = render(<OwnerReviewsPage />); expect(mocks.list).not.toHaveBeenCalled(); invalid.unmount();
  mocks.property.routePropertyIsValid = true; mocks.session.authenticated = false; render(<OwnerReviewsPage />); expect(mocks.list).not.toHaveBeenCalled();
});
it("clears selected draft when global property changes and reports stale revision without blind resubmit", async () => {
  mocks.save.mockRejectedValue(new ApiRequestError("conflict", 409)); const view = render(<OwnerReviewsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "ویرایش پاسخ" })); fireEvent.click(await screen.findByRole("button", { name: "ارسال پاسخ برای تأیید" }));
  await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: "ارسال پاسخ برای تأیید" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "دریافت اطلاعات تازه" })); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  mocks.property.propertyId = 5; mocks.list.mockResolvedValue({ ...page, items: [], totalPages: 0 }); view.rerender(<OwnerReviewsPage />);
  await screen.findByText("نظر منتشرشده‌ای با این فیلتر وجود ندارد."); expect(screen.queryByText("پیش‌نویس خصوصی")).toBeNull();
});
it("shows retryable list errors and never opens a reply form for absent reviews", async () => {
  mocks.list.mockRejectedValueOnce(new Error("offline")); render(<OwnerReviewsPage />); await screen.findByRole("alert");
  mocks.list.mockResolvedValue({ ...page, items: [], totalPages: 0 }); fireEvent.click(screen.getByRole("button", { name: "دریافت دوباره فهرست" }));
  await screen.findByText("نظر منتشرشده‌ای با این فیلتر وجود ندارد."); expect(screen.queryByRole("dialog")).toBeNull();
});

it("contains each guest identity, localized date, exact overall display and six accessible score meters", () => {
  render(<div dir="rtl"><OwnerReviewCard item={cardItem} canReply onReply={vi.fn()} /></div>);
  const card = screen.getByRole("region", { name: "مهمان" });
  expect(within(card).getByText("امتیاز کلی:").parentElement?.textContent).toBe("امتیاز کلی: ۳٫۵از ۱۰");
  const date = within(card).getByText(formatDateTime(review.submittedAtUtc));
  expect(date.tagName).toBe("TIME"); expect(date.getAttribute("datetime")).toBe(review.submittedAtUtc);
  const meters = within(card).getAllByRole("meter"); expect(meters).toHaveLength(6);
  meters.forEach((meter, index) => {
    expect(meter.getAttribute("aria-valuenow")).toBe(String(index + 1));
    expect(meter.getAttribute("aria-valuemax")).toBe("10"); expect(meter.getAttribute("aria-label")).toBeTruthy();
    expect((meter.firstElementChild as HTMLElement).style.width).toBe(`${(index + 1) * 10}%`);
  });
  expect(within(card).getByText("بدون توضیح")).toBeTruthy();
});

it("separates the official response, actual moderation state and pending version without duplicating approved text", () => {
  const onReply = vi.fn(); const view = render(<OwnerReviewCard item={cardItem} canReply onReply={onReply} />);
  const section = screen.getByRole("region", { name: "پاسخ اقامتگاه" });
  expect(within(section).getByText("نسخهٔ پاسخ: ردشده")).toBeTruthy();
  expect(within(section).getByText("پاسخ منتشرشده")).toBeTruthy(); expect(within(section).getByText("نسخهٔ ارسال‌شده")).toBeTruthy();
  expect(within(section).getByText(reply.body)).toBeTruthy();
  fireEvent.click(within(section).getByRole("button", { name: "ویرایش پاسخ" })); expect(onReply).toHaveBeenCalledOnce();
  view.rerender(<OwnerReviewCard item={{ ...cardItem, reply: { ...cardItem.reply!, moderationStatus: "Approved" } }} canReply={false} onReply={onReply} />);
  expect(screen.getAllByText("پاسخ عمومی قبلی")).toHaveLength(1); expect(screen.queryByText(reply.body)).toBeNull();
  expect(screen.queryByRole("button", { name: "ویرایش پاسخ" })).toBeNull();
});

it("keeps guest text verbatim, handles an unanswered review and preserves the existing reply action", () => {
  const text = "متن بلند مهمان\nبا خط جدید و جزئیات واقعی"; const onReply = vi.fn();
  render(<OwnerReviewCard item={{ review: { ...review, comment: text, ownerReply: null }, reply: null }} canReply onReply={onReply} />);
  expect(screen.getByText(text, { normalizer: value => value }).textContent).toBe(text);
  expect(screen.queryByText("بدون توضیح")).toBeNull(); expect(screen.getByText("هنوز پاسخی ثبت نشده است.")).toBeTruthy();
  expect(screen.queryByText(/نسخهٔ پاسخ:/)).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "ثبت پاسخ اقامتگاه" })); expect(onReply).toHaveBeenCalledOnce();
});

it("keeps responsive theme styling local to Owner and leaves shared Marketplace review rendering untouched", () => {
  const css = readFileSync(resolve("components/reviews/OwnerReviewsPage.module.css"), "utf8");
  expect(css).toContain("max-width: 68rem"); expect(css).toContain("repeat(2, minmax(0, 1fr))");
  expect(css).toContain("@media (max-width: 420px)"); expect(css).toContain("overflow-wrap: anywhere");
  expect(css).toContain("var(--border)"); expect(css).toContain("var(--muted)"); expect(css).not.toContain(":global");
  const shared = readFileSync(resolve("components/reviews/PublishedReviews.tsx"), "utf8");
  expect(shared).not.toContain("OwnerReviewsPage.module.css"); expect(shared).not.toContain("OwnerReviewCard");
});
