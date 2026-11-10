import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/owner-api";
const mocks = vi.hoisted(() => ({ list: vi.fn(), moderate: vi.fn(), session: { authenticated: true, loading: false, workspaces: ["admin"], platformRole: "SuperAdmin", user: { userId: 3 } } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/reviews/replies" }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/property-reviews", async original => ({ ...await original<typeof import("@/lib/property-reviews")>(), getAdminReplies: mocks.list, moderateOwnerReply: mocks.moderate }));
import { AdminReviewRepliesPage } from "@/components/reviews/AdminReviewRepliesPage";
import { metadata } from "@/app/admin/reviews/replies/page";
import styles from "@/components/reviews/AdminReviewsPage.module.css";
const item = { propertyId: 2, propertyName: "سرای آزمایش", submittedAtUtc: "2026-11-09T10:00:00Z", reply: { id: 4, reviewId: 1, body: "پاسخ جدید", moderationStatus: "PendingApproval", revision: 3, publishedBody: "پاسخ قبلی", rejectionReason: null }, guestReview: { id: 1, guestDisplayName: "مهمان", submittedAtUtc: "2026-11-08T10:00:00Z", cleanlinessRating: 1, staffRating: 2, comfortRating: 3, facilitiesRating: 4, locationRating: 5, valueRating: 6, overallRating: 3.5, comment: "", ownerReply: { text: "پاسخ قبلی", publishedAtUtc: null } } };
beforeEach(() => { vi.clearAllMocks(); mocks.session.platformRole = "SuperAdmin"; mocks.list.mockResolvedValue({ items: [item], page: 1, totalPages: 2, totalCount: 2, pageSize: 20 }); mocks.moderate.mockResolvedValue(item.reply); });
it.each(["Owner", "AdminAssistant", "Client"])("does not request private moderation queue for %s", role => { mocks.session.platformRole = role; render(<AdminReviewRepliesPage />); expect(mocks.list).not.toHaveBeenCalled(); });
it("has separate review queue links, status/page filters, explicit approval and shared dialog", async () => {
  render(<AdminReviewRepliesPage />); fireEvent.click(await screen.findByRole("button", { name: "بررسی پاسخ" }));
  expect(screen.getByText("پاسخ قبلی")).toBeTruthy(); expect(screen.getByText("پاسخ جدید")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "تأیید پاسخ" })); expect(mocks.moderate).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" }); expect(screen.getByRole("dialog", { name: "بررسی پاسخ اقامتگاه" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "تأیید پاسخ" })); fireEvent.click(screen.getByRole("button", { name: "تأیید و نمایش پاسخ" }));
  await waitFor(() => expect(mocks.moderate).toHaveBeenCalledWith(4, 3, "approve", "", expect.any(AbortSignal)));
  await screen.findByText(/پاسخ اقامتگاه تأیید شد/); fireEvent.change(screen.getByLabelText("وضعیت پاسخ"), { target: { value: "Rejected" } });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith("Rejected", 1, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" })); await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith("Rejected", 2, expect.any(AbortSignal)));
  expect(screen.getByRole("link", { name: "نظرات مهمانان" }).getAttribute("href")).toBe("/admin/reviews"); expect(metadata.robots).toEqual({ index: false, follow: false });
});

it("defaults to All with bounded server pagination, shared compact rows and reply-submission dates", async () => {
  render(<AdminReviewRepliesPage />);
  const list = await screen.findByRole("list", { name: "فهرست پاسخ‌های اقامتگاه" });
  expect(list.classList.contains(styles.list)).toBe(true); expect(screen.queryByRole("table")).toBeNull();
  expect((screen.getByLabelText("وضعیت پاسخ") as HTMLSelectElement).value).toBe("All");
  expect(mocks.list).toHaveBeenLastCalledWith("All", 1, expect.any(AbortSignal));
  const row = within(list).getByRole("listitem"); expect(row.classList.contains(styles.row)).toBe(true);
  expect(row.textContent).toContain("سرای آزمایش"); expect(row.textContent).toContain("مهمان"); expect(row.textContent).toContain("۳٫۵");
  expect(row.querySelector("time")?.getAttribute("datetime")).toBe(item.submittedAtUtc);
  expect(screen.getByText("تعداد کل: ۲ پاسخ")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "صفحه بعد" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith("All", 2, expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText("وضعیت پاسخ"), { target: { value: "PendingApproval" } });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith("PendingApproval", 1, expect.any(AbortSignal)));
});

it.each(["PendingApproval", "Rejected"])("clearly separates public text from the %s revision and reuses compact ratings", async status => {
  mocks.list.mockResolvedValue({ items: [{ ...item, reply: { ...item.reply, moderationStatus: status } }], page: 1, totalPages: 1, totalCount: 1, pageSize: 20 });
  render(<AdminReviewRepliesPage />); fireEvent.click(await screen.findByRole("button", { name: "بررسی پاسخ" }));
  const dialog = await screen.findByRole("dialog"); expect(dialog.classList.contains(styles.dialog)).toBe(true);
  const current = within(dialog).getByRole("region", { name: "نسخهٔ ارسال‌شدهٔ پاسخ اقامتگاه" });
  expect(within(current).getByText("پاسخ جدید")).toBeTruthy(); expect(current.textContent).toContain(status === "Rejected" ? "ردشده" : "در انتظار تأیید");
  const published = within(dialog).getByRole("region", { name: "پاسخ عمومی فعلی" }); expect(within(published).getByText("پاسخ قبلی")).toBeTruthy();
  expect(within(dialog).getAllByRole("meter")).toHaveLength(6); expect(within(dialog).getByRole("group", { name: "امتیاز کلی" })).toBeTruthy();
  expect(within(dialog).getByRole("region", { name: "متن نظر مهمان" }).textContent).toBe("متن نظر: بدون توضیح");
  expect(dialog.querySelectorAll("time")).toHaveLength(2);
});

it("shows an approved public response only once, without pending-only actions", async () => {
  mocks.list.mockResolvedValue({ items: [{ ...item, reply: { ...item.reply, moderationStatus: "Approved" } }], page: 1, totalPages: 1, totalCount: 1, pageSize: 20 });
  render(<AdminReviewRepliesPage />); fireEvent.click(await screen.findByRole("button", { name: "بررسی پاسخ" }));
  const dialog = await screen.findByRole("dialog"); expect(within(dialog).getAllByText("پاسخ قبلی")).toHaveLength(1);
  expect(within(dialog).queryByText("پاسخ جدید")).toBeNull(); expect(within(dialog).queryByRole("button", { name: "تأیید پاسخ" })).toBeNull();
});

it("never substitutes a guest date or an invented stay for missing reply metadata", async () => {
  mocks.list.mockResolvedValue({ items: [{ ...item, submittedAtUtc: undefined }], page: 1, totalPages: 1, totalCount: 1, pageSize: 20 });
  render(<AdminReviewRepliesPage />); await screen.findByText("زمان ارسال در دسترس نیست");
  fireEvent.click(screen.getByRole("button", { name: "بررسی پاسخ" })); const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("زمان ارسال در دسترس نیست"); expect(dialog.querySelectorAll("time")).toHaveLength(1);
  expect(within(dialog).queryByText(/اقامت:/)).toBeNull();
});
it("requires meaningful rejection feedback, restores focus and blocks stale decisions", async () => {
  mocks.moderate.mockRejectedValue(new ApiRequestError("conflict", 409)); render(<AdminReviewRepliesPage />); fireEvent.click(await screen.findByRole("button", { name: "بررسی پاسخ" }));
  fireEvent.click(await screen.findByRole("button", { name: "رد پاسخ" })); const reason = screen.getByLabelText("دلیل رد پاسخ (الزامی)");
  await waitFor(() => expect(document.activeElement).toBe(reason)); expect((screen.getByRole("button", { name: "ثبت دلیل و رد پاسخ" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(reason, { target: { value: "اطلاعات شخصی را حذف کنید" } }); fireEvent.click(screen.getByRole("button", { name: "ثبت دلیل و رد پاسخ" }));
  await screen.findByRole("alert"); expect(mocks.moderate).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: "تأیید پاسخ" })).toBeNull();
});
