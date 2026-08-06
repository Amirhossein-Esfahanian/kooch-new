import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, quality: _quality, unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} />
  ),
}));

vi.mock("react-easy-crop", () => ({
  default: () => <div data-testid="cropper" />,
}));

import { MediaGallery, MediaGalleryItem } from "@/components/MediaGallery";

const items: MediaGalleryItem[] = [
  { id: 1, url: "/courtyard.jpg", alt: "حیاط اقامتگاه", isMain: true },
  { id: 2, url: "/roof.jpg", alt: "بام اقامتگاه" },
];

function renderGallery(overrides: Partial<React.ComponentProps<typeof MediaGallery<MediaGalleryItem>>> = {}) {
  const props = {
    items,
    mode: "property" as const,
    onAdd: vi.fn(),
    onCrop: vi.fn(),
    onDelete: vi.fn(),
    onSetMain: vi.fn(),
    ...overrides,
  };

  return { ...render(<MediaGallery {...props} />), props };
}

describe("MediaGallery property image workflow", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("opens a visible KoochDialog preview and navigates between property images", async () => {
    renderGallery();

    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "حیاط اقامتگاه" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "تصویر بعدی" }));
    expect(within(dialog).getByRole("img", { name: "بام اقامتگاه" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "تصویر قبلی" }));
    expect(within(dialog).getByRole("img", { name: "حیاط اقامتگاه" })).toBeTruthy();
  });

  it("closes the preview with Escape and the KoochDialog backdrop", async () => {
    renderGallery();
    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[0]);
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[0]);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "بستن دیالوگ" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps upload and remove actions connected to the shared gallery", async () => {
    const onAdd = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderGallery({ onAdd, onDelete });
    const createObjectUrl = vi.fn(() => "blob:test-image");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    vi.stubGlobal("Image", class {
      naturalWidth = 1200;
      naturalHeight = 900;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    });

    const file = new File(["image"], "new-room.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([file]));

    fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "حذف تصویر" }));
    expect(onDelete).toHaveBeenCalledWith(items[0]);
  });

  it("previews an image added to the current gallery items", async () => {
    const view = renderGallery();
    view.rerender(
      <MediaGallery
        {...view.props}
        items={[...items, { id: 3, url: "/fresh.jpg", alt: "تصویر تازه بارگذاری‌شده" }]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[2]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "تصویر تازه بارگذاری‌شده" })).toBeTruthy();
  });
});
