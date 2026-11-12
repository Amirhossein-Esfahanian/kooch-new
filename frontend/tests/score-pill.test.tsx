import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScorePill } from "@/components/ScorePill";
import { getRatingQuality } from "@/lib/rating-quality";

function Selector({ initial = null, dir = "rtl" }: { initial?: number | null; dir?: "rtl" | "ltr" }) {
  const [value, setValue] = useState(initial);
  return <ScorePill name="cleanliness" label="نظافت" value={value} onChange={setValue} required dir={dir} />;
}

it("starts unselected and supports all ten controlled choices with real radio values and quality feedback", () => {
  const view = render(<Selector />);
  const group = screen.getByRole("radiogroup", { name: "نظافت" });
  const radios = within(group).getAllByRole("radio"); expect(radios).toHaveLength(10);
  expect(within(group).queryByRole("radio", { checked: true })).toBeNull();
  expect(radios.filter(radio => radio.tabIndex === 0)).toHaveLength(1);
  expect(group.getAttribute("aria-required")).toBe("true");
  for (let score = 1; score <= 10; score++) {
    fireEvent.click(radios[score - 1]);
    expect((within(group).getByRole("radio", { checked: true }) as HTMLInputElement).value).toBe(String(score));
    expect(screen.getByText(getRatingQuality(score).label)).toBeTruthy();
    expect(view.container.firstElementChild?.getAttribute("data-quality")).toBe(getRatingQuality(score).tone);
    expect(radios.filter(radio => radio.tabIndex === 0)).toEqual([radios[score - 1]]);
    expect(view.container.querySelector('[aria-hidden="true"] > [style]')?.getAttribute("style")).toContain(`translateX(${(score - 1) * 100}%)`);
  }
  expect(view.container.querySelector('[aria-hidden="true"] > [style]')?.getAttribute("style")).toContain("translateX(900%)");
});

it.each(["rtl", "ltr"] as const)("supports directional arrows, wrapping, Home/End and focus in %s", dir => {
  render(<Selector dir={dir} />);
  const radios = screen.getAllByRole("radio"); radios[0].focus();
  const forward = "ArrowRight";
  const backward = "ArrowLeft";
  fireEvent.keyDown(radios[0], { key: forward }); expect(document.activeElement).toBe(radios[1]);
  expect((radios[1] as HTMLInputElement).checked).toBe(true);
  fireEvent.keyDown(radios[1], { key: backward }); expect(document.activeElement).toBe(radios[0]);
  fireEvent.keyDown(radios[0], { key: backward }); expect(document.activeElement).toBe(radios[9]);
  fireEvent.keyDown(radios[9], { key: "Home" }); expect(document.activeElement).toBe(radios[0]);
  fireEvent.keyDown(radios[0], { key: "End" }); expect(document.activeElement).toBe(radios[9]);
  fireEvent.keyDown(radios[9], { key: "ArrowDown" }); expect(document.activeElement).toBe(radios[0]);
  fireEvent.keyDown(radios[0], { key: "ArrowUp" }); expect(document.activeElement).toBe(radios[9]);
});

it("reflects existing and externally changed ratings without inventing a default", () => {
  const onChange = vi.fn(); const view = render(<ScorePill name="score" label="آسایش" value={7} onChange={onChange} />);
  expect((screen.getByRole("radio", { checked: true }) as HTMLInputElement).value).toBe("7");
  view.rerender(<ScorePill name="score" label="آسایش" value={9} onChange={onChange} />);
  expect((screen.getByRole("radio", { checked: true }) as HTMLInputElement).value).toBe("9");
  view.rerender(<ScorePill name="score" label="آسایش" value={null} onChange={onChange} />);
  expect(screen.queryByRole("radio", { checked: true })).toBeNull(); expect(onChange).not.toHaveBeenCalled();
});

it("associates validation/help with its group and respects disabled controls", () => {
  const onChange = vi.fn();
  render(<><p id="score-error">امتیاز لازم است</p><ScorePill name="score" label="امکانات" disabled invalid describedBy="score-error" onChange={onChange} /></>);
  const group = screen.getByRole("radiogroup", { name: "امکانات" });
  expect(group.getAttribute("aria-invalid")).toBe("true"); expect(group.getAttribute("aria-describedby")).toContain("score-error");
  screen.getAllByRole("radio").forEach(radio => expect((radio as HTMLInputElement).disabled).toBe(true));
  fireEvent.keyDown(screen.getAllByRole("radio")[0], { key: "End" }); expect(onChange).not.toHaveBeenCalled();
});

it("uses a narrow-safe ten-column layout, visible focus and CSS-only reduced-motion-safe movement", () => {
  const css = readFileSync(resolve("components/ScorePill.module.css"), "utf8");
  expect(css).toContain("repeat(10, minmax(0, 1fr))"); expect(css).toContain("min-width: 0");
  expect(css).toContain(".track { direction: ltr;");
  expect(css).toContain("min-height: 2.125rem"); expect(css).toContain("padding: 0.0625rem"); expect(css).toContain(":focus-visible");
  expect(css).toContain(".selectionViewport { position: absolute; inset: 0;");
  expect(css).toContain("@media (pointer: coarse)"); expect(css).toContain("height: calc(100% + 4px)");
  expect(css).toContain(".selection { inset-block: 3px; }");
  expect(css).toContain("inset-inline-start: 0"); expect(css).toContain("cubic-bezier(0.34, 1.56, 0.64, 1)");
  expect(css).toContain("@media (prefers-reduced-motion: reduce) { .selection { transition: none; }");
  expect(css).not.toContain(":global");
});

it("emphasizes the selected number and inset pill edge without changing compact track geometry", () => {
  const css = readFileSync(resolve("components/ScorePill.module.css"), "utf8");
  expect(css).toContain("font-size: 0.875rem; font-weight: 600; line-height: 1;");
  expect(css).toContain(".option input:checked + .number { color: var(--card); font-weight: 800; }");
  expect(css).toContain("box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--card) 24%, transparent)");
  expect(css).toContain("width: 10%; border-radius: 999px;");
  expect(css).not.toMatch(/scale\(/);
  const view = render(<Selector />);
  const options = screen.getAllByRole("radio").map(radio => radio.closest("label"));
  for (const score of [1, 10, 5]) {
    fireEvent.click(screen.getAllByRole("radio")[score - 1]);
    expect(screen.getAllByRole("radio").map(radio => radio.closest("label"))).toEqual(options);
    expect(view.container.querySelector('[aria-hidden="true"] > [style]')?.getAttribute("style"))
      .toContain(`translateX(${(score - 1) * 100}%)`);
  }
});

it("keeps the form-facing heading RTL while ordering actual radio values 1–10 left to right", () => {
  const view = render(<Selector />);
  const group = screen.getByRole("radiogroup", { name: "نظافت" });
  const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
  expect(view.container.firstElementChild?.getAttribute("dir")).toBe("rtl");
  expect(group.firstElementChild?.getAttribute("dir")).toBe("ltr");
  expect(radios.map(radio => radio.value)).toEqual(Array.from({ length: 10 }, (_, index) => String(index + 1)));
  expect(radios[0].closest("label")?.textContent).toBe("۱");
  expect(radios[9].closest("label")?.textContent).toBe("۱۰");
  const label = document.getElementById(group.getAttribute("aria-labelledby")!)!;
  expect(label.closest('[dir]')?.getAttribute("dir")).toBe("rtl");
});

it("places quality feedback opposite the category label with no extra feedback row or unselected score", () => {
  const view = render(<Selector />);
  const group = screen.getByRole("radiogroup", { name: "نظافت" });
  const label = document.getElementById(group.getAttribute("aria-labelledby")!)!;
  const feedback = document.getElementById(group.getAttribute("aria-describedby")!)!;
  expect(feedback.textContent).toBe("");
  expect(feedback.parentElement).toBe(label.parentElement);
  expect(label.parentElement?.nextElementSibling).toBe(group);
  expect(view.container.firstElementChild?.children).toHaveLength(2);
  fireEvent.click(screen.getByRole("radio", { name: "۷ از ۱۰" }));
  expect(feedback.textContent).toBe("خوب"); expect(feedback.getAttribute("aria-live")).toBe("polite");
  expect(feedback.parentElement).toBe(label.parentElement);
  const css = readFileSync(resolve("components/ScorePill.module.css"), "utf8");
  expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto");
  expect(css).not.toContain("min-height: 1.5rem");
});
