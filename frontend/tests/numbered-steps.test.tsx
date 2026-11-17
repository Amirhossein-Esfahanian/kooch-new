import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { NumberedSteps } from "@/components/NumberedSteps";

it("shows numbered RTL steps with current/completed states but no interactive navigation", () => {
  const labels = ["اطلاعات اقامت", "انتخاب اتاق", "بررسی و ثبت"];
  const view = render(<NumberedSteps label="مراحل ایجاد رزرو" labels={labels} currentStep={2} />);
  const list = screen.getByRole("list", { name: "مراحل ایجاد رزرو" });
  expect(list.getAttribute("dir")).toBe("rtl");
  const steps = within(list).getAllByRole("listitem");
  expect(steps.map(step => step.dataset.state)).toEqual(["completed", "active", "upcoming"]);
  expect(steps[1].getAttribute("aria-current")).toBe("step");
  expect(steps[1].textContent).toContain("۲");
  expect(within(list).queryByRole("button")).toBeNull();
  expect(within(list).queryByRole("link")).toBeNull();
  view.rerender(<NumberedSteps label="مراحل ایجاد رزرو" labels={labels} currentStep={3} complete />);
  expect(within(list).getAllByRole("listitem").every(item => item.dataset.state === "completed")).toBe(true);
  expect(list.querySelector('[aria-current="step"]')).toBeNull();
});
