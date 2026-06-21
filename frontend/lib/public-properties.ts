export type PublicInventoryMode = "NamedRooms" | "TypeBasedInventory";
export type PublicPropertyView =
  | "CourtyardView"
  | "GardenView"
  | "CityView"
  | "MountainView"
  | "DesertView";

export interface PublicImage {
  id: number;
  url: string;
  altText: string | null;
  caption: string | null;
  tag: string | null;
  isCover: boolean;
}

export interface PublicRoomType {
  id: number;
  name: string;
  englishName: string | null;
  description: string;
  basePrice: number | null;
  availabilityPrice: number | null;
  displayPrice: number | null;
  availabilityStatus: "Available" | "Unavailable" | "OnRequest" | null;
  inventoryMode: PublicInventoryMode;
  totalInventory: number;
  maxAdults: number;
  maxChildren: number;
  notes: string | null;
  floorNumber: number | null;
  stairCount: number | null;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  bedInformation: string[];
  images: PublicImage[];
  amenities: { id: number; name: string; category: string }[];
}

export interface PublicRoomTypeSummary {
  id: number;
  name: string;
  maxAdults: number;
  maxChildren: number;
  totalInventory: number;
  displayPrice: number | null;
}

export interface PublicProperty {
  id: number;
  name: string;
  englishName: string | null;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
  city: string;
  country: string;
  address: string;
  description: string;
  shortDescription: string;
  coverImageUrl: string | null;
  status: "Approved";
  propertyType: string;
  inventoryMode: PublicInventoryMode;
  checkInTime: string | null;
  checkOutTime: string | null;
  latitude: number | null;
  longitude: number | null;
  hasElevator: boolean;
  isWheelchairAccessible: boolean | null;
  hasGroundFloorRoom: boolean | null;
  hasAccessibleBathroom: boolean | null;
  isInstantBooking: boolean;
  startingPrice: number | null;
  matchingRoomTypesCount: number;
  matchingRoomTypes: PublicRoomTypeSummary[];
  guestFitStatus: string;
  availabilitySummary: string;
  availabilityStatusSummary: "Available" | "OnRequest" | "Unknown";
  freeChildAgeLimit: number | null;
  maxFreeChildren: number | null;
  images: PublicImage[];
  descriptionSections: {
    sectionType: "PropertyIntroduction" | "ImportantNotes";
    title: string;
    content: string;
    sortOrder: number;
  }[];
  commonAreas: {
    id: number;
    name: string;
    description: string | null;
    sortOrder: number;
  }[];
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
  views: PublicPropertyView[];
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
  return price === null ? "قیمت ثبت نشده" : `${new Intl.NumberFormat("fa-IR").format(price)} تومان / شب`;
}
