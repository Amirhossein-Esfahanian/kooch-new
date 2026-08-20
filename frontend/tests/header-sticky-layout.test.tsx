import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/Header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/properties/saraye-malek",
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: false, workspaces: [] }),
}));
vi.mock("@/components/auth/KoochGuestAuthDialog", () => ({
  KoochGuestAuthDialog: () => null,
}));
vi.mock("@/lib/site-settings", () => ({
  defaultSiteSettings: {},
  fetchPublicSiteSettings: vi.fn().mockResolvedValue([]),
  mergeSiteSettings: () => ({}),
  settingValue: (_settings: unknown, key: string) =>
    key === "site.name" ? "Kooch" : "",
}));

describe("Header sticky layout token", () => {
  let resizeCallback: ResizeObserverCallback;
  let renderedHeight = 65;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          height: renderedHeight,
          width: 1280,
          x: 0,
          y: 0,
          top: 0,
          right: 1280,
          bottom: renderedHeight,
          left: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--header-height");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes the rendered header height and follows responsive resizing", async () => {
    const rendered = render(<Header />);

    await waitFor(() =>
      expect(
        document.documentElement.style.getPropertyValue("--header-height"),
      ).toBe("65px"),
    );

    renderedHeight = 109;
    resizeCallback([], {} as ResizeObserver);
    expect(
      document.documentElement.style.getPropertyValue("--header-height"),
    ).toBe("109px");

    rendered.unmount();
    expect(
      document.documentElement.style.getPropertyValue("--header-height"),
    ).toBe("");
  });
});
