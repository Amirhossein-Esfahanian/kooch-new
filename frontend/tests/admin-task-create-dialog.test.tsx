import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminTaskCreateDialog } from "@/components/tasks/AdminTaskCreateDialog";

const mocks = vi.hoisted(() => ({ request: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.request }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/hooks/useHolidayCalendarMonths", () => ({
  useHolidayCalendarMonths: () => ({ holidayByDate: new Map() }),
}));

const assignees = [{ id: 4, displayName: "مدیر آزمون" }];
const resource = { items: assignees, loading: false, error: null, retry: vi.fn() };

async function readyForm() {
  const dialog = await screen.findByRole("dialog", { name: "ایجاد کار" });
  fireEvent.change(within(dialog).getByLabelText(/عنوان/), { target: { value: "پیگیری رزرو" } });
  fireEvent.change(within(dialog).getByLabelText(/مسئول کار/), { target: { value: "4" } });
  return dialog;
}

function chooseDay(index: number) {
  const day = document.querySelectorAll<HTMLButtonElement>("[data-calendar-date]")[index];
  expect(day).toBeTruthy();
  const date = day.dataset.calendarDate!;
  fireEvent.click(day);
  fireEvent.click(screen.getByRole("button", { name: "تایید" }));
  return date;
}

function createCalls() {
  return mocks.request.mock.calls.filter(([path, init]) => path === "/admin/tasks" && init?.method === "POST");
}

describe("shared Admin task creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/admin/tasks/assignees") return assignees;
      if (path === "/admin/reservations/12") return { id: 12, reservationNumber: "R-123456", propertyName: "اقامتگاه آزمون" };
      if (path === "/admin/tasks") return { id: 7 };
      throw new Error(path);
    });
  });

  it("selects and changes the project single date while retaining the local time and ISO UTC payload", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AdminTaskCreateDialog assigneeResource={resource} onClose={onClose} onCreated={onCreated} />);
    const dialog = await readyForm();
    expect((within(dialog).getByLabelText("ساعت سررسید") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "انتخاب تاریخ سررسید" }));
    chooseDay(1);
    const time = within(dialog).getByLabelText("ساعت سررسید") as HTMLInputElement;
    expect(time.value).toBe("00:00");
    fireEvent.change(time, { target: { value: "14:30" } });
    const dueGroup = within(dialog).getByRole("group", { name: "سررسید (اختیاری)" });
    fireEvent.click(within(dueGroup).getAllByRole("button")[0]);
    const selectedDate = chooseDay(3);
    expect(time.value).toBe("14:30");
    expect(createCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(JSON.parse(createCalls()[0][1].body)).toEqual({
      title: "پیگیری رزرو", description: null, priority: "Normal",
      dueAtUtc: new Date(`${selectedDate}T14:30`).toISOString(), assignedToUserId: 4, reservationId: null,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears date and time together, keeps the deadline optional and sends null", async () => {
    render(<AdminTaskCreateDialog assigneeResource={resource} onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = await readyForm();
    fireEvent.click(within(dialog).getByRole("button", { name: "انتخاب تاریخ سررسید" }));
    chooseDay(1);
    fireEvent.change(within(dialog).getByLabelText("ساعت سررسید"), { target: { value: "09:15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "پاک کردن سررسید" }));
    const time = within(dialog).getByLabelText("ساعت سررسید") as HTMLInputElement;
    expect(time.value).toBe("");
    expect(time.disabled).toBe(true);
    expect(within(dialog).getByRole("button", { name: "انتخاب تاریخ سررسید" })).toBeTruthy();
    expect(createCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(JSON.parse(createCalls()[0][1].body).dueAtUtc).toBeNull();
  });

  it("rejects a missing time for a selected date even if native form validation is bypassed", async () => {
    render(<AdminTaskCreateDialog assigneeResource={resource} onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = await readyForm();
    fireEvent.click(within(dialog).getByRole("button", { name: "انتخاب تاریخ سررسید" }));
    chooseDay(1);
    fireEvent.change(within(dialog).getByLabelText("ساعت سررسید"), { target: { value: "" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByText("زمان سررسید معتبر نیست.")).toBeTruthy();
    expect(createCalls()).toHaveLength(0);
  });

  it("does not discard edits or the verified reservation when the server rejects creation", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/reservations/12") return { reservationId: 12, reservationNumber: "R-123456" };
      if (init?.method === "POST") throw new Error("اجازه ثبت کار ندارید.");
      return assignees;
    });
    const onClose = vi.fn();
    render(<AdminTaskCreateDialog initialReservationId={12} assigneeResource={resource} onClose={onClose} onCreated={vi.fn()} />);
    const dialog = await readyForm();
    await waitFor(() => expect((within(dialog).getByLabelText("رزرو مرتبط") as HTMLSelectElement).value).toBe("12"));
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    expect(await screen.findByText("اجازه ثبت کار ندارید.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText(/عنوان/) as HTMLInputElement).value).toBe("پیگیری رزرو");
    expect(JSON.parse(createCalls()[0][1].body).reservationId).toBe(12);
  });

  it("cannot silently create an unlinked task if origin reservation verification fails", async () => {
    mocks.request.mockRejectedValue(new Error("دسترسی به رزرو کافی نیست"));
    render(<AdminTaskCreateDialog initialReservationId={12} assigneeResource={resource} onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = await readyForm();
    await screen.findByText("دسترسی به رزرو کافی نیست");
    expect(within(dialog).getByRole("button", { name: "ایجاد کار" }).hasAttribute("disabled")).toBe(true);
    fireEvent.submit(dialog.querySelector("form")!);
    expect(createCalls()).toHaveLength(0);
  });

  it("shows a read-only origin summary and submits that same reservation without a reservation request", async () => {
    render(<AdminTaskCreateDialog linkedReservation={{ reservationId: 12, reservationNumber: "R-123456", propertyName: "اقامتگاه آزمون" }}
      assigneeResource={resource} onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = await readyForm();
    const summary = within(dialog).getByRole("region", { name: "رزرو مرتبط" });
    expect(within(summary).getByText("R-123456")).toBeTruthy();
    expect(within(summary).getByText("اقامتگاه آزمون")).toBeTruthy();
    expect(within(summary).queryByRole("combobox")).toBeNull();
    expect(within(dialog).queryByLabelText("جستجوی رزرو (اختیاری)")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "جستجوی رزرو" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(JSON.parse(createCalls()[0][1].body).reservationId).toBe(12);
    expect(mocks.request.mock.calls.some(([path]) => String(path).startsWith("/admin/reservations"))).toBe(false);
  });

  it("uses the new origin immediately when reservation context changes", async () => {
    const props = { assigneeResource: resource, onClose: vi.fn(), onCreated: vi.fn() };
    const view = render(<AdminTaskCreateDialog {...props} linkedReservation={{ reservationId: 12, reservationNumber: "R-123456", propertyName: "اقامتگاه اول" }} />);
    const dialog = await readyForm();
    view.rerender(<AdminTaskCreateDialog {...props} linkedReservation={{ reservationId: 37, reservationNumber: "R-855759", propertyName: "اقامتگاه دوم" }} />);
    expect(within(dialog).getByText("R-855759")).toBeTruthy();
    expect(within(dialog).getByText("اقامتگاه دوم")).toBeTruthy();
    expect(within(dialog).queryByText("R-123456")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(JSON.parse(createCalls()[0][1].body).reservationId).toBe(37);
    expect(mocks.request.mock.calls.some(([path]) => String(path).startsWith("/admin/reservations"))).toBe(false);
  });

  it("retains optional reservation search, selection, and clearing for ordinary Tasks-page creation", async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/admin/reservations?")) return { items: [{ reservationId: 12, reservationNumber: "R-123456", propertyName: "اقامتگاه آزمون" }] };
      if (path === "/admin/tasks") return { id: 7 };
      throw new Error(path);
    });
    render(<AdminTaskCreateDialog assigneeResource={resource} onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = await readyForm();
    fireEvent.change(within(dialog).getByLabelText("جستجوی رزرو (اختیاری)"), { target: { value: " R-123456 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "جستجوی رزرو" }));
    const select = await within(dialog).findByLabelText("رزرو مرتبط") as HTMLSelectElement;
    expect(mocks.request).toHaveBeenCalledWith("/admin/reservations?reservationNumber=R-123456&page=1&pageSize=10");
    fireEvent.change(select, { target: { value: "12" } });
    expect(select.value).toBe("12");
    fireEvent.change(select, { target: { value: "" } });
    expect(select.value).toBe("");
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(JSON.parse(createCalls()[0][1].body).reservationId).toBeNull();
  });

  it.each(["escape", "close", "backdrop"])("dismisses via %s without saving and restores focus", async method => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>ارجاع کار</button>
        {open && <AdminTaskCreateDialog assigneeResource={resource} onClose={() => setOpen(false)} onCreated={vi.fn()} />}</>;
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "ارجاع کار" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "ایجاد کار" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    if (method === "escape") fireEvent.keyDown(document, { key: "Escape" });
    else if (method === "close") fireEvent.click(within(dialog).getByRole("button", { name: "بستن" }));
    else fireEvent.click(screen.getByRole("button", { name: "بستن دیالوگ" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "ایجاد کار" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(createCalls()).toHaveLength(0);
  });
});
