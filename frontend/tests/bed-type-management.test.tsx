import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BedTypeManagement } from "@/components/admin/BedTypeManagement";

const apiRequestMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/lib/owner-api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/components/KoochSvgUploader", () => ({
  KoochSvgUploader: ({
    onRemove,
    onRestore,
    onStaged,
    persistedValue,
    removePending,
    stagePath,
  }: {
    onRemove: () => void;
    onRestore?: () => void;
    onStaged: (token: string) => void;
    persistedValue?: string | null;
    removePending?: boolean;
    stagePath: string;
  }) => (
    <div data-stage-path={stagePath} data-testid="svg-uploader">
      <span>{persistedValue ?? "بدون آیکن"}</span>
      <button onClick={() => onStaged("staged-bed-token")} type="button">
        آماده‌سازی آیکن
      </button>
      <button onClick={onRemove} type="button">
        حذف آیکن
      </button>
      {removePending && onRestore && (
        <button onClick={onRestore} type="button">
          لغو حذف
        </button>
      )}
    </div>
  ),
}));

const catalog = [
  {
    id: 1,
    name: "Single Bed",
    slug: "single-bed",
    icon: "/uploads/bed-types/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
  },
  {
    id: 2,
    name: "Double Bed",
    slug: "double-bed",
    icon: null,
  },
];

describe("BedTypeManagement", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    apiRequestMock.mockResolvedValue(catalog);
  });

  it("loads the catalog and renders canonical and fallback icons", async () => {
    render(<BedTypeManagement />);

    const list = await screen.findByTestId("bed-type-list");
    expect(apiRequestMock).toHaveBeenCalledWith("/bed-types");
    expect(within(list).getByText("Single Bed")).toBeTruthy();
    expect(within(list).getByText("Double Bed")).toBeTruthy();
    expect(screen.getByTestId("bed-type-icon-1").getAttribute("style")).toContain(
      "/uploads/bed-types/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
    );
    expect(screen.getByTestId("bed-type-2").innerHTML).toContain(
      "/svgs/bed-bunk.svg",
    );
  });

  it("keeps load failures distinct from an empty catalog and supports retry", async () => {
    apiRequestMock
      .mockRejectedValueOnce(new Error("دریافت نوع‌های تخت ممکن نیست."))
      .mockResolvedValueOnce(catalog);
    render(<BedTypeManagement />);

    expect(
      await screen.findByText("دریافت نوع‌های تخت ممکن نیست."),
    ).toBeTruthy();
    expect(screen.queryByText("هنوز نوع تختی ثبت نشده است.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));

    expect(await screen.findByText("Single Bed")).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledTimes(2);
  });

  it("creates without an icon and sends no writable icon path", async () => {
    apiRequestMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: 3,
        name: "Travel Bed",
        slug: "travel-bed",
        icon: null,
      });
    render(<BedTypeManagement />);

    await screen.findByText("هنوز نوع تختی ثبت نشده است.");
    fireEvent.click(screen.getByRole("button", { name: "افزودن نوع تخت" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^نام\s*\*$/), {
      target: { value: "Travel Bed" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^نامک/), {
      target: { value: "travel-bed" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "افزودن" }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenLastCalledWith("/bed-types", {
        method: "POST",
        body: JSON.stringify({
          name: "Travel Bed",
          slug: "travel-bed",
          iconUploadToken: null,
          removeIcon: false,
        }),
      }),
    );
  });

  it("keeps slug read-only and replaces an icon through a staged token", async () => {
    apiRequestMock.mockResolvedValueOnce(catalog).mockResolvedValueOnce({
      ...catalog[0],
      name: "Single Bed Updated",
      icon: "/uploads/bed-types/1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.svg",
    });
    render(<BedTypeManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "ویرایش Single Bed" }),
    );
    const dialog = await screen.findByRole("dialog");
    const slugInput = within(dialog).getByLabelText(/^نامک/);
    expect(slugInput.hasAttribute("readonly")).toBe(true);
    expect(slugInput.getAttribute("value")).toBe("single-bed");
    expect(within(dialog).getByTestId("svg-uploader").dataset.stagePath).toBe(
      "/bed-types/svg/stage",
    );

    fireEvent.change(within(dialog).getByLabelText(/^نام\s*\*$/), {
      target: { value: "Single Bed Updated" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "آماده‌سازی آیکن" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ذخیره تغییرات" }),
    );

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenLastCalledWith("/bed-types/1", {
        method: "PUT",
        body: JSON.stringify({
          name: "Single Bed Updated",
          iconUploadToken: "staged-bed-token",
          removeIcon: false,
        }),
      }),
    );
  });

  it("sends explicit removal and allows restoring before save", async () => {
    apiRequestMock.mockResolvedValueOnce(catalog).mockResolvedValueOnce({
      ...catalog[0],
      icon: null,
    });
    render(<BedTypeManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "ویرایش Single Bed" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف آیکن" }));
    expect(within(dialog).getByRole("button", { name: "لغو حذف" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "لغو حذف" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف آیکن" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ذخیره تغییرات" }),
    );

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenLastCalledWith("/bed-types/1", {
        method: "PUT",
        body: JSON.stringify({
          name: "Single Bed",
          iconUploadToken: null,
          removeIcon: true,
        }),
      }),
    );
  });

  it("uses confirmation and surfaces a referenced-delete error", async () => {
    const backendMessage =
      "این نوع تخت در یک یا چند نوع اتاق استفاده شده است و قابل حذف نیست.";
    apiRequestMock
      .mockResolvedValueOnce(catalog)
      .mockRejectedValueOnce(new Error(backendMessage));
    render(<BedTypeManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "حذف Single Bed" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenLastCalledWith("/bed-types/1", {
        method: "DELETE",
      });
      expect(toastErrorMock).toHaveBeenCalledWith(backendMessage);
    });
    expect(screen.getByText("Single Bed")).toBeTruthy();
  });
});
