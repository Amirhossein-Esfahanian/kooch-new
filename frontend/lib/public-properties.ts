export type PublicInventoryMode = "NamedRooms" | "TypeBasedInventory";

export interface PublicRoom {
  id: number;
  name: string;
  description: string | null;
}

export interface PublicRoomType {
  id: number;
  name: string;
  description: string;
  basePrice: number | null;
  availabilityPrice: number | null;
  displayPrice: number | null;
  inventoryMode: PublicInventoryMode;
  totalInventory: number;
  namedRooms: PublicRoom[];
}

export interface PublicProperty {
  id: number;
  name: string;
  slug: string;
  city: string;
  address: string;
  description: string;
  coverImageUrl: string | null;
  status: "Approved";
  propertyType: string;
  inventoryMode: PublicInventoryMode;
  startingPrice: number | null;
  imageUrls: string[];
  amenities: { id: number; name: string; category: string }[];
  nearbyPlaces: {
    id: number;
    title: string;
    category: string;
    distanceInMeters: number | null;
    walkingMinutes: number | null;
    drivingMinutes: number | null;
    description: string | null;
  }[];
  roomTypes: PublicRoomType[];
}

export async function fetchPublicApi<T>(path: string): Promise<T> {
  const response = await fetch(`/api/backend${path}`);
  if (!response.ok) {
    throw new Error(response.status === 404 ? "Property not found." : "Could not load properties.");
  }
  return response.json();
}

export function formatPrice(price: number | null) {
  return price === null ? "Price unavailable" : `${new Intl.NumberFormat("en-US").format(price)} / night`;
}
