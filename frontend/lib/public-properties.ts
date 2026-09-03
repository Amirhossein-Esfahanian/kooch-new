import type { RoomKind } from "@/lib/owner-api";

export type PublicInventoryMode = "NamedRooms" | "TypeBasedInventory";
export type PublicBreakfastOption = "NoBreakfast" | "Included" | "Paid";
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
  roomKind: RoomKind;
  roomKindCode: string;
  englishName: string | null;
  description: string;
  basePrice: number | null;
  availabilityPrice: number | null;
  displayPrice: number | null;
  availabilityStatus: "Available" | "Unavailable" | "OnRequest" | null;
  inventoryMode: PublicInventoryMode;
  totalInventory: number;
  activeRoomCount?: number;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
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
  roomKind: RoomKind;
  roomKindCode: string;
  maxAdults: number;
  maxChildren: number;
  totalInventory: number;
  displayPrice: number | null;
}

export interface PublicPromotion {
  id: number;
  title: string;
  publicDescription: string | null;
  internalDescription?: string | null;
  optionalIcon: string | null;
  badgeColor: string | null;
  minimumStayNights: number | null;
  minimumGuests: number | null;
  type: string;
  sortOrder: number;
  isActive: boolean;
}

export interface PublicPropertySettingOption {
  id: number;
  name: string;
  slug: string;
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
  breakfastOption: PublicBreakfastOption;
  breakfastPrice: number | null;
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
  promotions?: PublicPromotion[];
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
  settings: { id: number; name: string; slug: string }[];
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
  return price === null || price <= 0
    ? "قیمت پس از تعیین در تقویم"
    : `${new Intl.NumberFormat("fa-IR").format(price)} تومان / شب`;
}
