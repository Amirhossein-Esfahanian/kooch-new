export const propertyTypes = [
  "TraditionalHouse",
  "BoutiqueHotel",
  "EcoLodge",
  "Hotel",
  "Villa",
  "Apartment",
] as const;

export const inventoryModes = ["NamedRooms", "TypeBasedInventory"] as const;

export type PropertyType = (typeof propertyTypes)[number];
export type InventoryMode = (typeof inventoryModes)[number];

export interface PropertyResponse {
  id: number;
  ownerId: number;
  ownerName: string;
  ownerEmail: string;
  createdAtUtc: string;
  destinationId: number;
  destinationName: string;
  name: string;
  englishName: string | null;
  slug: string;
  description: string;
  seoTitle: string | null;
  seoDescription: string | null;
  address: string;
  city: string;
  country: string;
  status: string;
  type: PropertyType;
  inventoryMode: InventoryMode;
  checkInTime: string | null;
  checkOutTime: string | null;
  totalAreaM2: number | null;
  landAreaM2: number | null;
  floorsCount: number | null;
  stairCount: number | null;
  hasElevator: boolean;
  isWheelchairAccessible: boolean | null;
  hasGroundFloorRoom: boolean | null;
  hasAccessibleBathroom: boolean | null;
}

export type PropertyStatus = "Draft" | "PendingReview" | "Approved" | "Rejected" | "Suspended";
export type UserRole = "SuperAdmin" | "AdminAssistant" | "Owner" | "OwnerAssistant" | "Client";

export interface AdminDashboardResponse {
  totalProperties: number;
  pendingProperties: number;
  approvedProperties: number;
  totalUsers: number;
  totalOwners: number;
  pendingPropertyItems: PropertyResponse[];
}

export interface AdminUserResponse {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  role: UserRole;
  parentUserId: number | null;
  parentUserName: string | null;
  isActive: boolean;
  createdAtUtc: string;
}

export interface RoomTypeResponse {
  id: number;
  propertyId: number;
  name: string;
  englishName: string | null;
  slug: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  totalInventory: number;
  inventoryMode: InventoryMode;
  basePrice: number | null;
  isActive: boolean;
  bedConfigurations: RoomTypeBedResponse[];
  amenities: RoomTypeAmenityResponse[];
}

export interface BedTypeResponse {
  id: number;
  name: string;
  slug: string;
}

export function bedTypeLabel(slug: string, fallback: string) {
  const labels: Record<string, string> = {
    "single-bed": "تخت یک‌نفره",
    "double-bed": "تخت دابل",
    "queen-bed": "تخت کویین",
    "king-bed": "تخت کینگ",
    "twin-beds": "تخت تویین",
    "sofa-bed": "مبل تخت‌خواب‌شو",
    "traditional-floor-bedding": "رختخواب سنتی",
  };
  return labels[slug] ?? fallback;
}

export interface RoomTypeBedResponse {
  bedTypeId: number;
  bedTypeName: string;
  bedTypeSlug: string;
  quantity: number;
}

export interface RoomTypeAmenityResponse {
  amenityId: number;
  name: string;
  amenityCategoryId: number;
  categoryName: string;
}

export interface RoomResponse {
  id: number;
  roomTypeId: number;
  name: string;
  englishName: string | null;
  description: string | null;
  notes: string | null;
  floorNumber: number | null;
  stairCount: number | null;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  isActive: boolean;
}

export interface PropertyAmenityResponse {
  amenityId: number;
  name: string;
  amenityCategoryId: number;
  categoryName: string;
}

export type NearbyPlaceCategory = "Attraction" | "Transport" | "Landmark" | "Market" | "Other";
export type PropertyViewType =
  | "CourtyardView"
  | "GardenView"
  | "CityView"
  | "MountainView"
  | "DesertView";

export interface NearbyPlaceResponse {
  id: number;
  propertyId: number;
  title: string;
  category: NearbyPlaceCategory;
  distanceInMeters: number | null;
  walkingMinutes: number | null;
  drivingMinutes: number | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  isCustom: boolean;
  isActive: boolean;
}

export interface PropertyImageResponse {
  id: number;
  propertyId: number;
  roomTypeId: number | null;
  roomId: number | null;
  url: string;
  altText: string | null;
  caption: string | null;
  tag: string | null;
  sortOrder: number;
  isCover: boolean;
  isGallery: boolean;
}

export interface PropertyCommonAreaResponse {
  id: number;
  propertyId: number;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface PropertyViewResponse {
  viewType: PropertyViewType;
}

export type AvailabilityStatus = "Available" | "Unavailable" | "OnRequest";

export interface AvailabilityResponse {
  id: number;
  roomTypeId: number;
  date: string;
  price: number;
  originalPrice: number | null;
  availableCount: number;
  status: AvailabilityStatus;
  minNightsOverride: number | null;
}

export interface PropertyCompletionResponse {
  propertyId: number;
  completionPercentage: number;
  completedSections: string[];
  missingSections: string[];
}

export type PropertyDescriptionSectionType =
  | "PropertyIntroduction"
  | "ImportantNotes";

export interface PropertyDescriptionSectionResponse {
  id: number;
  propertyId: number;
  sectionType: PropertyDescriptionSectionType;
  title: string;
  content: string;
  sortOrder: number;
}

export interface AmenityCategoryResponse {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  icon: string | null;
  isActive: boolean;
}

export type AmenityScope = "Property" | "RoomType" | "Both";

export interface AmenityResponse {
  id: number;
  amenityCategoryId: number;
  categoryName: string;
  categorySlug: string;
  categorySortOrder: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  scope: AmenityScope;
  sortOrder: number;
}

export interface PropertyFormValues {
  name: string;
  englishName: string;
  description: string;
  address: string;
  city: string;
  type: PropertyType;
  inventoryMode: InventoryMode;
  checkInTime: string;
  checkOutTime: string;
  totalAreaM2?: number | null;
  landAreaM2?: number | null;
  floorsCount?: number | null;
  stairCount?: number | null;
  hasElevator?: boolean;
  isWheelchairAccessible?: boolean | null;
  hasGroundFloorRoom?: boolean | null;
  hasAccessibleBathroom?: boolean | null;
}

const tokenKey = "kooch_owner_token";
const userRoleKey = "kooch_user_role";
const userNameKey = "kooch_user_name";
export const workspaceKey = "kooch_workspace";
export type KoochWorkspace = "admin" | "owner" | "traveler";

export function getToken() {
  return typeof window === "undefined" ? null : localStorage.getItem(tokenKey);
}

export function setToken(token: string) {
  localStorage.setItem(tokenKey, token);
}

export function setAuthUser(role: string, fullName?: string) {
  localStorage.setItem(userRoleKey, role);
  if (fullName) localStorage.setItem(userNameKey, fullName);
}

export function getAuthRole() {
  return typeof window === "undefined" ? null : localStorage.getItem(userRoleKey);
}

export function getAuthName() {
  return typeof window === "undefined" ? null : localStorage.getItem(userNameKey);
}

export function setWorkspace(workspace: KoochWorkspace) {
  localStorage.setItem(workspaceKey, workspace);
}

export function getWorkspace() {
  return typeof window === "undefined" ? null : localStorage.getItem(workspaceKey);
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(userRoleKey);
  localStorage.removeItem(userNameKey);
  localStorage.removeItem(workspaceKey);
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    clearToken();
    throw new Error("Please log in again.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      body?.message ?? `Request failed with status ${response.status}.`,
    );
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

export function createSlug(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveDestinationId(city: string) {
  const normalizedCity = city.trim().toLocaleLowerCase();
  const destinationIds: Record<string, number> = {
    kashan: 1,
    کاشان: 1,
  };

  return destinationIds[normalizedCity] ?? 1;
}

export function toPropertyPayload(
  values: PropertyFormValues,
  destinationId?: number,
) {
  return {
    ...values,
    destinationId: destinationId ?? resolveDestinationId(values.city),
    country: "Iran",
    checkInTime: values.checkInTime || null,
    checkOutTime: values.checkOutTime || null,
  };
}
