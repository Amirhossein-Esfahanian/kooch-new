import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { GuestReviewInvitation } from "@/components/reviews/GuestReviewInvitation";
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
  it.each(["anonymous", "loading"])("does not fetch or display for %s auth", async mode => {
    mocks.session.authenticated = mode !== "anonymous"; mocks.session.loading = mode === "loading";
    render(<GuestReviewInvitation />);
    expect(mocks.eligible).not.toHaveBeenCalled(); expect(screen.queryByText("اقامتتان چطور بود؟")).toBeNull();
  });
  it("silently handles empty or unavailable APIs", async () => {
    mocks.eligible.mockRejectedValueOnce(new Error("offline")); render(<GuestReviewInvitation />);
    await waitFor(() => expect(mocks.eligible).toHaveBeenCalledOnce());
    expect(screen.queryByText("اقامتتان چطور بود؟")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("has a persistent RTL toast, later-page form link and safe-area mobile offset", async () => {
    mocks.eligible.mockResolvedValue([{ ...stay, invitationPage: 3 }]); render(<GuestReviewInvitation />);
    const title = await screen.findByText("اقامتتان چطور بود؟");
    expect(title.closest("section")?.getAttribute("dir")).toBe("rtl");
    expect(screen.getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toBe("/account/reviews?reservationId=1&eligiblePage=3");
    const active = toast.getToasts().find(t => t.id === `guest-review-invitation-${user}`);
    expect(active && "duration" in active ? active.duration : undefined).toBe(Infinity);
    expect(active && "dismissible" in active ? active.dismissible : undefined).toBe(false);
    expect(document.querySelector('[data-sonner-toaster]')?.getAttribute("style")).toContain("safe-area-inset-bottom");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps one toast across route navigation without fetching on every route", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    await screen.findByText("اقامتتان چطور بود؟"); mocks.path = "/properties/stay";
    view.rerender(<GuestReviewInvitation />);
    expect(screen.getAllByText("اقامتتان چطور بود؟")).toHaveLength(1); expect(mocks.eligible).toHaveBeenCalledOnce();
  });
  it("persists temporary dismissal across remount and login within this browser session", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    fireEvent.click(await screen.findByRole("button", { name: "فعلاً نه" }));
    await waitFor(() => expect(screen.queryByText("اقامتتان چطور بود؟")).toBeNull());
    view.unmount(); render(<GuestReviewInvitation />);
    expect(mocks.eligible).toHaveBeenCalledOnce(); expect(mocks.suppress).not.toHaveBeenCalled();
  });
  it("does not leak dismissed state or content between accounts and clears on logout", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    fireEvent.click(await screen.findByRole("button", { name: "فعلاً نه" }));
    mocks.session = { ...mocks.session, user: { userId: ++user } }; view.rerender(<GuestReviewInvitation />);
    await screen.findByText("اقامتتان چطور بود؟"); expect(mocks.eligible).toHaveBeenCalledTimes(2);
    mocks.session = { ...mocks.session, authenticated: false }; view.rerender(<GuestReviewInvitation />);
    expect(screen.queryByText("اقامتتان چطور بود؟")).toBeNull();
  });
  it("hides on Direct routes and refreshes after a review event", async () => {
    mocks.eligible.mockResolvedValue([stay]); const view = render(<GuestReviewInvitation />);
    await screen.findByText("اقامتتان چطور بود؟");
    mocks.path = "/book/fin-garden-boutique-stay"; view.rerender(<GuestReviewInvitation />);
    expect(screen.queryByText("اقامتتان چطور بود؟")).toBeNull();
    mocks.path = "/account"; view.rerender(<GuestReviewInvitation />);
    await screen.findByText("اقامتتان چطور بود؟");
    mocks.eligible.mockResolvedValue([]); fireEvent(window, new Event(guestReviewsChangedEvent));
    await waitFor(() => expect(screen.queryByText("اقامتتان چطور بود؟")).toBeNull());
    expect(mocks.eligible).toHaveBeenCalledTimes(3); // Re-entering the public-site boundary refreshes once.
  });
  it("groups multiple stays and suppresses only the explicitly chosen reservation", async () => {
    mocks.eligible.mockResolvedValue([stay, { ...stay, reservationId: 2, reservationNumber: "R-2", propertyName: "سرای دوم" }]);
    render(<GuestReviewInvitation />); await screen.findByText(/برای ۲ اقامت/);
    expect(screen.getAllByText("اقامتتان چطور بود؟")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toBe("/account/reviews");
    fireEvent.click(screen.getByText("تنظیم یادآوری برای هر اقامت"));
    fireEvent.click(screen.getByRole("button", { name: /دیگر برای این اقامت نمایش نده: سرای اول/ }));
    await waitFor(() => expect(mocks.suppress).toHaveBeenCalledWith(1, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toBe("/account/reviews?reservationId=2&eligiblePage=1"));
    expect(mocks.suppress).toHaveBeenCalledOnce();
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
