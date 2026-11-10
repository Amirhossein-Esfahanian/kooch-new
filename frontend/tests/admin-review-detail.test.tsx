import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AdminReviewDetail } from "@/components/reviews/AdminReviewDetail";
import type { AdminReview } from "@/lib/admin-reviews";
import styles from "@/components/reviews/AdminReviewsPage.module.css";

const item: AdminReview = {
  propertyName: "سرای آزمایش", guestDisplayName: "مهمان", reservationNumber: "R-1",
  checkInDate: "2026-11-01", checkOutDate: "2026-11-03", submittedAtUtc: "2026-11-08T10:00:00Z",
  moderatedAtUtc: "2026-11-09T10:00:00Z", moderatedByUserId: 3, ownerReply: null,
  review: { id: 1, reservationId: 37, propertyId: 2, cleanlinessRating: 1, staffRating: 2,
    comfortRating: 3, facilitiesRating: 4, locationRating: 5, valueRating: 6, ratingSum: 21,
    overallRating: 3.5, comment: "", moderationStatus: "Approved", isPublished: true, revision: 2 },
};

it("groups identity and a compact score badge, with both date values on one responsive row", () => {
  render(<div dir="rtl"><AdminReviewDetail item={item} status="منتشرشده" /></div>);
  const context = screen.getByRole("region", { name: "اطلاعات مهمان و اقامت" });
  expect(within(context).getByText("مهمان")).toBeTruthy(); expect(context.textContent).toContain("رزرو R-1");
  const score = within(context).getByRole("group", { name: "امتیاز کلی" }); expect(within(score).getByText("۳٫۵")).toBeTruthy();
  const date = document.querySelector(`.${styles.detailMeta}`)!;
  expect(date.children).toHaveLength(2); expect(date.textContent).toContain("اقامت:"); expect(date.textContent).toContain("ارسال:");
  expect(date.querySelector("time")?.getAttribute("datetime")).toBe(item.submittedAtUtc);
});

it("preserves six accessible numeric scores and compact bars without changing values", () => {
  render(<AdminReviewDetail item={item} status="منتشرشده" />);
  const meters = screen.getAllByRole("meter"); expect(meters).toHaveLength(6);
  meters.forEach((meter, index) => {
    expect(meter.getAttribute("aria-label")).toBeTruthy(); expect(meter.getAttribute("aria-valuenow")).toBe(String(index + 1));
    expect(meter.getAttribute("aria-valuemax")).toBe("10"); expect(meter.getAttribute("aria-valuetext")).toContain("از ۱۰");
    expect((meter.firstElementChild as HTMLElement).style.width).toBe(`${(index + 1) * 10}%`);
  });
});

it("uses one compact empty-comment row but retains multiline guest text verbatim", () => {
  const view = render(<AdminReviewDetail item={item} status="منتشرشده" />);
  const comment = screen.getByRole("region", { name: "متن نظر مهمان" });
  expect(comment.textContent).toBe("متن نظر: بدون توضیح"); expect(comment.children).toHaveLength(1);
  const text = "نظر واقعی مهمان\nبا جزئیات اقامت";
  view.rerender(<AdminReviewDetail item={{ ...item, review: { ...item.review, comment: text } }} status="منتشرشده" />);
  expect(screen.getByText(text, { normalizer: value => value }).textContent).toBe(text);
  expect(screen.queryByText("بدون توضیح")).toBeNull();
});

it.each(["منتشرشده", "لغو انتشارشده", "ردشده"])("shows %s once with decision metadata in the same row", status => {
  render(<AdminReviewDetail item={item} status={status} />);
  const section = screen.getByRole("region", { name: "وضعیت و آخرین تصمیم" });
  const row = section.querySelector(`.${styles.decisionRow}`)!;
  expect(row.children).toHaveLength(2); expect(row.children[0].textContent).toBe(`${status} · نسخه ۲`);
  expect(row.children[1].textContent).toContain("تصمیم:"); expect(row.children[1].textContent).toContain("مدیر ۳");
  expect(section.textContent?.split(status).length).toBe(2);
});

it("retains approved public text and the actual private reply revision and rejection reason", () => {
  render(<AdminReviewDetail item={{ ...item, ownerReply: { id: 4, reviewId: 1, revision: 4,
    moderationStatus: "Rejected", body: "پاسخ اصلاح‌شده", publishedBody: "پاسخ عمومی قبلی",
    publishedAtUtc: item.moderatedAtUtc, rejectionReason: "دلیل رد واقعی" } }} status="منتشرشده" />);
  const reply = screen.getByRole("region", { name: "پاسخ اقامتگاه" });
  for (const text of ["پاسخ عمومی قبلی", "پاسخ اصلاح‌شده", "نسخهٔ ارسال‌شده (غیرعمومی)", "وضعیت نسخهٔ پاسخ: ردشده", "دلیل رد پاسخ: دلیل رد واقعی"])
    expect(within(reply).getByText(text)).toBeTruthy();
});

it("uses content-driven desktop height while keeping mobile scrolling/footer and rating fallback styles", () => {
  const css = readFileSync(resolve("components/reviews/AdminReviewsPage.module.css"), "utf8");
  expect(css).toContain(".dialog.dialog { height: auto;"); expect(css).toContain("max-height: min(760px, 90dvh)");
  expect(css).toContain(".detailLayout { display: grid; gap: 0.625rem");
  expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto");
  expect(css).toContain("repeat(2, minmax(0, 1fr))"); expect(css).toContain("@media (max-width: 380px)");
  expect(css).toContain(".decisionRow { flex-direction: column; }"); expect(css).toContain("100dvh - 2rem");
  expect(css).toContain("min-height: 2.75rem"); expect(css).not.toContain(":global");
});
