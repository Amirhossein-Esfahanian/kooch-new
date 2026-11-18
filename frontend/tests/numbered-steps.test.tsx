import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { NumberedSteps } from "@/components/NumberedSteps";
import { BookingCheckoutStepper } from "@/components/booking/BookingCheckoutStepper";
import { readFileSync } from "node:fs";

it("shows numbered RTL steps with current/completed states but no interactive navigation", () => {
  const labels = ["اطلاعات اقامت", "انتخاب اتاق", "بررسی و ثبت"];
  const view = render(<NumberedSteps label="مراحل ایجاد رزرو" labels={labels} currentStep={2} />);
  const list = screen.getByRole("list", { name: "مراحل ایجاد رزرو" });
  expect(list.getAttribute("dir")).toBe("rtl");
  const steps = within(list).getAllByRole("listitem");
  expect(steps.map(step => step.dataset.state)).toEqual(["completed", "active", "upcoming"]);
  expect(steps[1].getAttribute("aria-current")).toBe("step");
  for (const [index, number] of ["۱", "۲", "۳"].entries()) {
    expect(within(steps[index]).getByText(number)).toBeTruthy();
  }
  expect(list.querySelector("svg")).toBeNull();
  expect(Array.from(list.querySelectorAll("[data-step-connector]")).map(connector => connector.getAttribute("data-step-connector")))
    .toEqual(["completed", "upcoming"]);
  expect(within(list).queryByRole("button")).toBeNull();
  expect(within(list).queryByRole("link")).toBeNull();
  view.rerender(<NumberedSteps label="مراحل ایجاد رزرو" labels={labels} currentStep={3} complete />);
  expect(within(list).getAllByRole("listitem").every(item => item.dataset.state === "completed")).toBe(true);
  expect(list.querySelector('[aria-current="step"]')).toBeNull();
  expect(list.querySelector("svg")).toBeNull();
  expect(Array.from(list.querySelectorAll("[data-step-connector]")).map(connector => connector.getAttribute("data-step-connector")))
    .toEqual(["completed", "completed"]);
  for (const number of ["۱", "۲", "۳"]) expect(within(list).getByText(number)).toBeTruthy();
});

it("keeps the connector mounted as progress advances and reverses, with none after the final circle", () => {
  const props = { label: "مراحل ثبت نظر", labels: ["امتیازدهی", "بررسی و ثبت"] };
  const view = render(<NumberedSteps {...props} currentStep={1} />);
  const list = screen.getByRole("list", { name: props.label });
  const connector = list.querySelector("[data-step-connector]")!;
  expect(connector.getAttribute("aria-hidden")).toBe("true");
  expect(connector.getAttribute("data-step-connector")).toBe("upcoming");
  view.rerender(<NumberedSteps {...props} currentStep={2} />);
  expect(list.querySelector("[data-step-connector]")).toBe(connector);
  expect(connector.getAttribute("data-step-connector")).toBe("completed");
  expect(list.querySelectorAll("[data-step-connector]")).toHaveLength(1);
  expect(within(list).getAllByRole("listitem")[1].querySelector("[data-step-connector]")).toBeNull();
  view.rerender(<NumberedSteps {...props} currentStep={1} />);
  expect(connector.getAttribute("data-step-connector")).toBe("upcoming");
});

it.each(["stay", "information", "review"] as const)("reuses numbered steps for guest checkout at %s without navigation", currentStep => {
  render(<BookingCheckoutStepper currentStep={currentStep} />);
  const list = screen.getByRole("list", { name: "مراحل تکمیل رزرو" });
  const current = { stay: 0, information: 1, review: 2 }[currentStep];
  const steps = within(list).getAllByRole("listitem");
  expect(steps.map(step => step.dataset.state)).toEqual(steps.map((_, index) =>
    index < current ? "completed" : index === current ? "active" : "upcoming"));
  expect(list.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(list.querySelector("svg")).toBeNull();
  for (const number of ["۱", "۲", "۳"]) expect(within(list).getByText(number)).toBeTruthy();
  expect(within(list).queryByRole("button")).toBeNull();
});

it("defines right-to-left solid progress, an active-only glow, intrinsic mobile columns and reduced motion", () => {
  const css = readFileSync("components/NumberedSteps.module.css", "utf8");
  expect(css).toContain("grid-auto-columns: minmax(0, 1fr)");
  expect(css).toContain("justify-items: center");
  expect(css).toContain("text-align: center");
  expect(css).toContain("dashed var(--step-line, var(--border))");
  expect(css).toContain("transform-origin: right center");
  expect(css).toContain('.connector[data-step-connector="completed"] .progress { transform: scaleX(1); }');
  expect(css).toMatch(/\[data-state="active"\] \.number\s*\{\s*box-shadow:/);
  expect(css).not.toMatch(/\[data-state="completed"\] \.number\s*\{[^}]*box-shadow:/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.progress \{ transition: none;/);
});
