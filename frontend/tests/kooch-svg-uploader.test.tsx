import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/owner-api", () => ({ apiRequest: ownerApi.apiRequest }));
vi.mock("sonner", () => ({ toast: notifications }));

import { KoochSvgUploader } from "@/components/KoochSvgUploader";

const defaultProps = {
  onRemove: vi.fn(),
  onStaged: vi.fn(),
  stagePath: "/amenities/svg/stage",
};

function selectFile(container: HTMLElement, file: File) {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
}

describe("KoochSvgUploader staged workflow", () => {
  const createObjectUrl = vi.fn(() => "blob:staged-svg");
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
  });

  it("posts only the SVG file to the stage endpoint and previews it after success", async () => {
    const onStaged = vi.fn();
    ownerApi.apiRequest.mockResolvedValue({
      uploadToken: "upload-token-1",
      assetNamespace: "Amenities",
      expiresAtUtc: "2026-08-30T12:00:00Z",
    });
    const { container } = render(
      <KoochSvgUploader {...defaultProps} onStaged={onStaged} />,
    );
    const file = new File(["<svg />"], "wifi.svg", {
      type: "image/svg+xml",
    });

    selectFile(container, file);

    await waitFor(() => expect(onStaged).toHaveBeenCalledWith("upload-token-1"));
    expect(ownerApi.apiRequest).toHaveBeenCalledWith(
      "/amenities/svg/stage",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    const requestBody = ownerApi.apiRequest.mock.calls[0][1].body as FormData;
    expect(requestBody.get("file")).toBe(file);
    expect(Array.from(requestBody.keys())).toEqual(["file"]);
    expect(createObjectUrl).toHaveBeenCalledWith(file);
    expect(
      screen.getByRole("img", { name: "پیش‌نمایش آیکن SVG" }).getAttribute("src"),
    ).toBe("blob:staged-svg");
  });

  it.each([
    [new File(["<svg />"], "icon.png", { type: "image/svg+xml" }), "پسوند SVG"],
    [new File(["<svg />"], "icon.svg", { type: "image/png" }), "نوع فایل"],
    [new File([], "empty.svg", { type: "image/svg+xml" }), "خالی است"],
    [
      new File([new Uint8Array(256 * 1024 + 1)], "large.svg", {
        type: "image/svg+xml",
      }),
      "۲۵۶ کیلوبایت",
    ],
  ])("rejects invalid SVG input before staging", async (file, message) => {
    const { container } = render(<KoochSvgUploader {...defaultProps} />);

    selectFile(container, file);

    expect(await screen.findByText(new RegExp(message))).toBeTruthy();
    expect(ownerApi.apiRequest).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("keeps the persisted icon when staging fails", async () => {
    ownerApi.apiRequest.mockRejectedValue(new Error("SVG نامعتبر است"));
    const { container } = render(
      <KoochSvgUploader
        {...defaultProps}
        persistedValue="/uploads/svgs/amenities/current.svg"
      />,
    );

    selectFile(
      container,
      new File(["<svg />"], "replacement.svg", { type: "image/svg+xml" }),
    );

    expect(await screen.findByText("SVG نامعتبر است")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "پیش‌نمایش آیکن SVG" }).getAttribute("src"),
    ).toBe("/uploads/svgs/amenities/current.svg");
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("ignores a stale stage response after a newer selection succeeds", async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    ownerApi.apiRequest
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce({ uploadToken: "new-token" });
    const onStaged = vi.fn();
    const { container } = render(
      <KoochSvgUploader {...defaultProps} onStaged={onStaged} />,
    );

    selectFile(
      container,
      new File(["<svg />"], "first.svg", { type: "image/svg+xml" }),
    );
    selectFile(
      container,
      new File(["<svg />"], "second.svg", { type: "image/svg+xml" }),
    );
    await waitFor(() => expect(onStaged).toHaveBeenCalledWith("new-token"));

    resolveFirst({ uploadToken: "old-token" });
    await Promise.resolve();

    expect(onStaged).toHaveBeenCalledTimes(1);
    expect(onStaged).not.toHaveBeenCalledWith("old-token");
  });

  it("accepts the current stage response after its lifecycle effect reinitializes", async () => {
    let resolveStage!: (value: unknown) => void;
    const stageResponse = new Promise((resolve) => {
      resolveStage = resolve;
    });
    ownerApi.apiRequest.mockReturnValue(stageResponse);
    const onStaged = vi.fn();
    const firstUploadingChange = vi.fn();
    const secondUploadingChange = vi.fn();
    const view = render(
      <KoochSvgUploader
        {...defaultProps}
        onStaged={onStaged}
        onUploadingChange={firstUploadingChange}
      />,
    );

    selectFile(
      view.container,
      new File(["<svg />"], "icon.svg", { type: "image/svg+xml" }),
    );
    expect(firstUploadingChange).toHaveBeenCalledWith(true);

    view.rerender(
      <KoochSvgUploader
        {...defaultProps}
        onStaged={onStaged}
        onUploadingChange={secondUploadingChange}
      />,
    );
    expect(firstUploadingChange).toHaveBeenCalledWith(false);

    resolveStage({ uploadToken: "reactivated-token" });

    await waitFor(() =>
      expect(onStaged).toHaveBeenCalledWith("reactivated-token"),
    );
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(firstUploadingChange.mock.calls).toEqual([
        [true],
        [false],
        [false],
      ]),
    );
    expect(secondUploadingChange).not.toHaveBeenCalled();
  });

  it("ignores a current stage response after a true unmount", async () => {
    let resolveStage!: (value: unknown) => void;
    const stageResponse = new Promise((resolve) => {
      resolveStage = resolve;
    });
    ownerApi.apiRequest.mockReturnValue(stageResponse);
    const onStaged = vi.fn();
    const view = render(
      <KoochSvgUploader {...defaultProps} onStaged={onStaged} />,
    );

    selectFile(
      view.container,
      new File(["<svg />"], "icon.svg", { type: "image/svg+xml" }),
    );
    view.unmount();
    resolveStage({ uploadToken: "unmounted-token" });
    await Promise.resolve();
    await Promise.resolve();

    expect(onStaged).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("revokes the local preview when removed or unmounted", async () => {
    ownerApi.apiRequest.mockResolvedValue({ uploadToken: "upload-token-1" });
    const onRemove = vi.fn();
    const view = render(
      <KoochSvgUploader
        {...defaultProps}
        onRemove={onRemove}
        pendingUploadToken="upload-token-1"
      />,
    );
    selectFile(
      view.container,
      new File(["<svg />"], "icon.svg", { type: "image/svg+xml" }),
    );
    await screen.findByRole("img", { name: "پیش‌نمایش آیکن SVG" });

    fireEvent.click(screen.getByRole("button", { name: "حذف SVG" }));
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:staged-svg");
    expect(onRemove).toHaveBeenCalledTimes(1);

    selectFile(
      view.container,
      new File(["<svg />"], "next.svg", { type: "image/svg+xml" }),
    );
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
  });
});
