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
  icon:
    "/uploads/amenity-categories/2/4e64b45c3c4648fab0e130b58d4891fc.svg",
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

  it("renders the canonical category icon as a subtle neutral decorative layer", () => {
    const { container } = render(
      <AmenitySelectionCard
        amenity={amenity}
        category={category}
        onToggle={vi.fn()}
        selected={false}
      />,
    );

    const card = screen.getByRole("button", { name: amenity.name });
    expect(card.getAttribute("aria-pressed")).toBe("false");

    const categoryLayer = container.querySelector(
      '[data-amenity-category-icon="decorative"]',
    );
    expect(categoryLayer?.getAttribute("aria-hidden")).toBe("true");
    expect(categoryLayer?.className).toContain("pointer-events-none");
    expect(categoryLayer?.className).toContain("z-0");
    expect(categoryLayer?.className).not.toContain("-z-10");
    expect(categoryLayer?.className).toContain("text-muted-foreground");
    expect(categoryLayer?.className).toContain("opacity-[0.06]");
    expect(categoryLayer?.innerHTML).toContain(category.icon);
    expect(
      categoryLayer?.querySelector<HTMLElement>("[style*='mask']")?.className,
    ).toContain("!h-24 !w-24");

    const iconMasks = Array.from(
      container.querySelectorAll<HTMLElement>("[style*='mask']"),
    );
    expect(iconMasks.some((icon) => icon.style.mask.includes(category.icon!))).toBe(
      true,
    );
    expect(iconMasks.some((icon) => icon.style.mask.includes(amenity.icon!))).toBe(
      true,
    );
  });

  it("uses the same semantic primary tone as the selected card while staying faint", () => {
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
    expect(card.className).toContain("text-primary");

    const categoryLayer = container.querySelector(
      '[data-amenity-category-icon="decorative"]',
    );
    expect(categoryLayer?.className).toContain("text-primary");
    expect(categoryLayer?.className).toContain("opacity-[0.1]");
    expect(categoryLayer?.className).toContain("pointer-events-none");
  });

  it("omits the watermark when the category has no icon", () => {
    const { container } = render(
      <AmenitySelectionCard
        amenity={amenity}
        category={{ ...category, icon: null }}
        onToggle={vi.fn()}
        selected={false}
      />,
    );

    expect(
      container.querySelector('[data-amenity-category-icon="decorative"]'),
    ).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
