import { describe, expect, it } from "vitest";
import { mapProvider } from "@/lib/maps/map-provider";
import {
  fromMapPosition,
  toMapPosition,
} from "@/lib/maps/property-coordinates";

describe("map provider boundary", () => {
  it("provides the current OSM raster style and attribution", () => {
    expect(mapProvider.style.sources.osm).toEqual({
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    });
  });

  it("keeps MapLibre position order inside map helpers", () => {
    const coordinates = { latitude: 33.985, longitude: 51.41 };

    expect(toMapPosition(coordinates)).toEqual([51.41, 33.985]);
    expect(fromMapPosition({ lat: 33.985, lng: 51.41 })).toEqual(coordinates);
  });
});
