import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/owner-api";
import type { AdminReview } from "@/lib/admin-reviews";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), moderate: vi.fn(), publication: vi.fn(),
  session: { authenticated: true, loading: false, workspaces: ["admin"], platformRole: "SuperAdmin", user: { userId: 3 } } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/reviews" }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/admin-reviews", async original => ({ ...await original<typeof import("@/lib/admin-reviews")>(),
  getAdminReviews: mocks.list, getAdminReview: mocks.get, moderateReview: mocks.moderate, setReviewPublication: mocks.publication }));
import { AdminReviewsPage } from "@/components/reviews/AdminReviewsPage";
import { metadata } from "@/app/admin/reviews/page";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

it("renders bounded compact list items rather than a table, preserves server order and shows total count", async () => {
  const newer = { ...item, guestDisplayName: "مهمان تازه", submittedAtUtc: "2026-11-09T10:00:00Z", review: { ...item.review, id: 2 } };
  mocks.list.mockResolvedValue({ ...paged([newer, item]), totalCount: 43, totalPages: 3 }); render(<AdminReviewsPage />);
  const list = await screen.findByRole("list", { name: "فهرست نظرات مهمانان" });
  const rows = within(list).getAllByRole("listitem"); expect(rows).toHaveLength(2); expect(rows[0].textContent).toContain("مهمان تازه");
  expect(rows[1].textContent).toContain("مهمان"); expect(screen.queryByRole("table")).toBeNull();
  expect(within(rows[0]).getByRole("button").textContent).toBe("بررسی");
  expect(within(rows[0]).getByText("سرای آزمایش")).toBeTruthy(); expect(rows[0].textContent).toContain("رزرو R-1");
  expect(screen.getByText("تعداد کل: ۴۳ نظر")).toBeTruthy(); expect(mocks.list).toHaveBeenCalledOnce();
  const css = readFileSync(resolve("components/reviews/AdminReviewsPage.module.css"), "utf8");
  expect(css).toContain("minmax(0, 1fr)"); expect(css).toContain("@media (max-width: 639px)"); expect(css).toContain("100dvh - 2rem");
  expect(css).toContain("min-height: 2.75rem"); expect(css).not.toContain(":global");
});

it.each(["PendingApproval", "Rejected", "Approved"] as const)("shows actual %s reply state and distinguishes approved text from revisions", async moderationStatus => {
  mocks.get.mockResolvedValue({ ...item, ownerReply: { id: 4, reviewId: 1, revision: 3, moderationStatus,
    body: "متن نسخه جدید", publishedBody: "پاسخ عمومی قبلی", publishedAtUtc: "2026-11-08T10:00:00Z", rejectionReason: moderationStatus === "Rejected" ? "دلیل رد پاسخ" : null } });
  await openReview(); const reply = screen.getByRole("region", { name: "پاسخ اقامتگاه" });
  expect(within(reply).getByText("نسخهٔ تأییدشدهٔ عمومی")).toBeTruthy(); expect(within(reply).getByText("پاسخ عمومی قبلی")).toBeTruthy();
  expect(within(reply).getByText(`وضعیت نسخهٔ پاسخ: ${moderationStatus === "PendingApproval" ? "در انتظار تأیید" : moderationStatus === "Rejected" ? "ردشده" : "تأییدشده"}`)).toBeTruthy();
  if (moderationStatus !== "Approved") { expect(within(reply).getByText("متن نسخه جدید")).toBeTruthy(); expect(within(reply).getByText("نسخهٔ ارسال‌شده (غیرعمومی)")).toBeTruthy(); }
  else expect(within(reply).queryByText("متن نسخه جدید")).toBeNull();
  expect(screen.getByRole("region", { name: "وضعیت و آخرین تصمیم" })).toBeTruthy();
});

it("does not fabricate reply availability for an older response contract", async () => {
  await openReview(); expect(screen.getByText("اطلاعات پاسخ اقامتگاه در دسترس نیست.")).toBeTruthy();
  expect(screen.queryByText("پاسخی ثبت نشده است.")).toBeNull();
});

it("distinguishes an explicit absent reply from an unavailable detail response", async () => {
  mocks.get.mockResolvedValue({ ...item, ownerReply: null }); await openReview();
  expect(screen.getByText("پاسخی ثبت نشده است.")).toBeTruthy();
  expect(screen.queryByText("اطلاعات پاسخ اقامتگاه در دسترس نیست.")).toBeNull();
});

it.each(["PendingApproval", "Rejected"] as const)("keeps an unpublished %s reply private without inventing an approved version", async moderationStatus => {
  mocks.get.mockResolvedValue({ ...item, ownerReply: { id: 4, reviewId: 1, revision: 1, moderationStatus,
    body: "پاسخ خصوصی اقامتگاه", publishedBody: null, publishedAtUtc: null, rejectionReason: null } });
  await openReview(); const reply = screen.getByRole("region", { name: "پاسخ اقامتگاه" });
  expect(within(reply).getByText("پاسخ خصوصی اقامتگاه")).toBeTruthy();
  expect(within(reply).getByText("نسخهٔ ارسال‌شده (غیرعمومی)")).toBeTruthy();
  expect(within(reply).queryByText("نسخهٔ تأییدشدهٔ عمومی")).toBeNull();
});

it("announces detail load failure rather than claiming that no owner reply exists", async () => {
  mocks.get.mockRejectedValue(new ApiRequestError("unavailable", 503)); render(<AdminReviewsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "بررسی نظر 1 برای سرای آزمایش" }));
  await screen.findByRole("alert"); expect(screen.queryByText("پاسخی ثبت نشده است.")).toBeNull();
  expect(screen.queryByRole("button", { name: "تأیید نظر" })).toBeNull();
});

it("keeps rating styles dialog-scoped with compact grouped values and a narrow-mobile fallback", () => {
  const css = readFileSync(resolve("components/reviews/AdminReviewsPage.module.css"), "utf8");
  expect(css).toContain(".detailScore"); expect(css).toContain(".categoryValue");
  expect(css).toContain("repeat(2, minmax(0, 1fr))"); expect(css).toContain("@media (max-width: 380px)");
  expect(css).toContain(".ratingTrack"); expect(css).toContain("var(--primary)"); expect(css).not.toContain(":global");
});

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
it("defaults to All, paginates on the server and resets every changed filter to page one", async () => {
  mocks.list.mockResolvedValue(paged([item], 2)); render(<AdminReviewsPage />);
  await screen.findByText("سرای آزمایش");
  expect((screen.getByLabelText("وضعیت") as HTMLSelectElement).value).toBe("All");
  expect(screen.getByRole("option", { name: "همه نظرات" })).toBeTruthy();
  expect(mocks.list).toHaveBeenLastCalledWith({ status: "All", propertyId: "", search: "" }, 1, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.anything(), 2, expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText("وضعیت"), { target: { value: "PendingApproval" } });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ status: "PendingApproval", propertyId: "", search: "" }, 1, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.anything(), 2, expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText("شناسه اقامتگاه"), { target: { value: "2" } });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ status: "PendingApproval", propertyId: "2", search: "" }, 1, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.anything(), 2, expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText("اقامتگاه یا شماره رزرو"), { target: { value: "R-1" } });
  fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ status: "PendingApproval", propertyId: "2", search: "R-1" }, 1, expect.any(AbortSignal)));
});
it("loads fresh detail, six categories, optional comment and deliberate publication confirmation", async () => {
  await openReview(); expect(mocks.get).toHaveBeenCalledWith(1, expect.any(AbortSignal));
  const score = screen.getByRole("group", { name: "امتیاز کلی" });
  expect(within(score).getByText("۳٫۵")).toBeTruthy(); expect(within(score).getByText("از ۱۰")).toBeTruthy();
  const meters = within(screen.getByRole("dialog")).getAllByRole("meter"); expect(meters).toHaveLength(6);
  meters.forEach((meter, index) => {
    expect(meter.getAttribute("aria-valuenow")).toBe(String(index + 1)); expect(meter.getAttribute("aria-valuemax")).toBe("10");
    expect((meter.firstElementChild as HTMLElement).style.width).toBe(`${(index + 1) * 10}%`);
  });
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
