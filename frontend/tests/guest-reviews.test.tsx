import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/owner-api";

const mocks = vi.hoisted(() => ({
  eligible: vi.fn(), list: vi.fn(), get: vi.fn(), save: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() }, query: "",
  session: { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 1 } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session, resolveSessionDestination: () => "/owner" }));
vi.mock("@/lib/guest-reviews", async original => ({
  ...await original<typeof import("@/lib/guest-reviews")>(),
  getEligibleReviewStays: mocks.eligible, getGuestReviews: mocks.list, getGuestReview: mocks.get, saveGuestReview: mocks.save,
}));
import AccountPage from "@/app/account/page";
import { GuestReviewForm } from "@/components/reviews/GuestReviewForm";
import { GuestReviewsPage } from "@/components/reviews/GuestReviewsPage";
import { reviewCategories, type EligibleReviewStay, type GuestReview, type GuestReviewListItem } from "@/lib/guest-reviews";
import { metadata } from "@/app/account/reviews/page";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stay: EligibleReviewStay = { reservationId: 1, reservationNumber: "R-1", propertyId: 2, propertyName: "سرای آزمایش",
  checkOutDate: "2026-11-07", submissionDeadlineLocalDate: "2026-12-07", reviewId: null, revision: null };
const review: GuestReview = { id: 4, reservationId: 1, propertyId: 2, ratingSum: 45, overallRating: 7.5,
  cleanlinessRating: 8, staffRating: 7, comfortRating: 6, facilitiesRating: 5, locationRating: 9, valueRating: 10,
  comment: "تجربه اقامت", moderationStatus: "PendingApproval", isPublished: false, revision: 3 };
const item: GuestReviewListItem = { review, propertyName: stay.propertyName, reservationNumber: "R-1",
  checkInDate: "2026-11-05", checkOutDate: stay.checkOutDate, submissionDeadlineLocalDate: stay.submissionDeadlineLocalDate, canEdit: true };
const paged = <T,>(items: T[], page = 1, totalPages = 1) => ({ items, page, pageSize: 20, totalCount: items.length, totalPages });
const fill = (score = "8") => reviewCategories.forEach(([, label]) => fireEvent.click(within(screen.getByRole("radiogroup", { name: label })).getByRole("radio", { name: `${Number(score).toLocaleString("fa-IR")} از ۱۰` })));
const nextStep = () => fireEvent.click(screen.getByRole("button", { name: "ادامه" }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.query = "";
  mocks.session = { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 1 } };
  mocks.eligible.mockResolvedValue(paged([])); mocks.list.mockResolvedValue(paged([])); mocks.get.mockResolvedValue(review); mocks.save.mockResolvedValue(review);
});

it("shows safe rejection feedback and retains the existing resubmission entry", async () => {
  mocks.list.mockResolvedValue(paged([{ ...item, review: { ...review, moderationStatus: "Rejected", rejectionReason: "لطفاً اطلاعات تماس را حذف کنید." } }]));
  render(<GuestReviewsPage />);
  await screen.findByText("دلیل رد نظر: لطفاً اطلاعات تماس را حذف کنید.");
  expect(screen.getByRole("button", { name: "ویرایش و ارسال مجدد" })).toBeTruthy();
});

describe("account navigation", () => {
  it("keeps reviews independently reachable with no eligible reservation", async () => {
    render(<AccountPage />);
    expect(screen.getByRole("link", { name: "مشاهده نظرات من" }).getAttribute("href")).toBe("/account/reviews");
    expect(mocks.eligible).not.toHaveBeenCalled(); // Global shell owns the single invitation.
  });
});

describe("six-category form", () => {
  it.each(["create", "edit", "resubmit"])("enforces an explicit final-action boundary for %s, including Enter, Back and native submit events", async flow => {
    const edit = flow !== "create";
    mocks.get.mockResolvedValue({ ...review, moderationStatus: flow === "resubmit" ? "Rejected" : "PendingApproval" });
    const onSaved = vi.fn();
    render(<GuestReviewForm stay={{ ...stay, reviewId: edit ? 4 : null }} onClose={vi.fn()} onSaved={onSaved} />);
    const dialog = await screen.findByRole("dialog");
    const group = await within(dialog).findByRole("radiogroup", { name: "نظافت" });
    if (!edit) fill();
    fireEvent.click(within(group).getByRole("radio", { name: "۶ از ۱۰" }));
    fireEvent.keyDown(within(group).getByRole("radio", { checked: true }), { key: "Enter" });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(within(dialog).getByRole("heading", { name: "امتیازدهی" })).toBeTruthy(); expect(mocks.save).not.toHaveBeenCalled();
    const proceed = within(dialog).getByRole("button", { name: "ادامه" }) as HTMLButtonElement;
    fireEvent.click(proceed);
    expect(within(dialog).getByRole("heading", { name: "بررسی و ثبت" })).toBeTruthy(); expect(mocks.save).not.toHaveBeenCalled();
    // Even a native submit/requestSubmit without an explicit final click must be ignored in step 2.
    fireEvent.submit(dialog.querySelector("form")!); expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("تجربه شما (اختیاری)"), { target: { value: "متن مرحله دوم" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "بازگشت به امتیازها" }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect((within(screen.getByRole("radiogroup", { name: "نظافت" })).getByRole("radio", { checked: true }) as HTMLInputElement).value).toBe("6");
    nextStep(); expect(within(dialog).getByDisplayValue("متن مرحله دوم")).toBeTruthy();
    const final = within(dialog).getByRole("button", { name: edit ? "ذخیره و ارسال برای بررسی" : "ارسال نظر برای بررسی" });
    expect(final).not.toBe(proceed);
    within(dialog).getAllByRole("button").forEach(button => expect((button as HTMLButtonElement).type).toBe("button"));
    fireEvent.click(final); fireEvent.click(final);
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0]).toBe(stay.reservationId);
    expect(mocks.save.mock.calls[0][1]).toMatchObject({ cleanlinessRating: 6, comment: "متن مرحله دوم", ...(edit ? { revision: 3 } : {}) });
    expect(mocks.save.mock.calls[0][2]).toBe(edit);
  });
  it("does not promote the clicked Continue node into a native submit action during the step transition", async () => {
    render(<GuestReviewForm stay={stay} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = await screen.findByRole("dialog"); fill();
    const continueButton = screen.getByRole("button", { name: "ادامه" }) as HTMLButtonElement;
    fireEvent.click(continueButton);
    // Browser activation runs after the click/React commit; reproduce a pending native default action.
    if (continueButton.type === "submit" && continueButton.form) fireEvent.submit(continueButton.form);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("heading", { name: "بررسی و ثبت" })).toBeTruthy();
    expect(continueButton.type).toBe("button");
    expect(screen.getByRole("button", { name: "ارسال نظر برای بررسی" })).not.toBe(continueButton);
  });
  it.each(["close", "backdrop", "Escape"])("confirms unsaved changes on %s and preserves both steps when the confirmation is cancelled", async method => {
    const onClose = vi.fn(); render(<GuestReviewForm stay={stay} onClose={onClose} onSaved={vi.fn()} />);
    await screen.findByRole("dialog"); fill("6"); nextStep();
    fireEvent.change(screen.getByLabelText("تجربه شما (اختیاری)"), { target: { value: "تجربه ذخیره‌نشده" } });
    const requestClose = () => method === "Escape" ? fireEvent.keyDown(document, { key: "Escape" })
      : fireEvent.click(screen.getByRole("button", { name: method === "close" ? "بستن" : "بستن دیالوگ" }));
    requestClose(); expect(screen.getByRole("alert").textContent).toContain("تغییرات ذخیره‌نشده");
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "ادامه ویرایش" })));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByDisplayValue("تجربه ذخیره‌نشده")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به امتیازها" }));
    expect(screen.getAllByRole("radio", { checked: true }).map(node => (node as HTMLInputElement).value)).toEqual(Array(6).fill("6"));
    nextStep(); expect(screen.getByDisplayValue("تجربه ذخیره‌نشده")).toBeTruthy();
    requestClose(); fireEvent.click(screen.getByRole("button", { name: "صرف‌نظر از تغییرات" }));
    expect(onClose).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("closes clean create/edit forms normally and compares edits with the actual saved baseline", async () => {
    const onClose = vi.fn(); const view = render(<GuestReviewForm stay={stay} onClose={onClose} onSaved={vi.fn()} />);
    await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "بستن" }));
    expect(onClose).toHaveBeenCalledOnce(); view.unmount(); onClose.mockClear();
    render(<GuestReviewForm stay={{ ...stay, reviewId: 4 }} onClose={onClose} onSaved={vi.fn()} />);
    const group = await screen.findByRole("radiogroup", { name: "نظافت" });
    fireEvent.click(within(group).getByRole("radio", { name: "۹ از ۱۰" }));
    fireEvent.click(within(group).getByRole("radio", { name: "۸ از ۱۰" }));
    nextStep(); expect(screen.getByDisplayValue("تجربه اقامت")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "بستن" }));
    expect(onClose).toHaveBeenCalledOnce(); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("separates the discreet reservation link from the final action pair and confirms discarding", async () => {
    const onClose = vi.fn(); render(<GuestReviewForm stay={stay} onClose={onClose} onSaved={vi.fn()} />);
    await screen.findByRole("dialog"); fill(); nextStep();
    const submit = screen.getByRole("button", { name: "ارسال نظر برای بررسی" });
    const back = screen.getByRole("button", { name: "بازگشت به فهرست" });
    const reservation = screen.getByRole("link", { name: "مشاهده رزرو" });
    expect(submit.parentElement).toBe(back.parentElement);
    expect(reservation.parentElement).toBe(submit.parentElement?.parentElement);
    expect(reservation.parentElement).not.toBe(submit.parentElement);
    expect(submit.className).toContain("bg-primary"); expect(back.className).toContain("bg-background");
    expect(reservation.getAttribute("href")).toBe("/account/reservations/R-1");
    back.focus(); fireEvent.click(back); expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("تغییرات ذخیره‌نشده");
    fireEvent.click(screen.getByRole("button", { name: "صرف‌نظر از تغییرات" }));
    expect(onClose).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
    const css = readFileSync(resolve("components/reviews/GuestReviewForm.module.css"), "utf8");
    expect(css).toContain("@media (max-width: 480px)"); expect(css).toContain(".buttons > button { width: 100%; }");
    expect(css).toContain("color: var(--muted-foreground)"); expect(css).not.toContain(":global");
  });
  it("starts blank, gates continuation on all six scores and retains required validation", async () => {
    render(<GuestReviewForm stay={stay} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    expect(screen.getAllByRole("radiogroup")).toHaveLength(6);
    expect(screen.getAllByRole("radio")).toHaveLength(60);
    const fieldset = screen.getByRole("group", { name: "امتیازهای اقامت (همه الزامی)" });
    expect(fieldset.classList.contains("sm:grid-cols-2")).toBe(true);
    expect(fieldset.classList.contains("gap-y-3")).toBe(true);
    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
    expect((screen.getByRole("button", { name: "ادامه" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(dialog.querySelector("form")!);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.getAllByRole("radiogroup").every(node => node.getAttribute("aria-required") === "true")).toBe(true);
    expect(screen.getByRole("heading", { name: "امتیازدهی" })).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
    reviewCategories.slice(0, 5).forEach(([, label]) => fireEvent.click(within(screen.getByRole("radiogroup", { name: label })).getByRole("radio", { name: "۸ از ۱۰" })));
    expect((screen.getByRole("button", { name: "ادامه" }) as HTMLButtonElement).disabled).toBe(true);
    fill(); expect((screen.getByRole("button", { name: "ادامه" }) as HTMLButtonElement).disabled).toBe(false);
    nextStep(); expect(screen.getByRole("heading", { name: "بررسی و ثبت" })).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("calculates an exact mean and submits only six raw scores and an optional empty comment", async () => {
    const onSaved = vi.fn();
    render(<GuestReviewForm stay={stay} onClose={vi.fn()} onSaved={onSaved} />);
    await screen.findByRole("dialog");
    fill("1"); fireEvent.click(within(screen.getByRole("radiogroup", { name: reviewCategories[5][1] })).getByRole("radio", { name: "۲ از ۱۰" }));
    expect(screen.getByLabelText("میانگین امتیاز").textContent).toContain("۱٫۲");
    nextStep();
    expect(screen.getByText(/نوشتن توضیح همچنان اختیاری است/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ارسال نظر برای بررسی" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [id, body, edit] = mocks.save.mock.calls[0];
    expect(id).toBe(1); expect(edit).toBe(false);
    expect(body).toEqual({ cleanlinessRating: 1, staffRating: 1, comfortRating: 1, facilitiesRating: 1, locationRating: 1, valueRating: 2, comment: "" });
  });
  it("prefills only an existing review, preserves revision and uses edit/resubmission", async () => {
    render(<GuestReviewForm stay={{ ...stay, reviewId: 4, revision: 3 }} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole("radiogroup", { name: "نظافت" });
    expect(screen.getByRole("radiogroup", { name: "نظافت" }).getAttribute("aria-invalid")).toBeNull();
    reviewCategories.forEach(([key, label]) => {
      expect((within(screen.getByRole("radiogroup", { name: label })).getByRole("radio", { checked: true }) as HTMLInputElement).value).toBe(String(review[key]));
    });
    expect(screen.getByLabelText("میانگین امتیاز").textContent).toContain("۷٫۵");
    nextStep(); expect(screen.getByDisplayValue("تجربه اقامت")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ذخیره و ارسال برای بررسی" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][1]).toMatchObject({ revision: 3, cleanlinessRating: 8, comment: "تجربه اقامت" });
    expect(mocks.save.mock.calls[0][2]).toBe(true);
  });
  it("blocks duplicate submits while pending", async () => {
    let resolve!: (value: GuestReview) => void;
    mocks.save.mockReturnValue(new Promise<GuestReview>(done => { resolve = done; }));
    render(<GuestReviewForm stay={stay} onClose={vi.fn()} onSaved={vi.fn()} />); await screen.findByRole("dialog"); fill(); nextStep();
    const button = screen.getByRole("button", { name: "ارسال نظر برای بررسی" });
    fireEvent.click(button); fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "بازگشت به فهرست" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).toHaveBeenCalledOnce(); resolve(review);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
  it.each([
    [401, "", /نشست شما منقضی/], [403, "", /اجازه دسترسی/], [404, "", /در دسترس نیست/],
    [409, "ReviewAlreadyExists", /قبلاً نظر ثبت شده/], [409, "ReviewRevisionConflict", /پنجره دیگری/],
    [409, "ReviewNotEligible", /اکنون قابل ثبت/], [409, "ReviewNotEditable", /اکنون قابل ثبت/],
    [400, "", /اطلاعات پذیرفته نشد/], [500, "", /ارتباط با سرور/],
  ])("handles server error %s %s without losing choices", async (status, message, expected) => {
    mocks.save.mockRejectedValueOnce(new ApiRequestError(message, status));
    render(<GuestReviewForm stay={stay} onClose={vi.fn()} onSaved={vi.fn()} />); await screen.findByRole("dialog"); fill(); nextStep();
    fireEvent.change(screen.getByLabelText("تجربه شما (اختیاری)"), { target: { value: "متن حفظ‌شده" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال نظر برای بررسی" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(expected));
    expect(screen.getByDisplayValue("متن حفظ‌شده")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    if (status === 401) expect(screen.getByRole("link", { name: "ورود دوباره" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به امتیازها" }));
    expect((screen.getAllByRole("radio", { checked: true })[0] as HTMLInputElement).value).toBe("8");
    nextStep(); expect(screen.getByDisplayValue("متن حفظ‌شده")).toBeTruthy();
  });
  it("cannot save after existing-review retrieval fails", async () => {
    mocks.get.mockRejectedValueOnce(new ApiRequestError("", 404));
    render(<GuestReviewForm stay={{ ...stay, reviewId: 4 }} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "ادامه" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("private paginated review page", () => {
  it("opens from the correct reservation without navigation and uses the shared focus trap, scroll lock and focus restoration", async () => {
    mocks.eligible.mockResolvedValue(paged([stay])); render(<GuestReviewsPage />);
    const opener = await screen.findByRole("button", { name: /ثبت نظر برای سرای آزمایش/ });
    opener.focus(); fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: `ثبت نظر — ${stay.propertyName}` });
    expect(mocks.router.replace).not.toHaveBeenCalled(); expect(mocks.router.push).not.toHaveBeenCalled();
    expect(dialog.getAttribute("aria-modal")).toBe("true"); expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: "امتیازدهی" })));
    // jsdom has no layout; expose only this dialog's controls to the shared primitive's visibility filter.
    dialog.querySelectorAll<HTMLElement>("button, input, a[href]").forEach(node => Object.defineProperty(node, "offsetParent", { configurable: true, get: () => document.body }));
    const first = within(dialog).getByRole("button", { name: "بستن" });
    const last = within(dialog).getByRole("link", { name: "مشاهده رزرو" });
    last.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(document.activeElement).toBe(first);
    first.focus(); fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener)); expect(document.body.style.overflow).not.toBe("hidden");
  });
  it.each(["PendingApproval", "Rejected"] as const)("opens %s editing in the same prefilled wizard", async status => {
    mocks.list.mockResolvedValue(paged([{ ...item, review: { ...review, moderationStatus: status } }]));
    render(<GuestReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: status === "Rejected" ? "ویرایش و ارسال مجدد" : "ویرایش نظر" }));
    const dialog = await screen.findByRole("dialog", { name: `ویرایش نظر — ${stay.propertyName}` });
    const group = await within(dialog).findByRole("radiogroup", { name: "نظافت" });
    expect((within(group).getByRole("radio", { checked: true }) as HTMLInputElement).value).toBe("8");
    expect(mocks.get).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    nextStep(); expect(within(dialog).getByDisplayValue("تجربه اقامت")).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reuses real blue category meters with a quality badge, stay context and a distinct guest comment", async () => {
    mocks.list.mockResolvedValue(paged([item])); render(<GuestReviewsPage />);
    const card = await screen.findByRole("article", { name: stay.propertyName });
    expect(within(card).getByRole("heading", { name: stay.propertyName })).toBeTruthy();
    expect(card.querySelector('time[datetime="2026-11-05"]')).toBeTruthy();
    expect(card.querySelector('time[datetime="2026-11-07"]')).toBeTruthy();
    expect(within(card).getByText("خوب")).toBeTruthy(); expect(card.querySelector('[data-quality="good"]')).toBeTruthy();
    expect(within(card).getByText("۷٫۵")).toBeTruthy();
    const meters = within(card).getAllByRole("meter"); expect(meters).toHaveLength(6);
    reviewCategories.forEach(([key, label]) => expect(within(card).getByRole("meter", { name: label }).getAttribute("aria-valuenow")).toBe(String(review[key])));
    expect(within(card).getByText("متن نظر").parentElement).toBe(within(card).getByText(review.comment).parentElement);
    expect(within(card).getByText("در انتظار تأیید")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "ویرایش نظر" })).toBeTruthy();
    expect(within(card).getByRole("link", { name: "مشاهده رزرو" }).getAttribute("href")).toBe("/account/reservations/R-1");
    const css = readFileSync(resolve("components/reviews/GuestReviewsPage.module.css"), "utf8");
    expect(css).toContain("grid-template-columns: minmax(0, 8rem) minmax(0, 1fr)");
    expect(css).toContain("background: var(--score-ink); color: var(--card)");
  });
  it("keeps rating-only and approved-unpublished reviews honest without missing-metadata placeholders", async () => {
    mocks.list.mockResolvedValue(paged([{ ...item, reservationNumber: null, checkInDate: "", checkOutDate: "", canEdit: false,
      review: { ...review, comment: "", moderationStatus: "Approved", isPublished: false } }]));
    render(<GuestReviewsPage />);
    const card = await screen.findByRole("article", { name: stay.propertyName });
    expect(within(card).getByText("بدون توضیح")).toBeTruthy();
    expect(within(card).getByText("تأییدشده؛ هنوز منتشر نشده")).toBeTruthy();
    expect(within(card).queryByText("منتشرشده")).toBeNull();
    expect(within(card).queryByRole("link", { name: "مشاهده رزرو" })).toBeNull();
    expect(within(card).queryByRole("button")).toBeNull(); expect(card.querySelector("time")).toBeNull();
    expect(within(card).getByText("این نظر اکنون قابل ویرایش نیست.")).toBeTruthy();
  });
  it("preserves the exact page-header card and keeps compact refresh beside the eligible heading", async () => {
    const reference = render(<KoochPageHeader eyebrow="محیط مهمان" title="نظرات من" description="اقامت‌های قابل ارزیابی و وضعیت نظرهای ارسال‌شده خود را ببینید." />);
    const expectedHeader = reference.container.querySelector("header")!.outerHTML; reference.unmount();
    render(<GuestReviewsPage />);
    const header = screen.getByRole("heading", { level: 1, name: "نظرات من" }).closest("header")!;
    expect(header.outerHTML).toBe(expectedHeader);
    expect(header.parentElement?.firstElementChild).toBe(header);
    expect(header.parentElement?.className).toBe("mx-auto grid max-w-5xl gap-6");
    const eligible = screen.getByRole("heading", { name: "اقامت‌های قابل ثبت نظر" });
    const refresh = screen.getByRole("button", { name: "دریافت دوباره فهرست" });
    expect(refresh.parentElement).toBe(eligible.parentElement); expect(refresh.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: "بازگشت به حساب کاربری" }).getAttribute("href")).toBe("/account");
    await screen.findByText(/اکنون اقامت واجد شرایطی/);
  });
  it("keeps separate real reservations for the same property and uses primary-blue review actions", async () => {
    mocks.eligible.mockResolvedValue(paged([{ ...stay, invitationPreferenceAvailable: true },
      { ...stay, reservationId: 2, reservationNumber: "R-2", checkOutDate: "2026-11-06", invitationPreferenceAvailable: true }]));
    render(<GuestReviewsPage />);
    const list = await screen.findByRole("list", { name: "اقامت‌های قابل ثبت نظر" });
    const rows = within(list).getAllByRole("listitem"); expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("R-1")).toBeTruthy(); expect(within(rows[1]).getByText("R-2")).toBeTruthy();
    expect(rows[0].querySelector('time[datetime="2026-11-07"]')).toBeTruthy();
    expect(rows[1].querySelector('time[datetime="2026-11-06"]')).toBeTruthy();
    const action = within(rows[1]).getByRole("button", { name: /ثبت نظر برای سرای آزمایش، رزرو R-2/ });
    expect(action.className).toContain("bg-primary");
    expect(screen.queryByRole("button", { name: /دیگر برای این اقامت/ })).toBeNull();
    fireEvent.click(action);
    await screen.findByRole("dialog", { name: `ثبت نظر — ${stay.propertyName}` });
    expect(screen.getByRole("link", { name: "مشاهده رزرو" }).getAttribute("href")).toBe("/account/reservations/R-2");
  });
  it("does not invent reservation numbers or check-in dates or show opt-out setup copy", async () => {
    mocks.eligible.mockResolvedValue(paged([{ ...stay, reservationNumber: null, invitationPreferenceAvailable: false }]));
    render(<GuestReviewsPage />);
    const list = await screen.findByRole("list", { name: "اقامت‌های قابل ثبت نظر" });
    expect(list.textContent).not.toMatch(/رزرو:|ورود:/);
    expect(list.querySelector("time")?.getAttribute("datetime")).toBe(stay.checkOutDate);
    expect(screen.queryByText(/دیگر برای این اقامت نمایش نده|تنظیم یادآوری دائمی/)).toBeNull();
  });
  it("keeps the submitted empty state compact without an empty list or unrelated styling", async () => {
    render(<GuestReviewsPage />);
    const section = screen.getByRole("region", { name: "نظرهای ارسال‌شده" });
    await within(section).findByText("هنوز نظری برای اقامت‌های تأییدشده ثبت نکرده‌اید.");
    expect(section.classList.contains("p-3")).toBe(true); expect(within(section).queryByRole("list")).toBeNull();
    const css = readFileSync(resolve("components/reviews/GuestReviewsPage.module.css"), "utf8");
    expect(css).toContain(".content { display: grid; gap: 0.75rem;");
    expect(css).toContain("@media (max-width: 480px)"); expect(css).toContain("flex-direction: column");
    expect(css).toContain("@media (pointer: coarse)"); expect(css).toContain("overflow-wrap: anywhere");
    expect(css).not.toContain(":global");
  });
  it("opens the invited form on a later eligibility page without trusting a URL as permission", async () => {
    mocks.query = "reservationId=1&eligiblePage=3";
    mocks.eligible.mockResolvedValue(paged([stay], 3, 3));
    render(<GuestReviewsPage />);
    await screen.findByRole("heading", { name: `ثبت نظر — ${stay.propertyName}` });
    expect(mocks.eligible).toHaveBeenCalledWith(3, expect.any(AbortSignal));
  });
  it("renders real pending, rejected and approved states and honors canEdit instead of dates", async () => {
    mocks.list.mockResolvedValue(paged([item,
      { ...item, review: { ...review, id: 5, moderationStatus: "Rejected" } },
      { ...item, canEdit: false, review: { ...review, id: 6, moderationStatus: "Approved", isPublished: true } },
      { ...item, canEdit: false, review: { ...review, id: 7, moderationStatus: "PendingApproval" } },
    ]));
    render(<GuestReviewsPage />);
    expect(await screen.findByText("منتشرشده")).toBeTruthy();
    expect(screen.getByText("ردشده")).toBeTruthy();
    expect(screen.getAllByText("در انتظار تأیید")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "ویرایش نظر" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "ویرایش و ارسال مجدد" })).toBeTruthy();
    expect(screen.getAllByText("این نظر اکنون قابل ویرایش نیست.")).toHaveLength(2);
    expect(screen.getByRole("main").getAttribute("dir")).toBe("rtl");
    expect(metadata?.robots).toEqual({ index: false, follow: false });
  });
  it("loads a requested reservation only if the backend eligibility page contains it", async () => {
    mocks.query = "reservationId=999";
    mocks.eligible.mockResolvedValue(paged([stay])); render(<GuestReviewsPage />);
    expect(await screen.findByText(/اقامت انتخاب‌شده در فهرست مجاز/)).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("opens the invited stay in a modal, submits, refreshes both lists and announces pending status", async () => {
    mocks.query = "reservationId=1"; mocks.eligible.mockResolvedValue(paged([stay]));
    render(<GuestReviewsPage />);
    await screen.findByRole("heading", { name: `ثبت نظر — ${stay.propertyName}` }); fill();
    expect(screen.getByRole("main").querySelector('[role="dialog"]')).toBeNull();
    nextStep();
    fireEvent.click(screen.getByRole("button", { name: "ارسال نظر برای بررسی" }));
    expect(await screen.findByText(/نظر شما ثبت شد و در انتظار تأیید است/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(mocks.eligible).toHaveBeenCalledTimes(2));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.router.replace).toHaveBeenCalledWith("/account/reviews", { scroll: false });
  });
  it("paginates lists independently and provides empty/error and retry states", async () => {
    mocks.list.mockResolvedValue(paged([item], 1, 2));
    render(<GuestReviewsPage />);
    const pages = await screen.findByRole("navigation", { name: "صفحه‌بندی نظرهای ارسال‌شده" });
    fireEvent.click(within(pages).getByRole("button", { name: "صفحه بعد" }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(2, expect.any(AbortSignal)));
    expect(mocks.eligible).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/اکنون اقامت واجد شرایطی/)).toBeTruthy();
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "دریافت دوباره فهرست" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("ارتباط با سرور"));
  });
  it("redirects anonymous guests without fetching private data", async () => {
    mocks.session.authenticated = false; render(<GuestReviewsPage />);
    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/login?returnTo=%2Faccount%2Freviews"));
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.eligible).not.toHaveBeenCalled();
  });
  it("does not fetch as a non-account workspace and removes private data on logout", async () => {
    mocks.session.workspaces = ["owner"];
    const view = render(<GuestReviewsPage />);
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.session.workspaces = ["account"]; mocks.list.mockResolvedValue(paged([item]));
    view.rerender(<GuestReviewsPage />); await screen.findByText("تجربه اقامت");
    mocks.session.authenticated = false; view.rerender(<GuestReviewsPage />);
    expect(screen.queryByText("تجربه اقامت")).toBeNull();
  });
});
