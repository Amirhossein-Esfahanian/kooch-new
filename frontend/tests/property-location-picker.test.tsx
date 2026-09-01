import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyLocationPicker } from "@/components/property/PropertyLocationPicker";

type MapEvent = "click" | "error" | "load" | "mousedown";

const mapInstances: MockMap[] = [];
const markerInstances: MockMarker[] = [];

class MockMap {
  handlers = new Map<string, Set<(event: never) => void>>();
  options: Record<string, unknown>;
  remove = vi.fn();
  jumpTo = vi.fn();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    mapInstances.push(this);
  }

  on(event: MapEvent, handler: (event: never) => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  off(event: MapEvent, handler: (event: never) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  trigger(event: MapEvent, payload?: unknown) {
    this.handlers.get(event)?.forEach((handler) => handler(payload as never));
  }
}

class MockMarker {
  handlers = new Map<string, Set<() => void>>();
  position = { lat: 0, lng: 0 };
  draggable: boolean;
  remove = vi.fn();
  setDraggable = vi.fn((draggable: boolean) => {
    this.draggable = draggable;
    return this;
  });

  constructor(options: { draggable: boolean }) {
    this.draggable = options.draggable;
    markerInstances.push(this);
  }

  setLngLat(position: [number, number] | { lat: number; lng: number }) {
    this.position = Array.isArray(position)
      ? { lat: position[1], lng: position[0] }
      : position;
    return this;
  }

  getLngLat() {
    return this.position;
  }

  addTo() {
    return this;
  }

  on(event: string, handler: () => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  trigger(event: string) {
    this.handlers.get(event)?.forEach((handler) => handler());
  }
}

vi.mock("maplibre-gl", () => ({ Map: MockMap, Marker: MockMarker }));

async function renderPicker(
  value: { latitude: number; longitude: number } | null = null,
  disabled = false,
) {
  const onChange = vi.fn();
  const result = render(
    <PropertyLocationPicker
      disabled={disabled}
      onChange={onChange}
      value={value}
    />,
  );
  await waitFor(() => expect(mapInstances).toHaveLength(1));
  return { ...result, onChange };
}

function ControlledPicker({
  initialValue = null,
  onChange,
}: {
  initialValue?: { latitude: number; longitude: number } | null;
  onChange: (value: { latitude: number; longitude: number } | null) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <PropertyLocationPicker
      onChange={(nextValue) => {
        onChange(nextValue);
        setValue(nextValue);
      }}
      value={value}
    />
  );
}

describe("PropertyLocationPicker", () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
  });

  it("uses Kashan only as the null-value camera center", async () => {
    const { onChange } = await renderPicker();

    expect(mapInstances[0].options.center).toEqual([51.41, 33.985]);
    expect(markerInstances).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("populates an existing value without emitting on mount", async () => {
    const { onChange } = await renderPicker({
      latitude: 33.987654,
      longitude: 51.412345,
    });

    expect(
      (screen.getByLabelText("عرض جغرافیایی") as HTMLInputElement).value,
    ).toBe("33.987654");
    expect(
      (screen.getByLabelText("طول جغرافیایی") as HTMLInputElement).value,
    ).toBe("51.412345");
    expect(markerInstances[0].position).toEqual({
      lat: 33.987654,
      lng: 51.412345,
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits only after a complete valid manual pair and normalizes precision", async () => {
    const { onChange } = await renderPicker();

    fireEvent.change(screen.getByLabelText("عرض جغرافیایی"), {
      target: { value: "33.12345678" },
    });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("طول جغرافیایی"), {
      target: { value: "51.98765432" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      latitude: 33.123457,
      longitude: 51.987654,
    });
  });

  it("does not emit longitude-only, partial, or invalid manual values", async () => {
    const { onChange } = await renderPicker();
    const latitude = screen.getByLabelText("عرض جغرافیایی");
    const longitude = screen.getByLabelText("طول جغرافیایی");

    fireEvent.change(longitude, { target: { value: "51.41" } });
    fireEvent.change(latitude, { target: { value: "-" } });
    fireEvent.change(latitude, { target: { value: "91" } });
    fireEvent.change(longitude, { target: { value: "181" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(latitude.getAttribute("aria-invalid")).toBe("true");
    expect(longitude.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps temporary text editable and reports malformed coordinates", async () => {
    const { onChange } = await renderPicker();
    const latitude = screen.getByLabelText("عرض جغرافیایی");

    fireEvent.change(latitude, { target: { value: "33." } });
    expect((latitude as HTMLInputElement).value).toBe("33.");

    fireEvent.change(latitude, { target: { value: "not-a-coordinate" } });
    expect((latitude as HTMLInputElement).value).toBe("not-a-coordinate");
    expect(latitude.getAttribute("aria-invalid")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the marker, fields, and controlled value", async () => {
    const { onChange } = await renderPicker({
      latitude: 33.985,
      longitude: 51.41,
    });

    fireEvent.click(screen.getByRole("button", { name: "پاک کردن موقعیت" }));

    expect(
      (screen.getByLabelText("عرض جغرافیایی") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("طول جغرافیایی") as HTMLInputElement).value,
    ).toBe("");
    expect(markerInstances[0].remove).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("disables manual, clear, click, and marker-drag changes", async () => {
    const { onChange } = await renderPicker(
      { latitude: 33.985, longitude: 51.41 },
      true,
    );

    expect(
      (screen.getByLabelText("عرض جغرافیایی") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("طول جغرافیایی") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "پاک کردن موقعیت",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(markerInstances[0].draggable).toBe(false);

    mapInstances[0].trigger("click", { lngLat: { lat: 34, lng: 52 } });
    markerInstances[0].position = { lat: 34, lng: 52 };
    markerInstances[0].trigger("dragend");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("converts MapLibre click and marker [longitude, latitude] order", async () => {
    const { onChange } = await renderPicker();

    mapInstances[0].trigger("click", {
      lngLat: { lat: 33.1111114, lng: 51.2222226 },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      latitude: 33.111111,
      longitude: 51.222223,
    });

    markerInstances[0].position = { lat: 34.3333336, lng: 52.4444444 };
    markerInstances[0].trigger("dragend");
    expect(onChange).toHaveBeenLastCalledWith({
      latitude: 34.333334,
      longitude: 52.444444,
    });
  });

  it("does not move the camera when a map click is echoed by its controlled parent", async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    await waitFor(() => expect(mapInstances).toHaveLength(1));

    act(() => {
      mapInstances[0].trigger("click", {
        lngLat: { lat: 33.1111114, lng: 51.2222226 },
      });
    });

    expect(onChange).toHaveBeenLastCalledWith({
      latitude: 33.111111,
      longitude: 51.222223,
    });
    expect(mapInstances[0].jumpTo).not.toHaveBeenCalled();
  });

  it("keeps dragend authoritative when the marker gesture also produces a map click", async () => {
    const onChange = vi.fn();
    render(
      <ControlledPicker
        initialValue={{ latitude: 33.985, longitude: 51.41 }}
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(markerInstances).toHaveLength(1));

    act(() => {
      markerInstances[0].trigger("dragstart");
      markerInstances[0].position = { lat: 34.3333336, lng: 52.4444444 };
      markerInstances[0].trigger("dragend");
      mapInstances[0].trigger("click", {
        lngLat: { lat: 35.5555555, lng: 53.6666666 },
      });
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith({
      latitude: 34.333334,
      longitude: 52.444444,
    });
    expect(markerInstances[0].position).toEqual({
      lat: 34.333334,
      lng: 52.444444,
    });
    expect(mapInstances[0].jumpTo).not.toHaveBeenCalled();
  });

  it("allows a fresh map click after a marker drag without a trailing click", async () => {
    const onChange = vi.fn();
    render(
      <ControlledPicker
        initialValue={{ latitude: 33.985, longitude: 51.41 }}
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(markerInstances).toHaveLength(1));

    act(() => {
      markerInstances[0].trigger("dragstart");
      markerInstances[0].position = { lat: 34, lng: 52 };
      markerInstances[0].trigger("dragend");
      mapInstances[0].trigger("mousedown");
      mapInstances[0].trigger("click", {
        lngLat: { lat: 35, lng: 53 },
      });
    });

    expect(onChange).toHaveBeenLastCalledWith({ latitude: 35, longitude: 53 });
  });

  it("does not move the camera for clear or valid manual coordinate echoes", async () => {
    const onChange = vi.fn();
    render(
      <ControlledPicker
        initialValue={{ latitude: 33.985, longitude: 51.41 }}
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(markerInstances).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "پاک کردن موقعیت" }));
    expect(mapInstances[0].jumpTo).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("عرض جغرافیایی"), {
      target: { value: "34.1234567" },
    });
    fireEvent.change(screen.getByLabelText("طول جغرافیایی"), {
      target: { value: "52.7654321" },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      latitude: 34.123457,
      longitude: 52.765432,
    });
    expect(mapInstances[0].jumpTo).not.toHaveBeenCalled();
  });

  it("synchronizes external controlled updates and cleans up MapLibre", async () => {
    const onChange = vi.fn();
    const result = render(
      <PropertyLocationPicker onChange={onChange} value={null} />,
    );
    await waitFor(() => expect(mapInstances).toHaveLength(1));

    result.rerender(
      <PropertyLocationPicker
        onChange={onChange}
        value={{ latitude: 35.123456, longitude: 50.654321 }}
      />,
    );

    expect(markerInstances[0].position).toEqual({
      lat: 35.123456,
      lng: 50.654321,
    });
    expect(mapInstances[0].jumpTo).toHaveBeenCalledWith({
      center: [50.654321, 35.123456],
    });
    expect(onChange).not.toHaveBeenCalled();

    result.unmount();
    expect(markerInstances[0].remove).toHaveBeenCalledOnce();
    expect(mapInstances[0].remove).toHaveBeenCalledOnce();
  });

  it("keeps OSM provider details outside the picker", () => {
    const pickerSource = readFileSync(
      resolve(process.cwd(), "components/property/PropertyLocationPicker.tsx"),
      "utf8",
    );

    expect(pickerSource).not.toContain("tile.openstreetmap.org");
    expect(pickerSource).not.toContain("OpenStreetMap contributors");
  });
});
