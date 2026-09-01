import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyLocationMap } from "@/components/property/PropertyLocationMap";

type MapEvent = "error" | "load";

const mapInstances: MockMap[] = [];
const markerInstances: MockMarker[] = [];

class MockMap {
  handlers = new Map<string, Set<() => void>>();
  jumpTo = vi.fn();
  options: Record<string, unknown>;
  remove = vi.fn();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    mapInstances.push(this);
  }

  on(event: MapEvent, handler: () => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  off(event: MapEvent, handler: () => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
}

class MockMarker {
  draggable: boolean;
  element = document.createElement("div");
  position = { lat: 0, lng: 0 };
  remove = vi.fn();

  constructor(options: { draggable: boolean }) {
    this.draggable = options.draggable;
    markerInstances.push(this);
  }

  setLngLat(position: [number, number]) {
    this.position = { lat: position[1], lng: position[0] };
    return this;
  }

  addTo() {
    return this;
  }

  getElement() {
    return this.element;
  }
}

vi.mock("maplibre-gl", () => ({ Map: MockMap, Marker: MockMarker }));

describe("PropertyLocationMap", () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
  });

  it("renders a fixed marker at the saved longitude/latitude order", async () => {
    render(
      <PropertyLocationMap
        latitude={33.986407}
        longitude={51.447647}
        propertyName="سرای آزمون"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "موقعیت اقامتگاه" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "موقعیت اقامتگاه سرای آزمون" }),
    ).toBeTruthy();
    await waitFor(() => expect(mapInstances).toHaveLength(1));

    expect(mapInstances[0].options.center).toEqual([51.447647, 33.986407]);
    expect(markerInstances[0].position).toEqual({
      lat: 33.986407,
      lng: 51.447647,
    });
    expect(markerInstances[0].draggable).toBe(false);
    expect(markerInstances[0].element.getAttribute("role")).toBe("img");
    expect(markerInstances[0].element.getAttribute("aria-label")).toBe(
      "موقعیت اقامتگاه سرای آزمون",
    );
    expect(mapInstances[0].handlers.has("click")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each([
    [null, 51.41],
    [33.985, null],
    [Number.NaN, 51.41],
    [91, 51.41],
    [33.985, 181],
  ])("omits unsafe coordinates %#", (latitude, longitude) => {
    render(
      <PropertyLocationMap latitude={latitude} longitude={longitude} />,
    );

    expect(screen.queryByRole("heading", { name: "موقعیت اقامتگاه" })).toBeNull();
    expect(mapInstances).toHaveLength(0);
    expect(markerInstances).toHaveLength(0);
  });

  it("synchronizes a changed public coordinate without changing zoom", async () => {
    const result = render(
      <PropertyLocationMap latitude={33.985} longitude={51.41} />,
    );
    await waitFor(() => expect(markerInstances).toHaveLength(1));

    result.rerender(
      <PropertyLocationMap latitude={34.123456} longitude={52.654321} />,
    );

    expect(markerInstances[0].position).toEqual({
      lat: 34.123456,
      lng: 52.654321,
    });
    expect(mapInstances[0].jumpTo).toHaveBeenCalledWith({
      center: [52.654321, 34.123456],
    });

    result.unmount();
    expect(markerInstances[0].remove).toHaveBeenCalledOnce();
    expect(mapInstances[0].remove).toHaveBeenCalledOnce();
  });

  it("keeps provider details outside the public map component", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/property/PropertyLocationMap.tsx"),
      "utf8",
    );

    expect(source).not.toContain("tile.openstreetmap.org");
    expect(source).not.toContain("OpenStreetMap contributors");
  });
});
