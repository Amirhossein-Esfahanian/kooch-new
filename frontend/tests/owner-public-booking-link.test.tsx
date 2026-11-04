import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerPublicBookingLinkCard } from "@/components/owner/OwnerPublicBookingLinkCard";
import { publicBookingUrl, publicFrontendOrigin } from "@/lib/public-booking-url";

const property = { id: 2, status: "Approved", slug: "fin-garden-boutique-stay" };
const origin = "https://stays.example.test";
const url = `${origin}/book/${property.slug}`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", `${origin}/`);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("public frontend origin and booking URL", () => {
  it("normalizes an origin and encodes a single Property slug", () => {
    expect(publicFrontendOrigin(" HTTPS://STAYS.EXAMPLE.TEST/ ")).toBe(origin);
    expect(publicBookingUrl("خانه-باغ")).toBe(`${origin}/book/${encodeURIComponent("خانه-باغ")}`);
  });

  it.each([
    undefined, "", "/book", "//host.test", "javascript:alert(1)",
    "https://user:password@host.test", "https://@host.test", "https://host.test/path",
    "https://host.test/..", "https://host.test//", "https://host.test?", "https://host.test#",
    "https://host.test/?x=1", "https://host.test/#fragment", "https://host.test\\", "https://host.test\n/",
  ])("rejects invalid or non-origin configuration: %s", (value) => {
    expect(publicFrontendOrigin(value)).toBeNull();
  });

  it("requires HTTPS for non-local production destinations", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(publicFrontendOrigin("http://stays.example.test")).toBeNull();
    expect(publicFrontendOrigin(origin)).toBe(origin);
    for (const local of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      expect(publicFrontendOrigin(local)).toBe(local);
    }
    expect(publicFrontendOrigin("http://localhost.evil.test")).toBeNull();
  });

  it("permits explicit HTTP origins outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(publicFrontendOrigin("http://stays.example.test/")).toBe("http://stays.example.test");
  });

  it.each([undefined, null, "", " ", ".", "..", "../other", "other/room", "other\\room", "other?x=1", "other#room", "bad slug", "\ud800"])("rejects an invalid slug: %s", (slug) => {
    expect(publicBookingUrl(slug)).toBeNull();
  });

  it("never falls back to the current browser or Backend origin", () => {
    vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", "");
    vi.stubEnv("KOOCH_BACKEND_ORIGIN", "https://backend.example.test");
    expect(publicBookingUrl(property.slug)).toBeNull();
  });
});

describe("Owner public booking link card", () => {
  it("displays the complete Approved Property URL LTR in an RTL, responsive card", () => {
    render(<OwnerPublicBookingLinkCard canViewProperty property={property} />);
    const card = screen.getByRole("region", { name: "لینک رزرو عمومی" });
    const input = screen.getByRole("textbox", { name: "نشانی صفحه رزرو عمومی" }) as HTMLInputElement;
    expect(card.getAttribute("dir")).toBe("rtl");
    expect(input.value).toBe(url);
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.closest(".sm\\:flex-row")).toBeTruthy();
    expect(screen.getByRole("button", { name: "کپی لینک" })).toBeTruthy();
  });

  it("copies only the public URL and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      render(<OwnerPublicBookingLinkCard canViewProperty property={property} />);
      fireEvent.click(screen.getByRole("button", { name: "کپی لینک" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("لینک رزرو عمومی کپی شد."));
      expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([true, false])("announces clipboard failure, including unavailable clipboard (%s)", async (available) => {
    vi.stubGlobal("navigator", available ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } } : {});
    try {
      render(<OwnerPublicBookingLinkCard canViewProperty property={property} />);
      fireEvent.click(screen.getByRole("button", { name: "کپی لینک" }));
      expect((await screen.findByRole("alert")).textContent).toContain("دستی کپی کنید");
      expect(screen.getByRole("textbox")).toBeTruthy();
    } finally { vi.unstubAllGlobals(); }
  });

  it("opens the exact public booking page with opener isolation", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<OwnerPublicBookingLinkCard canViewProperty property={property} />);
    fireEvent.click(screen.getByRole("button", { name: "باز کردن صفحه رزرو (در زبانه جدید)" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(url, "_blank", "noopener,noreferrer");
  });

  it.each(["Draft", "PendingReview", "Rejected", "Suspended", "Inactive"])("does not advertise a public link for %s", (status) => {
    render(<OwnerPublicBookingLinkCard canViewProperty property={{ ...property, status }} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("فقط برای اقامتگاه تأییدشده");
  });

  it.each(["", "https://public.test/path"])("disables sharing with an informative configuration message (%s)", (value) => {
    vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", value);
    render(<OwnerPublicBookingLinkCard canViewProperty property={property} />);
    expect(screen.getByRole("status").textContent).toContain("نشانی عمومی سایت تنظیم نشده یا معتبر نیست");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["", "../foreign"])("does not share a missing or invalid slug (%s)", (slug) => {
    render(<OwnerPublicBookingLinkCard canViewProperty property={{ ...property, slug }} />);
    expect(screen.getByRole("status").textContent).toContain("شناسهٔ متنی اقامتگاه معتبر نیست");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("does not expose Property data to an unauthorized user", () => {
    render(<OwnerPublicBookingLinkCard canViewProperty={false} property={property} />);
    expect(screen.getByRole("status").textContent).toContain("دسترسی به اطلاعات این اقامتگاه ندارید");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("handles absent or invalid Property data without inventing a link", () => {
    const { rerender } = render(<OwnerPublicBookingLinkCard canViewProperty />);
    expect(screen.getByRole("status").textContent).toContain("اطلاعات معتبر اقامتگاه");
    rerender(<OwnerPublicBookingLinkCard canViewProperty property={{ ...property, id: 0 }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps loading distinct from unavailable Property information", () => {
    render(<OwnerPublicBookingLinkCard canViewProperty loading />);
    expect(screen.getByRole("status").textContent).toContain("در حال دریافت وضعیت");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
