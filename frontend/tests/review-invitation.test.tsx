import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
const mocks = vi.hoisted(() => ({
  eligible: vi.fn(), suppress: vi.fn(), path: "/",
  session: { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 100 } },
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("@/lib/guest-reviews", async original => ({
  ...await original<typeof import("@/lib/guest-reviews")>(),
  getAllReviewInvitationStays: mocks.eligible, suppressReviewInvitation: mocks.suppress,
}));
import { GuestReviewInvitation, reviewInvitationsAllowed } from "@/components/reviews/GuestReviewInvitation";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReviewInvitationOptOut } from "@/components/reviews/ReviewInvitationOptOut";
import { guestReviewsChangedEvent, type EligibleReviewStay } from "@/lib/guest-reviews";

const stay: EligibleReviewStay = { reservationId: 1, reservationNumber: "R-1", propertyId: 2, propertyName: "سرای اول",
  checkOutDate: "2026-11-07", submissionDeadlineLocalDate: "2026-12-07", reviewId: null, revision: null,
  invitationSuppressed: false, invitationPreferenceAvailable: true };
let user = 100;
beforeEach(() => {
  vi.clearAllMocks(); toast.dismiss();
  mocks.path = "/";
  mocks.session = { authenticated: true, loading: false, workspaces: ["account"], user: { userId: ++user } };
  mocks.eligible.mockResolvedValue([]);
  mocks.suppress.mockImplementation(async id => ({ reservationId: id, invitationSuppressed: true }));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("single site-wide Sonner review invitation", () => {
  it.each(["/account/reviews", "/account/reviews/", "/account/reviews?reservationId=1&eligiblePage=3", "/account/reviews/new", "/account/reviews/new?reservationId=1", "/book/stay", "/booking/sessions/code/success"])("does not render or fetch on excluded route %s", path => {
    mocks.path = path; mocks.eligible.mockResolvedValue([stay]);
    render(<GuestReviewInvitation />);
    expect(reviewInvitationsAllowed(path)).toBe(false);
    expect(mocks.eligible).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "اقامتت چطور بود؟" })).toBeNull();
    expect(document.querySelector('[data-sonner-toaster]')).toBeNull();
  });
  it("hides an existing toast immediately on the review form without dismissing the browser session", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    await screen.findByRole("heading", { name: "اقامتت چطور بود؟" });
    mocks.path = "/account/reviews?reservationId=1"; view.rerender(<GuestReviewInvitation />);
    expect(screen.queryByRole("heading", { name: "اقامتت چطور بود؟" })).toBeNull();
    mocks.path = "/properties/stay"; view.rerender(<GuestReviewInvitation />);
    await screen.findByRole("heading", { name: "اقامتت چطور بود؟" });
    expect(mocks.eligible).toHaveBeenCalledTimes(2); expect(mocks.suppress).not.toHaveBeenCalled();
    expect(reviewInvitationsAllowed("/account/reviews-archive")).toBe(true);
  });
  it("uses the close button for the same session-only dismissal as not now", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    const close = await screen.findByRole("button", { name: "بستن دعوت‌نامه نظر برای این نشست" });
    close.focus(); expect(document.activeElement).toBe(close); fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "اقامتت چطور بود؟" })).toBeNull());
    view.unmount(); render(<GuestReviewInvitation />);
    expect(mocks.eligible).toHaveBeenCalledOnce(); expect(mocks.suppress).not.toHaveBeenCalled();
  });
  it("permanently suppresses only the current stay without dismissing future invitations", async () => {
    mocks.eligible.mockResolvedValue([stay]); render(<GuestReviewInvitation />);
    fireEvent.click(await screen.findByRole("button", { name: /دیگر برای این اقامت نمایش نده: سرای اول/ }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "اقامتت چطور بود؟" })).toBeNull());
    expect(mocks.suppress).toHaveBeenCalledExactlyOnceWith(1, expect.any(AbortSignal));
    mocks.eligible.mockResolvedValue([{ ...stay, reservationId: 99, propertyName: "اقامت آینده" }]);
    fireEvent(window, new Event(guestReviewsChangedEvent));
    await screen.findByText("اقامت آینده");
    expect(screen.getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toContain("reservationId=99");
    expect(mocks.suppress).toHaveBeenCalledOnce();
  });
  it.each(["anonymous", "loading"])("does not fetch or display for %s auth", async mode => {
    mocks.session.authenticated = mode !== "anonymous"; mocks.session.loading = mode === "loading";
    render(<GuestReviewInvitation />);
    expect(mocks.eligible).not.toHaveBeenCalled(); expect(screen.queryByText("اقامتت چطور بود؟")).toBeNull();
  });
  it("silently handles empty or unavailable APIs", async () => {
    mocks.eligible.mockRejectedValueOnce(new Error("offline")); render(<GuestReviewInvitation />);
    await waitFor(() => expect(mocks.eligible).toHaveBeenCalledOnce());
    expect(screen.queryByText("اقامتت چطور بود؟")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("has a persistent top-right RTL toast, later-page form link and shared header offsets", async () => {
    mocks.eligible.mockResolvedValue([{ ...stay, invitationPage: 3 }]); render(<GuestReviewInvitation />);
    const title = await screen.findByText("اقامتت چطور بود؟");
    expect(title.closest("section")?.getAttribute("dir")).toBe("rtl");
    expect(screen.getByText("سرای اول").closest("p")?.textContent).toBe("تجربه‌ات در سرای اول رو با بقیه به اشتراک بذار.");
    expect(screen.getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toBe("/account/reviews?reservationId=1&eligiblePage=3");
    const active = toast.getToasts().find(t => t.id === `guest-review-invitation-${user}`);
    expect(active && "duration" in active ? active.duration : undefined).toBe(Infinity);
    expect(active && "dismissible" in active ? active.dismissible : undefined).toBe(false);
    const toaster = document.querySelector('[data-sonner-toaster]')!;
    expect(toaster.getAttribute("data-x-position")).toBe("right"); expect(toaster.getAttribute("data-y-position")).toBe("top");
    expect(toaster.getAttribute("style")).toContain("--offset-top: var(--review-invitation-top)");
    expect(toaster.getAttribute("style")).toContain("--mobile-offset-top: var(--review-invitation-top)");
    expect(toaster.getAttribute("style")).toContain("--mobile-offset-right: var(--review-invitation-right)");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps one toast across route navigation without fetching on every route", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    await screen.findByText("اقامتت چطور بود؟"); mocks.path = "/properties/stay";
    view.rerender(<GuestReviewInvitation />);
    expect(screen.getAllByText("اقامتت چطور بود؟")).toHaveLength(1); expect(mocks.eligible).toHaveBeenCalledOnce();
  });
  it("persists temporary dismissal across remount and login within this browser session", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    fireEvent.click(await screen.findByRole("button", { name: "فعلاً نه" }));
    await waitFor(() => expect(screen.queryByText("اقامتت چطور بود؟")).toBeNull());
    view.unmount(); render(<GuestReviewInvitation />);
    expect(mocks.eligible).toHaveBeenCalledOnce(); expect(mocks.suppress).not.toHaveBeenCalled();
  });
  it("does not leak dismissed state or content between accounts and clears on logout", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    fireEvent.click(await screen.findByRole("button", { name: "فعلاً نه" }));
    mocks.session = { ...mocks.session, user: { userId: ++user } }; view.rerender(<GuestReviewInvitation />);
    await screen.findByText("اقامتت چطور بود؟"); expect(mocks.eligible).toHaveBeenCalledTimes(2);
    mocks.session = { ...mocks.session, authenticated: false }; view.rerender(<GuestReviewInvitation />);
    expect(screen.queryByText("اقامتت چطور بود؟")).toBeNull();
  });
  it("hides on Direct routes and refreshes after a review event", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    await screen.findByText("اقامتت چطور بود؟");
    mocks.path = "/book/fin-garden-boutique-stay"; view.rerender(<GuestReviewInvitation />);
    expect(screen.queryByText("اقامتت چطور بود؟")).toBeNull();
    mocks.path = "/account"; view.rerender(<GuestReviewInvitation />);
    await screen.findByText("اقامتت چطور بود؟");
    mocks.eligible.mockResolvedValue([]); fireEvent(window, new Event(guestReviewsChangedEvent));
    await waitFor(() => expect(screen.queryByText("اقامتت چطور بود؟")).toBeNull());
    expect(mocks.eligible).toHaveBeenCalledTimes(3); // Re-entering the public-site boundary refreshes once.
  });
  it("groups multiple stays and suppresses only the explicitly chosen reservation", async () => {
    mocks.eligible.mockResolvedValue([stay, { ...stay, reservationId: 2, reservationNumber: "R-2", propertyName: "سرای دوم" }]);
    render(<GuestReviewInvitation />); await screen.findByText(/۱ اقامت دیگر/);
    expect(screen.getAllByText("اقامتت چطور بود؟")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toBe("/account/reviews");
    fireEvent.click(screen.getByText("تنظیم یادآوری برای هر اقامت"));
    fireEvent.click(screen.getByRole("button", { name: /دیگر برای این اقامت نمایش نده: سرای اول/ }));
    await waitFor(() => expect(mocks.suppress).toHaveBeenCalledWith(1, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toBe("/account/reviews?reservationId=2&eligiblePage=1"));
    expect(mocks.suppress).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "ثبت نظر" }));
  });
  it("scopes the compact card and text opt-out styling, retaining focus and touch targets", async () => {
    mocks.eligible.mockResolvedValue([stay]); render(<GuestReviewInvitation />);
    const heading = await screen.findByRole("heading", { name: "اقامتت چطور بود؟" });
    const card = heading.closest("section")!;
    const primary = within(card).getByRole("link", { name: "ثبت نظر" });
    primary.focus(); expect(document.activeElement).toBe(primary);
    expect(within(card).getByRole("button", { name: "فعلاً نه" })).toBeTruthy();
    const css = readFileSync(resolve("components/reviews/GuestReviewInvitation.module.css"), "utf8");
    expect(css).toContain("var(--card)"); expect(css).toContain("var(--border)"); expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (pointer: coarse)"); expect(css).toContain("min-height: 2.75rem");
    expect(css).toContain("overflow-wrap: anywhere"); expect(css).toContain("100dvh - var(--review-invitation-top)"); expect(css).not.toContain(":global");
  });
  it("uses the live header token and viewport-safe fixed width without changing card or eligibility behavior", async () => {
    mocks.eligible.mockResolvedValue([stay]); render(<GuestReviewInvitation />);
    await screen.findByRole("heading", { name: "اقامتت چطور بود؟" });
    const css = readFileSync(resolve("components/reviews/GuestReviewInvitation.module.css"), "utf8");
    expect(css).toContain("var(--header-height, 65px)"); expect(css).toContain("position: fixed");
    expect(css).toContain("width: min(22rem, calc(100vw - var(--review-invitation-right) - var(--review-invitation-left)))");
    expect(css).toContain(".toaster.toaster[data-sonner-toaster]");
    expect(css).toContain(".toaster[data-sonner-toaster] [data-sonner-toast] { width: 100%; left: 0; right: 0; transform: none; }");
    expect(css).toContain("@media (max-width: 600px)");
    ["top", "right", "left", "bottom"].forEach(edge => expect(css).toContain(`env(safe-area-inset-${edge}, 0px)`));
    expect(mocks.eligible).toHaveBeenCalledOnce(); expect(mocks.suppress).not.toHaveBeenCalled();
  });
});

describe("per-reservation permanent opt-out control", () => {
  it("is disabled until deployment is ready, not stored as a pretend client preference", () => {
    render(<ReviewInvitationOptOut stay={{ ...stay, invitationPreferenceAvailable: false }} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.suppress).not.toHaveBeenCalled();
  });
  it("distinguishes suppressed from submitted and survives a new browser session via backend data", () => {
    sessionStorage.clear(); render(<ReviewInvitationOptOut stay={{ ...stay, invitationSuppressed: true }} />);
    expect(screen.getByText(/همچنان می‌توانید نظر بدهید/)).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
  it("reports inline failure without hiding other stays or claiming success", async () => {
    mocks.suppress.mockRejectedValueOnce(new Error("offline")); render(<ReviewInvitationOptOut stay={stay} />);
    fireEvent.click(screen.getByRole("button")); await screen.findByRole("alert");
    expect(screen.queryByText(/یادآوری این اقامت خاموش است/)).toBeNull(); expect(screen.getByRole("button")).toBeTruthy();
  });
});
