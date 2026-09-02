import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AmenityCategoryResponse,
  AmenityResponse,
} from "@/lib/owner-api";

const ownerApi = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/owner-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/owner-api")>(
    "@/lib/owner-api",
  );
  return { ...actual, apiRequest: ownerApi.apiRequest };
});
vi.mock("sonner", () => ({ toast: notifications }));

import { AmenityManagement } from "@/components/amenities/AmenityManagement";

const baseCategory: AmenityCategoryResponse = {
  id: 1,
  name: "خدمات پایه",
  slug: "base-services",
  sortOrder: 1,
  icon: "/uploads/amenity-categories/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
  isActive: true,
};

const baseAmenity: AmenityResponse = {
  id: 10,
  amenityCategoryId: 1,
  categoryName: "خدمات پایه",
  categorySlug: "base-services",
  categorySortOrder: 1,
  name: "وای‌فای",
  slug: "wifi",
  description: null,
  icon: "/uploads/amenities/10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.svg",
  scope: "Property" as const,
  sortOrder: 1,
};

function requestPayload(path: string, method: string) {
  const call = ownerApi.apiRequest.mock.calls.find(
    ([calledPath, init]) => calledPath === path && init?.method === method,
  );
  expect(call).toBeTruthy();
  return JSON.parse(call![1].body as string);
}

function selectSvg(dialog: HTMLElement, name = "new-icon.svg") {
  const input = dialog.querySelector('input[type="file"]')!;
  fireEvent.change(input, {
    target: {
      files: [new File(["<svg />"], name, { type: "image/svg+xml" })],
    },
  });
}

describe("AmenityManagement staged SVG integration", () => {
  let categories: AmenityCategoryResponse[];
  let amenities: AmenityResponse[];

  beforeEach(() => {
    vi.clearAllMocks();
    categories = [{ ...baseCategory }];
    amenities = [{ ...baseAmenity }];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:amenity-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    ownerApi.apiRequest.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === "/amenity-categories?includeInactive=true") return categories;
        if (path === "/amenities") return amenities;
        if (path.endsWith("/svg/stage")) {
          return {
            uploadToken: path.startsWith("/amenity-categories")
              ? "category-token"
              : "amenity-token",
            assetNamespace: path.startsWith("/amenity-categories")
              ? "AmenityCategories"
              : "Amenities",
            expiresAtUtc: "2026-08-30T12:00:00Z",
          };
        }
        const payload = init?.body ? JSON.parse(init.body as string) : null;
        if (path === "/amenity-categories" && init?.method === "POST") {
          const response = {
            ...baseCategory,
            ...payload,
            id: 2,
            icon: "/uploads/svgs/amenity-categories/canonical.svg",
          };
          categories = [...categories, response];
          return response;
        }
        if (path === "/amenity-categories/1" && init?.method === "PUT") {
          const response = {
            ...categories[0],
            ...payload,
            icon: payload.removeIcon
              ? null
              : payload.iconUploadToken
                ? "/uploads/amenity-categories/1/cccccccccccccccccccccccccccccccc.svg"
                : categories[0].icon,
          };
          categories = [response];
          return response;
        }
        if (path === "/amenities" && init?.method === "POST") {
          const response = {
            ...baseAmenity,
            ...payload,
            id: 11,
            icon: "/uploads/svgs/amenities/canonical.svg",
          };
          amenities = [...amenities, response];
          return response;
        }
        if (path === "/amenities/10" && init?.method === "PUT") {
          const response = {
            ...amenities[0],
            ...payload,
            icon: payload.removeIcon
              ? null
              : payload.iconUploadToken
                ? "/uploads/amenities/10/dddddddddddddddddddddddddddddddd.svg"
                : amenities[0].icon,
          };
          amenities = [response];
          return response;
        }
        throw new Error(`Unexpected API request: ${init?.method ?? "GET"} ${path}`);
      },
    );
  });

  afterEach(() => {
    for (const [path, init] of ownerApi.apiRequest.mock.calls) {
      if (
        (init?.method === "POST" || init?.method === "PUT") &&
        (path === "/amenities" ||
          path.startsWith("/amenities/") ||
          path === "/amenity-categories" ||
          path.startsWith("/amenity-categories/")) &&
        !path.endsWith("/svg/stage")
      ) {
        expect(JSON.parse(init.body as string)).not.toHaveProperty("icon");
      }
    }
  });

  it("renders localized vertical scope badges with canonical category watermarks", async () => {
    amenities = [
      { ...baseAmenity, id: 10, name: "امکان اقامتگاه", scope: "Property" },
      { ...baseAmenity, id: 11, name: "امکان اتاق", scope: "RoomType" },
      { ...baseAmenity, id: 12, name: "امکان مشترک", scope: "Both" },
    ];

    const { container } = render(<AmenityManagement />);
    await screen.findByText("امکان اقامتگاه");

    const expectedLabels = {
      Property: "اقامتگاه",
      RoomType: "اتاق",
      Both: "هر دو",
    } as const;

    for (const [scope, label] of Object.entries(expectedLabels)) {
      const badge = container.querySelector(
        `[data-amenity-scope-badge="vertical"][data-scope="${scope}"]`,
      );
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain(label);
      expect(badge?.classList.contains("absolute")).toBe(true);
      expect(badge?.classList.contains("right-0")).toBe(true);
      expect(badge?.firstElementChild?.classList.contains("-rotate-90")).toBe(
        true,
      );
    }

    const watermarks = container.querySelectorAll(
      '[data-amenity-category-icon="decorative"]',
    );
    expect(watermarks).toHaveLength(3);
    for (const watermark of watermarks) {
      expect(watermark.getAttribute("aria-hidden")).toBe("true");
      expect(watermark.classList.contains("pointer-events-none")).toBe(true);
      expect(watermark.classList.contains("z-0")).toBe(true);
      expect(watermark.classList.contains("opacity-[0.07]")).toBe(true);
      expect(watermark.className).not.toContain("-z-");
      expect(
        (watermark.firstElementChild as HTMLElement | null)?.style.mask,
      ).toBe(`url("${baseCategory.icon}") center / contain no-repeat`);
    }

    expect(
      container.querySelectorAll('[data-amenity-card-foreground="true"]'),
    ).toHaveLength(3);
    expect(screen.getAllByTitle("ویرایش")).toHaveLength(3);
    expect(screen.getAllByTitle("حذف")).toHaveLength(3);
    expect(
      container.querySelector(`img[src="${baseAmenity.icon}"]`),
    ).not.toBeNull();
  });

  it("keeps card foreground and actions intact when the category has no icon", async () => {
    categories = [{ ...baseCategory, icon: null }];

    const { container } = render(<AmenityManagement />);
    await screen.findByText("وای‌فای");

    expect(
      container.querySelector('[data-amenity-category-icon="decorative"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-amenity-card-foreground="true"]'),
    ).not.toBeNull();
    const foreground = container.querySelector(
      '[data-amenity-card-foreground="true"]',
    );
    expect(foreground?.classList.contains("relative")).toBe(true);
    expect(foreground?.classList.contains("z-10")).toBe(true);
    expect(screen.getByTitle("ویرایش")).not.toBeNull();
    expect(screen.getByTitle("حذف")).not.toBeNull();
  });

  it("creates a category without granting persisted icon authority", async () => {
    render(<AmenityManagement />);
    await screen.findByText("خدمات پایه");
    fireEvent.click(screen.getByRole("button", { name: "دسته‌بندی امکانات" }));
    fireEvent.click(screen.getByRole("button", { name: /افزودن دسته‌بندی/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^نام فارسی/), {
      target: { value: "دسته بدون آیکن" },
    });
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(requestPayload("/amenity-categories", "POST")).toMatchObject({
        iconUploadToken: null,
        removeIcon: false,
      }),
    );
  });

  it.each([
    ["canonical", baseCategory.icon],
    ["legacy", "/svgs/amenity-categories/base-services.svg"],
  ])("edits a category with a %s display icon without echoing it", async (_, icon) => {
    categories = [{ ...baseCategory, icon }];
    render(<AmenityManagement />);
    await screen.findByText("خدمات پایه");
    fireEvent.click(screen.getByRole("button", { name: "دسته‌بندی امکانات" }));
    fireEvent.click(screen.getByTitle("ویرایش"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(requestPayload("/amenity-categories/1", "PUT")).toMatchObject({
        iconUploadToken: null,
        removeIcon: false,
      }),
    );
    expect(categories[0].icon).toBe(icon);
  });

  it("replaces a category icon using only the staged token", async () => {
    render(<AmenityManagement />);
    await screen.findByText("خدمات پایه");
    fireEvent.click(screen.getByRole("button", { name: "دسته‌بندی امکانات" }));
    fireEvent.click(screen.getByTitle("ویرایش"));
    const dialog = await screen.findByRole("dialog");
    selectSvg(dialog, "category-replacement.svg");
    await waitFor(() =>
      expect((dialog.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(requestPayload("/amenity-categories/1", "PUT")).toMatchObject({
        iconUploadToken: "category-token",
        removeIcon: false,
      }),
    );
  });

  it("creates an amenity without granting persisted icon authority", async () => {
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByRole("button", { name: /افزودن امکان/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^نام فارسی/), {
      target: { value: "امکان بدون آیکن" },
    });
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(requestPayload("/amenities", "POST")).toMatchObject({
        iconUploadToken: null,
        removeIcon: false,
      }),
    );
  });

  it.each([
    ["canonical", baseAmenity.icon],
    ["legacy", "/svgs/amenities/wifi.svg"],
  ])("edits an amenity with a %s display icon without echoing it", async (_, icon) => {
    amenities = [{ ...baseAmenity, icon }];
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByTitle("ویرایش"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(requestPayload("/amenities/10", "PUT")).toMatchObject({
        iconUploadToken: null,
        removeIcon: false,
      }),
    );
    expect(amenities[0].icon).toBe(icon);
  });

  it("replaces and removes an amenity icon without sending a persisted path", async () => {
    const view = render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByTitle("ویرایش"));
    let dialog = await screen.findByRole("dialog");
    selectSvg(dialog, "amenity-replacement.svg");
    await waitFor(() =>
      expect((dialog.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() =>
      expect(requestPayload("/amenities/10", "PUT")).toMatchObject({
        iconUploadToken: "amenity-token",
        removeIcon: false,
      }),
    );

    view.unmount();
    vi.clearAllMocks();
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByTitle("ویرایش"));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف SVG" }));
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(requestPayload("/amenities/10", "PUT")).toMatchObject({
        iconUploadToken: null,
        removeIcon: true,
      }),
    );
  });

  it("cancels an unchanged edit without writing or losing the display icon", async () => {
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByTitle("ویرایش"));
    let dialog = await screen.findByRole("dialog");
    expect(
      within(dialog)
        .getByRole("img", { name: "پیش‌نمایش آیکن SVG" })
        .getAttribute("src"),
    ).toBe(baseAmenity.icon);
    fireEvent.click(within(dialog).getByRole("button", { name: "لغو" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path, init]) => path === "/amenities/10" && init?.method === "PUT",
      ),
    ).toBe(false);

    fireEvent.click(screen.getByTitle("ویرایش"));
    dialog = await screen.findByRole("dialog");
    expect(
      within(dialog)
        .getByRole("img", { name: "پیش‌نمایش آیکن SVG" })
        .getAttribute("src"),
    ).toBe(baseAmenity.icon);
  });

  it("creates a category with a staged token and renders the canonical response path", async () => {
    render(<AmenityManagement />);
    await screen.findByText("خدمات پایه");
    fireEvent.click(screen.getByRole("button", { name: "دسته‌بندی امکانات" }));
    fireEvent.click(screen.getByRole("button", { name: /افزودن دسته‌بندی/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^نام فارسی/), {
      target: { value: "دسته تازه" },
    });
    selectSvg(dialog, "category.svg");
    await within(dialog).findByText("آیکن جدید پس از ذخیره جایگزین می‌شود.");
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(
        ownerApi.apiRequest.mock.calls.some(
          ([path, init]) => path === "/amenity-categories" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    expect(requestPayload("/amenity-categories", "POST")).toMatchObject({
      iconUploadToken: "category-token",
      removeIcon: false,
    });
    await waitFor(() =>
      expect(
        document.querySelector('[style*="amenity-categories/canonical.svg"]'),
      ).toBeTruthy(),
    );
  });

  it("edits a category with explicit removal and no upload token", async () => {
    render(<AmenityManagement />);
    await screen.findByText("خدمات پایه");
    fireEvent.click(screen.getByRole("button", { name: "دسته‌بندی امکانات" }));
    fireEvent.click(screen.getByTitle("ویرایش"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف SVG" }));
    expect(
      within(dialog).getByText("آیکن فعلی پس از ذخیره حذف می‌شود."),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(requestPayload("/amenity-categories/1", "PUT")).toMatchObject({
        iconUploadToken: null,
        removeIcon: true,
      }),
    );
  });

  it("creates an amenity with the amenity staging namespace", async () => {
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByRole("button", { name: /افزودن امکان/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^نام فارسی/), {
      target: { value: "پارکینگ" },
    });
    selectSvg(dialog, "parking.svg");
    await within(dialog).findByText("آیکن جدید پس از ذخیره جایگزین می‌شود.");
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(requestPayload("/amenities", "POST")).toMatchObject({
        iconUploadToken: "amenity-token",
        removeIcon: false,
      }),
    );
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path]) => path === "/amenities/svg/stage",
      ),
    ).toBe(true);
  });

  it("clears an invalid edit token while preserving the persisted amenity icon", async () => {
    ownerApi.apiRequest.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === "/amenity-categories?includeInactive=true") return categories;
        if (path === "/amenities") return amenities;
        if (path === "/amenities/svg/stage") return { uploadToken: "expired-token" };
        if (path === "/amenities/10" && init?.method === "PUT") {
          throw new Error("توکن بارگذاری SVG معتبر نیست یا منقضی شده است.");
        }
        throw new Error(`Unexpected API request: ${init?.method ?? "GET"} ${path}`);
      },
    );
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByTitle("ویرایش"));
    const dialog = await screen.findByRole("dialog");
    selectSvg(dialog, "replacement.svg");
    await within(dialog).findByText("آیکن جدید پس از ذخیره جایگزین می‌شود.");
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole("img", { name: "پیش‌نمایش آیکن SVG" })
          .getAttribute("src"),
      ).toBe(baseAmenity.icon),
    );
    expect(
      within(dialog).queryByText("آیکن جدید پس از ذخیره جایگزین می‌شود."),
    ).toBeNull();
    expect(notifications.error).toHaveBeenCalledWith(
      "توکن بارگذاری SVG معتبر نیست یا منقضی شده است.",
    );
  });

  it("never calls the legacy immediate-upload endpoints", async () => {
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByRole("button", { name: /افزودن امکان/ }));
    const dialog = await screen.findByRole("dialog");
    selectSvg(dialog);
    await within(dialog).findByText("آیکن جدید پس از ذخیره جایگزین می‌شود.");

    expect(ownerApi.apiRequest).not.toHaveBeenCalledWith(
      "/amenities/svg",
      expect.anything(),
    );
    expect(ownerApi.apiRequest).not.toHaveBeenCalledWith(
      "/amenity-categories/svg",
      expect.anything(),
    );
  });

  it("keeps entity save disabled until staging finishes", async () => {
    let resolveStage!: (value: unknown) => void;
    const stageResponse = new Promise((resolve) => {
      resolveStage = resolve;
    });
    ownerApi.apiRequest.mockImplementation(async (path: string) => {
      if (path === "/amenity-categories?includeInactive=true") return categories;
      if (path === "/amenities") return amenities;
      if (path === "/amenities/svg/stage") return stageResponse;
      throw new Error(`Unexpected API request: ${path}`);
    });
    render(<AmenityManagement />);
    await screen.findByText("وای‌فای");
    fireEvent.click(screen.getByRole("button", { name: /افزودن امکان/ }));
    const dialog = await screen.findByRole("dialog");

    selectSvg(dialog);
    await within(dialog).findByText("در حال بررسی و آماده‌سازی SVG...");
    expect(
      (within(dialog).getByRole("button", { name: "ذخیره" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    resolveStage({ uploadToken: "amenity-token" });
    await within(dialog).findByText("آیکن جدید پس از ذخیره جایگزین می‌شود.");
    expect(
      (within(dialog).getByRole("button", { name: "ذخیره" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
