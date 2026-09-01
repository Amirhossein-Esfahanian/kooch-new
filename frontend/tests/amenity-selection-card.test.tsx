import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AmenityCategoryResponse,
  AmenityResponse,
} from "@/lib/owner-api";
import { AmenitySelectionCard } from "@/components/amenities/AmenitySelectionCard";

const category: AmenityCategoryResponse = {
  id: 2,
  name: "خدمات پایه",
  slug: "base-services",
  sortOrder: 1,
  icon: "/svgs/amenity-categories/base-services.svg",
  isActive: true,
};

const amenity: AmenityResponse = {
  id: 7,
  amenityCategoryId: category.id,
  categoryName: category.name,
  categorySlug: category.slug,
  categorySortOrder: category.sortOrder,
  name: "اینترنت بی‌سیم پرسرعت در تمام فضای اقامتگاه",
  slug: "wifi",
  description: null,
  icon: "/svgs/amenities/wifi.svg",
  scope: "Both",
  sortOrder: 1,
};

describe("AmenitySelectionCard", () => {
  it("exposes the whole card as the selection control without checkbox or tick markup", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <AmenitySelectionCard
        amenity={amenity}
        category={category}
        onToggle={onToggle}
        selected={false}
      />,
    );

    const card = screen.getByRole("button", { name: amenity.name });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(card.querySelector(".line-clamp-2")).toBeTruthy();

    fireEvent.click(card);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("renders the category icon decoratively behind the amenity-specific icon", () => {
    const { container } = render(
      <AmenitySelectionCard
        amenity={amenity}
        category={category}
        onToggle={vi.fn()}
        selected
      />,
    );

    const card = screen.getByRole("button", { name: amenity.name });
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(card.className).toContain("border-primary");

    const categoryLayer = container.querySelector(
      '[data-amenity-category-icon="decorative"]',
    );
    expect(categoryLayer?.getAttribute("aria-hidden")).toBe("true");
    expect(categoryLayer?.className).toContain("pointer-events-none");
    expect(categoryLayer?.innerHTML).toContain(category.icon);

    const iconMasks = Array.from(
      container.querySelectorAll<HTMLElement>("[style*='mask']"),
    );
    expect(iconMasks.some((icon) => icon.style.mask.includes(amenity.icon!))).toBe(
      true,
    );
  });
});
