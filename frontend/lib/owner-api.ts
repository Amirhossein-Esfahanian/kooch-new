import {
  clearToken,
  getToken,
  isSessionRevokedResponse,
  notifySessionRevoked,
  ownerPropertyKey,
  setAuthUser,
  setToken,
} from "@/lib/auth-session";

export {
  clearToken,
  getToken,
  ownerPropertyKey,
  setAuthUser,
  setToken,
} from "@/lib/auth-session";

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
export type RoomKind =
  | "Single"
  | "Double"
  | "Twin"
  | "Triple"
  | "Quad"
  | "Family"
  | "Suite"
  | "JuniorSuite"
  | "Apartment"
  | "Villa"
  | "Dormitory"
  | "Other";
export type BreakfastOption = "NoBreakfast" | "Included" | "Paid";

export interface RoomKindCatalogResponse {
  value: number;
  code: string;
  titleFa: string;
  titleEn: string;
  displayOrder: number;
}

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
  latitude: number | null;
  longitude: number | null;
  status: string;
  type: PropertyType;
  inventoryMode: InventoryMode;
  checkInTime: string | null;
  checkOutTime: string | null;
  breakfastOption: BreakfastOption;
  breakfastPrice: number | null;
  totalAreaM2: number | null;
  landAreaM2: number | null;
  floorsCount: number | null;
  stairCount: number | null;
  hasElevator: boolean;
  isWheelchairAccessible: boolean | null;
  hasGroundFloorRoom: boolean | null;
  hasAccessibleBathroom: boolean | null;
  freeChildAgeLimit: number | null;
  maxFreeChildren: number | null;
  childPrice: number | null;
  extraGuestPrice: number | null;
}

export type PropertyStatus =
  | "Draft"
  | "PendingReview"
  | "Approved"
  | "Rejected"
  | "Suspended";
export type UserRole = "SuperAdmin" | "AdminAssistant" | "Client";
export type AdminPermissionKey =
  | "ManageUsers"
  | "ManageRoles"
  | "ManageProperties"
  | "ManageReservations"
  | "ManagePayments"
  | "ManageAvailability"
  | "ManageReviews"
  | "ManageSeo"
  | "ManageNotifications"
  | "ViewReports"
  | "ManageStaff"
  | "ManageSettings"
  | "ViewDashboard"
  | "ManageRooms"
  | "ManagePricing"
  | "ManageGuests"
  | "ManageAmenities";
export type PropertyUserStatus =
  | "Pending"
  | "Active"
  | "Suspended"
  | "Inactive";
export type PropertyUserRole =
  | "PropertyOwner"
  | "Manager"
  | "Reception"
  | "Accounting"
  | "Housekeeping"
  | "Custom";

export type PermissionGroup =
  | "Dashboard"
  | "Properties"
  | "Rooms"
  | "Pricing"
  | "Inventory"
  | "Bookings"
  | "Reviews"
  | "Users"
  | "Financial"
  | "Reports"
  | "Settings";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";

export type PermissionActions = Record<PermissionAction, boolean>;

export type PermissionMatrixValue = Record<string, PermissionActions>;

export interface PropertyPermissionGroupMetadata {
  key: PermissionGroup;
  label: string;
  supportedActions: PermissionAction[];
}

export interface PropertyPermissionActionMetadata {
  key: PermissionAction;
  label: string;
}

export interface PropertyPermissionMetadataResponse {
  groups: PropertyPermissionGroupMetadata[];
  actions: PropertyPermissionActionMetadata[];
  roleDefaults: Record<PropertyUserRole, PermissionMatrixValue>;
  actorAssignablePermissions: PermissionMatrixValue;
}

export type PropertyUserCandidateOutcome =
  | "CanContinue"
  | "AlreadyMember"
  | "Unavailable";

export interface PropertyUserCandidateResponse {
  outcome: PropertyUserCandidateOutcome;
  requiresUserCreation: boolean;
  maskedName: string | null;
}

export interface PropertyUserResponse {
  id: number;
  userId: number;
  propertyId: number;
  fullName: string;
  mobile: string | null;
  email: string;
  username: string;
  status: PropertyUserStatus;
  role: PropertyUserRole;
  isActive: boolean;
  passwordSetupRequired: boolean;
  canRemove: boolean;
  permissions: PermissionMatrixValue;
  lastLoginAtUtc?: string | null;
  lastActivityAtUtc?: string | null;
  createdAtUtc?: string | null;
  invitationAcceptedAtUtc?: string | null;
  temporarySetupLink?: string | null;
}

export type AuditAction =
  | "PriceChanged"
  | "InventoryChanged"
  | "RoomCreated"
  | "RoomDeleted"
  | "BookingConfirmed"
  | "BookingCancelled"
  | "BookingApproved"
  | "BookingExpired"
  | "PropertyOwnershipTransferred";

export interface AuditLogResponse {
  id: number;
  userId: number;
  user: string;
  action: AuditAction;
  propertyId: number | null;
  property: string | null;
  time: string;
  entity: string;
  entityId: number | null;
  entityName: string | null;
  description: string | null;
}

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
  permissions: AdminPermissionKey[];
  isActive: boolean;
  passwordSetupRequired: boolean;
  createdAtUtc: string;
  invitationAcceptedAtUtc?: string | null;
  temporarySetupLink?: string | null;
}

export interface AdminPropertyOwnerAccountResponse {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  isActive: boolean;
  passwordSetupRequired: boolean;
  temporarySetupLink?: string | null;
}

export interface AdminPropertyOwnerCandidateResponse {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  phoneNumber: string | null;
  email: string | null;
}

export interface AdminPropertyOwnerCandidatePageResponse {
  items: AdminPropertyOwnerCandidateResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  totalInventory: number;
  activeRoomCount?: number;
  inventoryMode: InventoryMode;
  roomKind: RoomKind;
  roomKindCode: string;
  basePrice: number | null;
  notes: string | null;
  floorNumber: number | null;
  stairCount: number | null;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  isActive: boolean;
  completion: RoomCompletionResponse;
  bedConfigurations: RoomTypeBedResponse[];
  amenities: RoomTypeAmenityResponse[];
}

export interface RoomCompletionResponse {
  isComplete: boolean;
  missingItems: string[];
  sections: RoomCompletionSectionResponse[];
}

export interface RoomCompletionSectionResponse {
  key: string;
  label: string;
  status: PropertyCompletionSectionStatus;
  missingItems: string[];
}

export type PromotionType =
  | "PercentageDiscount"
  | "FixedAmountDiscount"
  | "LastMinute"
  | "Informational";

export type PromotionSource = "Admin" | "Owner";

export type PromotionWeekday =
  | "Saturday"
  | "Sunday"
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday";

export interface PromotionRoomTypeResponse {
  id: number;
  name: string;
  roomKind: RoomKind;
  roomKindCode: string;
  basePrice: number | null;
}

export interface PromotionResponse {
  id: number;
  propertyId: number | null;
  propertyName: string;
  title: string;
  internalDescription: string | null;
  publicDescription: string | null;
  optionalIcon: string | null;
  badgeColor: string | null;
  minimumStayNights: number | null;
  minimumGuests: number | null;
  startDate: string;
  endDate: string;
  weekdays: PromotionWeekday[];
  type: PromotionType;
  percentage: number | null;
  amount: number | null;
  lastMinuteDays: number | null;
  sortOrder: number;
  isActive: boolean;
  isPublished: boolean;
  source: PromotionSource;
  sourcePromotionId: number | null;
  isLibraryTemplate: boolean;
  canEdit: boolean;
  createdByUserId: number | null;
  createdBy: string;
  createdAtUtc: string;
  roomTypes: PromotionRoomTypeResponse[];
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

export interface OwnerRoomResponse extends RoomResponse {
  roomKind: RoomKind;
  roomKindCode: string;
  inventoryMode: InventoryMode;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  basePrice: number | null;
  bedConfigurations: RoomTypeBedResponse[];
  amenities: RoomTypeAmenityResponse[];
}

export interface PropertyAmenityResponse {
  amenityId: number;
  name: string;
  amenityCategoryId: number;
  categoryName: string;
}

export type NearbyPlaceCategory =
  | "Attraction"
  | "Transport"
  | "Landmark"
  | "Market"
  | "Other";
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

export interface InventoryDayResponse {
  availabilityId: number | null;
  roomTypeId: number;
  date: string;
  availableCount: number;
  status: AvailabilityStatus;
}

export interface InventoryRoomTypeResponse {
  roomTypeId: number;
  name: string;
  roomKind: RoomKind;
  roomKindCode: string;
  inventoryMode: InventoryMode;
  totalInventory: number;
  days: InventoryDayResponse[];
}

export interface PropertyInventoryResponse {
  propertyId: number;
  month: string;
  startDate: string;
  endDate: string;
  roomTypes: InventoryRoomTypeResponse[];
}

export type PricingGuestType = "Iranian" | "Foreign";

export interface RoomDailyPriceResponse {
  id: number | null;
  roomTypeId: number;
  date: string;
  guestType: PricingGuestType;
  basePrice: number;
}

export interface RoomDailyPriceHistoryResponse {
  id: number;
  propertyId: number;
  roomId: number;
  roomName: string;
  guestType: PricingGuestType;
  affectedDateFrom: string;
  affectedDateTo: string;
  oldBasePrice: number;
  newBasePrice: number;
  oldChildPrice: number;
  newChildPrice: number;
  oldExtraGuestPrice: number;
  newExtraGuestPrice: number;
  changedByUserId: number;
  user: string;
  dateTime: string;
}

export interface PricingRoomTypeResponse {
  roomTypeId: number;
  name: string;
  roomKind: RoomKind;
  roomKindCode: string;
  days: RoomDailyPriceResponse[];
}

export interface PropertyPricingResponse {
  propertyId: number;
  startDate: string;
  endDate: string;
  guestType: PricingGuestType;
  roomTypes: PricingRoomTypeResponse[];
}

export interface CopyRoomDailyPriceRequest {
  sourceGuestType: PricingGuestType;
  destinationGuestType: PricingGuestType;
  items: { roomTypeId: number; date: string }[];
}

export interface PropertyCompletionResponse {
  propertyId: number;
  completionPercentage: number;
  healthStatus: "Ready" | "NeedsAttention" | "Incomplete";
  sections: PropertyCompletionSectionResponse[];
  warnings: string[];
  completedSections: string[];
  missingSections: string[];
  canActivate: boolean;
}

export type PropertyCompletionSectionStatus =
  | "Complete"
  | "Incomplete"
  | "NotStarted";

export interface PropertyCompletionSectionResponse {
  key: string;
  label: string;
  status: PropertyCompletionSectionStatus;
  missingItems: string[];
  actionTarget: string;
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
  breakfastOption: BreakfastOption;
  breakfastPrice: number | null;
  totalAreaM2?: number | null;
  landAreaM2?: number | null;
  floorsCount?: number | null;
  stairCount?: number | null;
  hasElevator?: boolean;
  isWheelchairAccessible?: boolean | null;
  hasGroundFloorRoom?: boolean | null;
  hasAccessibleBathroom?: boolean | null;
  freeChildAgeLimit?: number | null;
  maxFreeChildren?: number | null;
}



export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown = null,
    public readonly sessionRevoked = false,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    const sessionRevoked =
      isSessionRevokedResponse(response, body) || path === "/auth/me";
    const message =
      body?.message ??
      "\u0646\u0634\u0633\u062a \u0634\u0645\u0627 \u0645\u0646\u0642\u0636\u06cc \u0634\u062f\u0647 \u0627\u0633\u062a. \u0644\u0637\u0641\u0627\u064b \u062f\u0648\u0628\u0627\u0631\u0647 \u0648\u0627\u0631\u062f \u0634\u0648\u06cc\u062f.";

    if (sessionRevoked && getToken() === token) {
      notifySessionRevoked(message);
    }

    throw new ApiRequestError(message, response.status, body, sessionRevoked);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ApiRequestError(
      body?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      body,
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
