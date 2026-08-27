import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestSelector } from "@/components/GuestSelector";
import {
  KoochInput,
  KoochMultiSelect,
  KoochSearchableSelect,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import { SharedDateRangePicker } from "@/components/SharedDateRangePicker";
import { SharedSingleDatePicker } from "@/components/SharedSingleDatePicker";

function expectCanonicalControl(element: Element | null) {
  expect(element).not.toBeNull();
  expect(element?.classList.contains("kooch-form-control")).toBe(true);
}

describe("canonical form-control visual contract", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("defines the shared visual and interaction states", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "app/globals.css"),
      "utf8",
    );

    expect(styles).toContain("--input-radius: 8px");
    expect(styles).toContain("--control-surface: var(--card)");
    expect(styles).toContain("--control-disabled-surface: var(--muted)");
    expect(styles).toContain(".kooch-form-control:hover:not(:disabled):not([readonly])");
    expect(styles).toContain("box-shadow: inset 0 0 0 1px var(--theme-primary)");
    expect(styles).toContain('.kooch-form-control[aria-invalid="true"]');
    expect(styles).toContain(".kooch-form-control[readonly]");
    expect(styles).toContain("transition-duration: 150ms");
    expect(styles).toContain(
      "transition-property: background-color, border-color, box-shadow",
    );
    expect(styles).toContain("transition-timing-function: ease-out");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.kooch-form-control \{[\s\S]*?transition-duration: 0ms;/,
    );
  });

  it("applies the contract to standard and searchable form controls", () => {
    const rendered = render(
      <div>
        <KoochInput aria-label="input" />
        <KoochSelect aria-label="select">
          <option value="one">One</option>
        </KoochSelect>
        <KoochTextarea aria-label="textarea" />
        <KoochSearchableSelect
          onChange={vi.fn()}
          options={[{ label: "One", value: "one" }]}
          value=""
        />
        <KoochMultiSelect
          onChange={vi.fn()}
          options={[{ label: "One", value: "one" }]}
          value={[]}
        />
      </div>,
    );

    expectCanonicalControl(rendered.getByLabelText("input"));
    expectCanonicalControl(rendered.getByLabelText("select"));
    expectCanonicalControl(rendered.getByLabelText("textarea"));

    const triggers = rendered.container.querySelectorAll(
      'button[aria-expanded="false"]',
    );
    expect(triggers).toHaveLength(2);
    triggers.forEach(expectCanonicalControl);

    fireEvent.click(triggers[0]);
    expect(triggers[0].getAttribute("data-control-active")).toBe("true");
  });

  it("applies the contract to date and guest selector triggers", () => {
    const rendered = render(
      <div>
        <SharedDateRangePicker
          combinedField
          onChange={vi.fn()}
          value={{ endDate: null, startDate: null }}
        />
        <SharedSingleDatePicker onChange={vi.fn()} value={null} />
        <GuestSelector
          onChange={vi.fn()}
          value={{ adults: 1, childAges: [], children: 0, rooms: 1 }}
        />
      </div>,
    );

    const rangeTrigger = rendered.container.querySelector(
      "[data-combined-date-field]",
    );
    const triggers = rendered.container.querySelectorAll(
      "button.kooch-form-control",
    );

    expectCanonicalControl(rangeTrigger);
    expect(triggers).toHaveLength(3);
    triggers.forEach(expectCanonicalControl);
  });
});
