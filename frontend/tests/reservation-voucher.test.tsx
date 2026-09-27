import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GuestVoucherView } from "@/components/reservations/vouchers/GuestVoucherView";
import { OwnerVoucherView } from "@/components/reservations/vouchers/OwnerVoucherView";
import { AdminVoucherView } from "@/components/reservations/vouchers/AdminVoucherView";
import { ApiRequestError, apiRequest } from "@/lib/owner-api";
import type { OwnerVoucher } from "@/lib/owner-voucher";

vi.mock("@/lib/owner-api", async (original) => ({
  ...await original<typeof import("@/lib/owner-api")>(), apiRequest: vi.fn(),
}));

vi.mock("@/lib/site-settings", async (original) => ({
  ...await original<typeof import("@/lib/site-settings")>(),
  fetchPublicSiteSettings: vi.fn().mockResolvedValue({ "site.logoUrl": "" }),
}));

const request = vi.mocked(apiRequest);
const voucher: OwnerVoucher = {
  voucherNumber: "V-583214", reservationNumber: "R-271946",
  issuedAtUtc: "2026-09-20T09:30:00Z", propertyName: "خانه کاشان", guestName: "مریم احمدی",
  roomTypeName: "اتاق دو نفره", roomName: "بهار", checkIn: "2026-09-25", checkOut: "2026-09-28",
  nights: 3, adultCount: 2, childCount: 1, currency: "IRR", grossAmount: 1000000,
  // Intentionally not recomputable: the UI must present persisted values verbatim.
  commissionRate: 12.5, commissionAmount: 123456, propertyPayableAmount: 876543,
};
const money = (amount: number) => `${new Intl.NumberFormat("fa-IR").format(amount)} ریال`;
const doc = () => screen.getByRole("article", { name: "سند ووچر رزرو" });

beforeEach(() => { request.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("read-only reservation vouchers", () => {
  it.each(["owner", "admin"])("shows the full API phone in the %s financial document", async (mode) => {
    request.mockResolvedValue({ ...voucher, guestMobile: "09123456789" });
    render(mode === "owner" ? <OwnerVoucherView propertyId={7} reservationId={23} />
      : <AdminVoucherView reservationId={23} />);
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    expect(within(doc()).getByText("شماره تماس")).toBeTruthy();
    expect(within(doc()).getByText("09123456789").getAttribute("dir")).toBe("ltr");
  });

  it("keeps the Guest document unchanged even if extra phone data is supplied", async () => {
    request.mockResolvedValue({ ...voucher, guestMobile: "09123456789" });
    render(<GuestVoucherView reservationNumber="R-271946" />);
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    expect(within(doc()).queryByText("شماره تماس")).toBeNull();
    expect(within(doc()).queryByText("09123456789")).toBeNull();
  });
  it.each(["guest", "owner", "admin"])("renders the approved %s layout without repeated rooms, fake phone or QR", async (mode) => {
    request.mockResolvedValue(voucher);
    render(mode === "guest" ? <GuestVoucherView reservationNumber="R-271946" />
      : mode === "owner" ? <OwnerVoucherView propertyId={7} reservationId={23} />
      : <AdminVoucherView reservationId={23} />);
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    const view = within(doc());
    expect(view.getByText("رزرو قطعی")).toBeTruthy();
    expect(view.getAllByText(voucher.roomTypeName)).toHaveLength(1);
    expect(view.getAllByText(voucher.roomName!)).toHaveLength(1);
    expect(view.queryByText(/شماره تماس|0912|xxx|QR|شناسه کنترل/)).toBeNull();
    const codes = doc().querySelectorAll("bdi");
    expect(codes).toHaveLength(4);
    for (const code of codes) expect(code.getAttribute("dir")).toBe("ltr");
    if (mode === "guest") {
      expect(view.getByText(`${voucher.guestName} عزیز، رزرو شما در ${voucher.propertyName} با موفقیت قطعی شد. در زمان مراجعه به اقامتگاه، این ووچر را در دسترس داشته باشید.`)).toBeTruthy();
      expect(view.getByText("این ووچر تأییدکننده رزرو قطعی شماست؛ تاریخ ورود، خروج و مشخصات اتاق را پیش از مراجعه بررسی کنید.")).toBeTruthy();
      expect(view.getByText("در صورت تغییر یا لغو رزرو، وضعیت جدید رزرو در حساب کاربری شما ملاک خواهد بود.")).toBeTruthy();
      expect(view.getAllByText("مبلغ پرداخت‌شده")).toHaveLength(1);
      expect(doc().textContent).not.toContain("کمیسیون");
    } else {
      expect(view.getByText("رزرو زیر پس از تأیید دریافت وجه قطعی شده است. لطفاً پذیرش مهمان را مطابق اطلاعات و بازه اقامت درج‌شده انجام دهید.")).toBeTruthy();
      expect(view.getByText("مبلغ قابل تسویه، بیانگر سهم اقامتگاه از این رزرو است و به معنی انجام یا تأیید انتقال بانکی نیست.")).toBeTruthy();
      expect(view.getByText("مبلغ قابل تسویه به اقامتگاه")).toBeTruthy();
    }
  });

  it("fetches the Admin endpoint and reuses the financial document and print behavior", async () => {
    request.mockResolvedValue(voucher);
    render(<AdminVoucherView reservationId={23} />);
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    expect(request).toHaveBeenCalledWith("/admin/reservations/23/voucher", { signal: expect.any(AbortSignal) });
    for (const amount of [voucher.grossAmount, voucher.commissionAmount, voucher.propertyPayableAmount]) {
      expect(within(doc()).getByText(money(amount))).toBeTruthy();
    }
    expect(within(doc()).getByText("مبلغ قابل تسویه به اقامتگاه")).toBeTruthy();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "چاپ ووچر" }));
    expect(print).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fetches the Guest projection and displays identity, stay and gross only, including in print", async () => {
    request.mockResolvedValue(voucher);
    render(<GuestVoucherView reservationNumber="R-271946" />);
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    expect(request).toHaveBeenCalledWith("/account/reservations/R-271946/voucher", { signal: expect.any(AbortSignal) });
    for (const text of [voucher.voucherNumber, voucher.reservationNumber, voucher.propertyName, voucher.guestName, voucher.roomTypeName, voucher.roomName!, money(voucher.grossAmount)]) {
      const scope = text === voucher.voucherNumber || text === voucher.reservationNumber
        ? within(doc().querySelector("header")!) : within(doc());
      expect(scope.getByText(text)).toBeTruthy();
    }
    for (const label of ["تاریخ ورود", "تاریخ خروج", "تعداد شب", "بزرگسال", "کودک", "مبلغ پرداخت‌شده"]) {
      expect(within(doc()).getByText(label)).toBeTruthy();
    }
    expect((document.body).textContent).not.toContain("کمیسیون");
    expect((document.body).textContent).not.toContain("قابل تسویه");
    expect((document.body).textContent).not.toContain("۱۲٫۵٪");
    expect((document.body).textContent).not.toContain(money(voucher.commissionAmount));
    expect((document.body).textContent).not.toContain(money(voucher.propertyPayableAmount));
    expect((document.body).textContent).not.toContain("تومان");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "چاپ ووچر" }));
    expect(print).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.querySelector("[data-voucher-print]")).not.toBeNull());
    const printCopy = document.querySelector("[data-voucher-print]")!;
    expect((printCopy).textContent).toContain(money(voucher.grossAmount));
    expect(printCopy.querySelector("button")).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fetches Owner projection and renders snapshot finance without calculation or paid-settlement wording", async () => {
    request.mockResolvedValue(voucher);
    render(<OwnerVoucherView propertyId={7} reservationId={23} />);
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    expect(request).toHaveBeenCalledWith("/owner/properties/7/reservations/23/voucher", { signal: expect.any(AbortSignal) });
    const view = within(doc());
    expect(view.getByText(voucher.roomTypeName)).toBeTruthy();
    for (const amount of [voucher.grossAmount, voucher.commissionAmount, voucher.propertyPayableAmount]) expect(view.getByText(money(amount))).toBeTruthy();
    expect(view.getByText("۱۲٫۵٪")).toBeTruthy();
    expect(view.getByText("مبلغ قابل تسویه به اقامتگاه")).toBeTruthy();
    expect(view.getByText("مبلغ پرداخت‌شده مهمان")).toBeTruthy();
    expect((doc()).textContent).not.toContain("تسویه‌شده");
    expect((doc()).textContent).not.toContain("پرداخت‌شده به اقامتگاه");
    expect(screen.getByRole("button", { name: "چاپ ووچر" })).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["guest", "owner"])("handles %s 404 without creating a voucher or print action", async (mode) => {
    request.mockRejectedValue(new ApiRequestError("missing", 404));
    render(mode === "guest" ? <GuestVoucherView reservationNumber="R-271946" /> : <OwnerVoucherView propertyId={7} reservationId={23} />);
    expect(await screen.findByText("برای این رزرو هنوز ووچری صادر نشده است.")).toBeTruthy();
    expect(screen.queryByRole("article")).not.toBeTruthy();
    expect(screen.queryByRole("button", { name: "چاپ ووچر" })).not.toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["guest", "owner"])("shows %s loading and ignores responses after unmount", async (mode) => {
    let finish!: (data: OwnerVoucher) => void;
    request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = render(mode === "guest" ? <GuestVoucherView reservationNumber="R-271946" /> : <OwnerVoucherView propertyId={7} reservationId={23} />);
    expect((screen.getByRole("status")).textContent).toContain("در حال دریافت ووچر");
    const signal = request.mock.calls[0][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(voucher));
    expect(document.querySelector("[data-voucher-print]")).toBeNull();
  });

  it.each(["guest", "owner"])("offers a read-only %s retry on failure", async (mode) => {
    request.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(voucher);
    render(mode === "guest" ? <GuestVoucherView reservationNumber="R-271946" /> : <OwnerVoucherView propertyId={7} reservationId={23} />);
    expect((await screen.findByRole("alert")).textContent).toContain("دریافت ووچر انجام نشد");
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [, init] of request.mock.calls) expect(init?.method ?? "GET").toBe("GET");
  });

  it("does not display a document for forbidden actors", async () => {
    request.mockRejectedValue(new ApiRequestError("forbidden", 403));
    render(<OwnerVoucherView propertyId={7} reservationId={23} />);
    expect((await screen.findByRole("alert")).textContent).toContain("شما اجازه مشاهده این ووچر را ندارید.");
    expect(screen.queryByRole("article")).not.toBeTruthy();
  });

  it("preserves other stored currencies without site-currency fallback", async () => {
    request.mockResolvedValue({ ...voucher, currency: "EUR", roomName: null });
    render(<GuestVoucherView reservationNumber="R-271946" />);
    await screen.findByRole("article", { name: "سند ووچر رزرو" });
    expect((doc()).textContent).toContain("۱٬۰۰۰٬۰۰۰ EUR");
    expect(within(doc()).queryByText("اتاق", { exact: true })).toBeNull();
  });

  it("defines scoped A4 print output without application chrome", () => {
    const css = readFileSync("components/reservations/vouchers/VoucherDocument.module.css", "utf8");
    expect(css).toContain("@media print");
    expect(css).toContain("size: A4");
    expect(css).toContain(":global(body):has(> .printCopy) > :not(.printCopy)");
    expect(css).toContain("break-inside: avoid");
  });
});
