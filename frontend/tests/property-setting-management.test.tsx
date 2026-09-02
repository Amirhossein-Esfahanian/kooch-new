import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertySettingManagement } from "@/components/admin/PropertySettingManagement";

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

const catalog = [
  {
    id: 1,
    name: "بافت تاریخی",
    slug: "historic-district",
    sortOrder: 20,
    isActive: true,
  },
  {
    id: 2,
    name: "محدوده بازار",
    slug: "bazaar-area",
    sortOrder: 10,
    isActive: false,
  },
  {
    id: 3,
    name: "آرام و خلوت",
    slug: "quiet-area",
    sortOrder: 10,
    isActive: true,
  },
];

describe("PropertySettingManagement", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    apiRequestMock.mockResolvedValue(catalog);
  });

  it("loads inactive entries and orders the catalog by SortOrder then Name", async () => {
    render(<PropertySettingManagement />);

    const list = await screen.findByTestId("property-setting-list");
    const rows = within(list).getAllByRole("article");

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/property-settings?includeInactive=true",
    );
    expect(rows.map((row) => within(row).getByRole("heading").textContent)).toEqual([
      "آرام و خلوت",
      "محدوده بازار",
      "بافت تاریخی",
    ]);
    expect(within(screen.getByTestId("property-setting-2")).getByText("غیرفعال")).toBeTruthy();
    expect(screen.getByText("historic-district")).toBeTruthy();
    expect(screen.getByTestId("property-setting-list").parentElement?.className).toContain(
      "overflow-hidden",
    );
  });

  it("creates a setting with every writable create field", async () => {
    apiRequestMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: 4,
        name: "نزدیک رودخانه",
        slug: "near-river",
        sortOrder: 7,
        isActive: false,
      });
    render(<PropertySettingManagement />);

    await screen.findByText("هنوز بافت و موقعیتی ثبت نشده است.");
    fireEvent.click(screen.getByRole("button", { name: /افزودن بافت و موقعیت/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^نام\s*\*$/), {
      target: { value: "نزدیک رودخانه" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^نامک/), {
      target: { value: "near-river" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^ترتیب نمایش/), {
      target: { value: "7" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "فعال" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "افزودن" }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenLastCalledWith("/property-settings", {
        method: "POST",
        body: JSON.stringify({
          name: "نزدیک رودخانه",
          slug: "near-river",
          sortOrder: 7,
          isActive: false,
        }),
      }),
    );
    expect(await screen.findByText("نزدیک رودخانه")).toBeTruthy();
  });

  it("keeps the slug read-only and excludes it from edit payloads", async () => {
    apiRequestMock.mockResolvedValueOnce(catalog).mockResolvedValueOnce({
      ...catalog[0],
      name: "محله تاریخی",
      sortOrder: 3,
      isActive: false,
    });
    render(<PropertySettingManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "ویرایش بافت تاریخی" }),
    );
    const dialog = await screen.findByRole("dialog");
    const slugInput = within(dialog).getByLabelText(/^نامک/);
    expect(slugInput.hasAttribute("readonly")).toBe(true);
    expect(slugInput.getAttribute("value")).toBe("historic-district");

    fireEvent.change(within(dialog).getByLabelText(/^نام\s*\*$/), {
      target: { value: "محله تاریخی" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^ترتیب نمایش/), {
      target: { value: "3" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "فعال" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ذخیره تغییرات" }),
    );

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenLastCalledWith("/property-settings/1", {
        method: "PUT",
        body: JSON.stringify({
          name: "محله تاریخی",
          sortOrder: 3,
          isActive: false,
        }),
      }),
    );
  });

  it("uses the shared confirmation dialog and surfaces assignment delete errors", async () => {
    const backendMessage =
      "این بافت و موقعیت دارای اقامتگاه مرتبط است و قابل حذف نیست؛ آن را غیرفعال کنید.";
    apiRequestMock
      .mockResolvedValueOnce(catalog)
      .mockRejectedValueOnce(new Error(backendMessage));
    render(<PropertySettingManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "حذف بافت تاریخی" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/به اقامتگاهی اختصاص داده شده باشد/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenLastCalledWith("/property-settings/1", {
        method: "DELETE",
      });
      expect(toastErrorMock).toHaveBeenCalledWith(backendMessage);
    });
    expect(screen.getByText("بافت تاریخی")).toBeTruthy();
  });
});
