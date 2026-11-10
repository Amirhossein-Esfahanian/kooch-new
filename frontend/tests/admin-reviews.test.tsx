import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/owner-api";
import type { AdminReview } from "@/lib/admin-reviews";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), moderate: vi.fn(), publication: vi.fn(),
  session: { authenticated: true, loading: false, workspaces: ["admin"], platformRole: "SuperAdmin", user: { userId: 3 } } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/admin-reviews", async original => ({ ...await original<typeof import("@/lib/admin-reviews")>(),
  getAdminReviews: mocks.list, getAdminReview: mocks.get, moderateReview: mocks.moderate, setReviewPublication: mocks.publication }));
import { AdminReviewsPage } from "@/components/reviews/AdminReviewsPage";
import { metadata } from "@/app/admin/reviews/page";

const item: AdminReview = { propertyName: "سرای آزمایش", guestDisplayName: "مهمان", reservationNumber: "R-1",
  checkInDate: "2026-11-01", checkOutDate: "2026-11-03", submittedAtUtc: "2026-11-08T10:00:00Z",
  moderatedAtUtc: null, moderatedByUserId: null, review: { id: 1, reservationId: 37, propertyId: 2,
    cleanlinessRating: 1, staffRating: 2, comfortRating: 3, facilitiesRating: 4, locationRating: 5, valueRating: 6,
    ratingSum: 21, overallRating: 3.5, comment: "", moderationStatus: "PendingApproval", isPublished: false, revision: 1 } };
const paged = (items: AdminReview[], totalPages = 1) => ({ items, page: 1, pageSize: 20, totalCount: items.length, totalPages });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { authenticated: true, loading: false, workspaces: ["admin"], platformRole: "SuperAdmin", user: { userId: 3 } };
  mocks.list.mockResolvedValue(paged([item])); mocks.get.mockResolvedValue(item); mocks.moderate.mockResolvedValue(item);
});
async function openReview() {
  render(<AdminReviewsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "بررسی نظر 1 برای سرای آزمایش" }));
  await screen.findByText("بدون توضیح");
  await screen.findByRole("dialog");
}

it.each([true, false])("requires a deliberate publication action for published=%s", async published => {
  const approved = { ...item, unpublicationReason: published ? null : "دلیل داخلی بررسی", review: { ...item.review, moderationStatus: "Approved" as const, isPublished: published, revision: 2 } };
  mocks.get.mockResolvedValue(approved); mocks.publication.mockResolvedValue(approved);
  await openReview(); fireEvent.click(await screen.findByRole("button", { name: published ? "لغو انتشار نظر" : "بازنشر نظر" }));
  expect(mocks.publication).not.toHaveBeenCalled();
  if (published) {
    const confirm = screen.getByRole("button", { name: "ثبت دلیل و لغو انتشار" }); expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("دلیل داخلی لغو انتشار (الزامی)"), { target: { value: "دلیل داخلی بررسی" } }); fireEvent.click(confirm);
  } else fireEvent.click(screen.getByRole("button", { name: "تأیید بازنشر" }));
  await waitFor(() => expect(mocks.publication).toHaveBeenCalledWith(1, 2, !published, published ? "دلیل داخلی بررسی" : "", expect.any(AbortSignal)));
});

it.each(["Client", "Owner", "AdminAssistant"])("does not fetch moderation data for %s", role => {
  mocks.session.platformRole = role; render(<AdminReviewsPage />);
  expect(mocks.list).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("فقط برای مدیر کل");
});
it("does not fetch before authentication or session resolution", () => {
  mocks.session.loading = true; mocks.session.authenticated = false;
  render(<AdminReviewsPage />); expect(mocks.list).not.toHaveBeenCalled();
});
it("shows loading, a retryable error, and empty states", async () => {
  mocks.list.mockRejectedValueOnce(new Error("offline")); render(<AdminReviewsPage />);
  expect(screen.getByRole("status").textContent).toContain("در حال دریافت");
  await screen.findByRole("alert"); mocks.list.mockResolvedValue(paged([]));
  fireEvent.click(screen.getByRole("button", { name: "دریافت دوباره فهرست" }));
  await screen.findByText("نظری با این فیلتر وجود ندارد.");
});
it("uses pending by default, filters on demand and requests subsequent pages", async () => {
  mocks.list.mockResolvedValue(paged([item], 2)); render(<AdminReviewsPage />);
  await screen.findByText("سرای آزمایش");
  expect(mocks.list).toHaveBeenLastCalledWith({ status: "PendingApproval", propertyId: "", search: "" }, 1, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.anything(), 2, expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText("وضعیت"), { target: { value: "All" } });
  fireEvent.change(screen.getByLabelText("شناسه اقامتگاه"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("اقامتگاه یا شماره رزرو"), { target: { value: "R-1" } });
  fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ status: "All", propertyId: "2", search: "R-1" }, 1, expect.any(AbortSignal)));
});
it("loads fresh detail, six categories, optional comment and deliberate publication confirmation", async () => {
  await openReview(); expect(mocks.get).toHaveBeenCalledWith(1, expect.any(AbortSignal));
  expect(screen.getByText("امتیاز کلی: ۳٫۵ از ۱۰")).toBeTruthy();
  for (const text of ["نظافت", "برخورد کارکنان", "راحتی و آسایش", "امکانات", "موقعیت و دسترسی", "ارزش نسبت به قیمت"]) expect(screen.getByText(text)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "تأیید نظر" }));
  expect(mocks.moderate).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "تأیید و انتشار" }));
  await waitFor(() => expect(mocks.moderate).toHaveBeenCalledOnce());
  expect(mocks.moderate).toHaveBeenCalledWith(1, 1, "approve", "", expect.any(AbortSignal));
  await screen.findByText("نظر تأیید و منتشر شد.");
});
it("requires a meaningful labeled rejection reason and sends the captured revision once", async () => {
  await openReview(); fireEvent.click(screen.getByRole("button", { name: "رد نظر" }));
  const dialog = screen.getByRole("dialog"); const confirm = within(dialog).getByRole("button", { name: "ثبت دلیل و رد نظر" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  const reason = screen.getByLabelText("دلیل رد نظر (الزامی)");
  fireEvent.change(reason, { target: { value: "abc" } }); expect(reason.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(reason, { target: { value: "لطفاً اطلاعات تماس را حذف کنید." } });
  fireEvent.click(confirm); fireEvent.click(confirm);
  await waitFor(() => expect(mocks.moderate).toHaveBeenCalledOnce());
  expect(mocks.moderate).toHaveBeenCalledWith(1, 1, "reject", "لطفاً اطلاعات تماس را حذف کنید.", expect.any(AbortSignal));
});
it("announces stale revision and requires fresh information before another decision", async () => {
  mocks.moderate.mockRejectedValueOnce(new ApiRequestError("ReviewModerationConflict", 409));
  await openReview(); fireEvent.click(screen.getByRole("button", { name: "تأیید نظر" }));
  fireEvent.click(screen.getByRole("button", { name: "تأیید و انتشار" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("نظر تغییر کرده"));
  expect(screen.queryByRole("button", { name: "تأیید نظر" })).toBeNull();
  expect(mocks.moderate).toHaveBeenCalledOnce();
});
it("keeps approved or rejected details read-only and marks the page noindex", async () => {
  mocks.get.mockResolvedValue({ ...item, review: { ...item.review, moderationStatus: "Rejected", rejectionReason: "دلیل قابل نمایش" } });
  await openReview(); await screen.findByText("دلیل رد: دلیل قابل نمایش");
  expect(screen.queryByRole("button", { name: "تأیید نظر" })).toBeNull();
  expect(screen.queryByRole("button", { name: "رد نظر" })).toBeNull();
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
it("closes the confirmation with Escape without closing the detail", async () => {
  await openReview(); fireEvent.click(screen.getByRole("button", { name: "تأیید نظر" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "تأیید و انتشار نظر" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "بررسی نظر مهمان" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "تأیید نظر" })));
  expect(mocks.moderate).not.toHaveBeenCalled();
});

it("keeps a single shared modal and cycles focus at its forward/backward boundaries", async () => {
  const offsets = vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function(this: HTMLElement) { return this.parentElement; });
  try {
    await openReview(); fireEvent.click(screen.getByRole("button", { name: "تأیید نظر" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const dialog = screen.getByRole("dialog");
    const first = within(dialog).getByRole("button", { name: "بستن" });
    const last = within(dialog).getByRole("button", { name: "تأیید و انتشار" });
    last.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(document.activeElement).toBe(first);
    first.focus(); fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به بررسی" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "تأیید نظر" }));
    fireEvent.click(screen.getByRole("button", { name: "رد نظر" }));
    expect(document.activeElement).toBe(screen.getByLabelText("دلیل رد نظر (الزامی)"));
  } finally { offsets.mockRestore(); }
});

it("returns to a valid page when the last pending page shrinks", async () => {
  mocks.list.mockResolvedValueOnce(paged([item], 2)).mockResolvedValueOnce({ ...paged([], 1), page: 2 }).mockResolvedValue(paged([item]));
  render(<AdminReviewsPage />); await screen.findByText("سرای آزمایش");
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
  expect(mocks.list).toHaveBeenLastCalledWith(expect.anything(), 1, expect.any(AbortSignal));
  await screen.findByText("سرای آزمایش");
  expect(screen.queryByText("نظری با این فیلتر وجود ندارد.")).toBeNull();
});
