"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import {
  AvailabilityResponse,
  AvailabilityStatus,
  AmenityCategoryResponse,
  AmenityResponse,
  apiRequest,
  BedTypeResponse,
  getToken,
  InventoryMode,
  NearbyPlaceCategory,
  NearbyPlaceResponse,
  PropertyAmenityResponse,
  PropertyCommonAreaResponse,
  PropertyCompletionResponse,
  PropertyDescriptionSectionResponse,
  PropertyInventoryResponse,
  propertyTypes,
  PropertyResponse,
  PropertyImageResponse,
  PropertyViewResponse,
  PropertyViewType,
  PropertyType,
  RoomResponse,
  RoomTypeResponse,
  toPropertyPayload,
} from "@/lib/owner-api";

dayjs.extend(jalaliday);

const steps = [
  "اطلاعات پایه",
  "اطلاعات ساختمان",
  "مدل اقامت",
  "موجودی و قیمت",
  "امکانات",
  "تصاویر",
  "توضیحات",
  "مکان‌های نزدیک",
  "بازبینی",
];

const defaultNearbyPlaces = [
  "Railway Station",
  "Bus Terminal",
  "Airport",
  "City Center",
  "Hospital",
];

const propertyViewOptions: PropertyViewType[] = [
  "CourtyardView",
  "GardenView",
  "CityView",
  "MountainView",
  "DesertView",
];

const propertyViewLabels: Record<PropertyViewType, string> = {
  CourtyardView: "Courtyard View",
  GardenView: "Garden View",
  CityView: "City View",
  MountainView: "Mountain View",
  DesertView: "Desert View",
};

interface AccommodationDraft {
  id: number;
  name: string;
  englishName: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  totalInventory: number;
  basePrice: string;
  bedConfigurations: { bedTypeId: number; quantity: number }[];
  amenityIds: number[];
  notes: string;
  floorNumber: number | null;
  stairCount: number | null;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  roomTypeId?: number;
  roomId?: number;
}

interface ImageDraft {
  url: string;
  tag: string;
  accommodationId?: number;
  imageId?: number;
}

interface CommonAreaDraft {
  name: string;
  description: string;
}

interface NearbyPlaceDraft {
  title: string;
  drivingMinutes: string;
  walkingMinutes: string;
  isDefault: boolean;
}

interface InventoryBulkDraft {
  roomTypeId: string;
  startDate: string;
  endDate: string;
  availableCount: number;
}

interface WizardData {
  name: string;
  englishName: string;
  type: PropertyType;
  city: string;
  address: string;
  totalArea: string;
  floors: number;
  hasElevator: boolean;
  isWheelchairAccessible: boolean;
  hasGroundFloorRoom: boolean;
  hasAccessibleBathroom: boolean;
  inventoryMode: InventoryMode;
  selectedAmenityIds: number[];
  coverImage: string;
  propertyImages: ImageDraft[];
  roomImages: ImageDraft[];
  propertyDescription: string;
  additionalNotes: string;
  commonAreas: CommonAreaDraft[];
  views: PropertyViewType[];
  nearbyPlaces: NearbyPlaceDraft[];
}

const initialData: WizardData = {
  name: "",
  englishName: "",
  type: "TraditionalHouse",
  city: "Kashan",
  address: "",
  totalArea: "",
  floors: 1,
  hasElevator: false,
  isWheelchairAccessible: false,
  hasGroundFloorRoom: false,
  hasAccessibleBathroom: false,
  inventoryMode: "NamedRooms",
  selectedAmenityIds: [],
  coverImage: "",
  propertyImages: [{ url: "", tag: "gallery" }],
  roomImages: [{ url: "", tag: "room" }],
  propertyDescription: "",
  additionalNotes: "",
  commonAreas: [{ name: "", description: "" }],
  views: [],
  nearbyPlaces: [{ title: "", drivingMinutes: "", walkingMinutes: "", isDefault: false }],
};

const emptyAccommodation = {
  name: "",
  englishName: "",
  description: "",
  maxAdults: 2,
  maxChildren: 0,
  totalInventory: 1,
  basePrice: "",
  bedConfigurations: [] as { bedTypeId: number; quantity: number }[],
  amenityIds: [] as number[],
  notes: "",
  floorNumber: null as number | null,
  stairCount: null as number | null,
  hasWindow: null as boolean | null,
  hasPrivateBathroom: null as boolean | null,
};

function isoFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const initialInventoryBulk: InventoryBulkDraft = {
  roomTypeId: "",
  startDate: isoFromToday(0),
  endDate: isoFromToday(30),
  availableCount: 1,
};

const availabilityLabels: Record<AvailabilityStatus, string> = {
  Available: "موجود",
  Unavailable: "ناموجود",
  OnRequest: "نیازمند استعلام",
};

const inputClass = "w-full rounded-lg border border-ink/20 bg-white px-3 py-2";
const cardClass = "rounded-xl border border-ink/10 bg-white p-5 shadow-sm";

function compact(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function compactCommonAreas(values: CommonAreaDraft[]) {
  return values.filter((area) => area.name.trim());
}

function compactNearbyPlaces(values: NearbyPlaceDraft[]) {
  return values.filter((place) => place.title.trim());
}

function compactImages(values: ImageDraft[]) {
  return values.filter((image) => image.url.trim());
}

function nearbyCategory(title: string): NearbyPlaceCategory {
  const normalized = title.toLocaleLowerCase();
  if (normalized.includes("station") || normalized.includes("terminal") || normalized.includes("airport")) return "Transport";
  if (normalized.includes("bazaar") || normalized.includes("market")) return "Market";
  if (normalized.includes("square") || normalized.includes("center")) return "Landmark";
  if (normalized.includes("garden") || normalized.includes("house")) return "Attraction";
  return "Other";
}

interface PropertyWizardProps {
  mode: "create" | "edit";
  propertyId?: number;
  isAdmin?: boolean;
  onDone?: (property: PropertyResponse) => void;
}

export function PropertyWizard({ mode, propertyId, isAdmin = false, onDone }: PropertyWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialData);
  const [accommodations, setAccommodations] = useState<AccommodationDraft[]>([]);
  const [accommodation, setAccommodation] = useState(emptyAccommodation);
  const [inventoryBulk, setInventoryBulk] = useState<InventoryBulkDraft>(initialInventoryBulk);
  const [inventoryMonth, setInventoryMonth] = useState(dayjs().format("YYYY-MM"));
  const [inventoryData, setInventoryData] = useState<PropertyInventoryResponse | null>(null);
  const availability = { roomTypeId: "", startDate: "", endDate: "", price: "", originalPrice: "", availableCount: 0, status: "Available" as AvailabilityStatus, minNightsOverride: "" };
  const setAvailabilityRows = (_rows: AvailabilityResponse[]) => undefined;
  const [amenityCategories, setAmenityCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [amenitiesLoading, setAmenitiesLoading] = useState(true);
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [completion, setCompletion] = useState<PropertyCompletionResponse | null>(null);
  const [adminStatus, setAdminStatus] = useState("PendingReview");
  const [adminOwnerId, setAdminOwnerId] = useState("");
  const [coverImageId, setCoverImageId] = useState<number | null>(null);
  const [descriptionIds, setDescriptionIds] = useState<Partial<Record<string, number>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    Promise.all([
      apiRequest<AmenityCategoryResponse[]>("/amenity-categories"),
      apiRequest<AmenityResponse[]>("/amenities"),
      apiRequest<BedTypeResponse[]>("/bed-types"),
    ])
      .then(([categories, items, beds]) => {
        setAmenityCategories(categories);
        setAmenities(items);
        setBedTypes(beds);
      })
      .catch(() => setError("Amenities could not be loaded. You can continue and try again later."))
      .finally(() => setAmenitiesLoading(false));
  }, [router]);

  useEffect(() => {
    if (mode !== "edit" || !propertyId) return;
    setLoading(true);
    setError("");
    Promise.all([
      apiRequest<PropertyResponse>(isAdmin ? `/admin/properties/${propertyId}` : `/owner/properties/${propertyId}`),
      apiRequest<RoomTypeResponse[]>(`/owner/properties/${propertyId}/room-types`),
      apiRequest<PropertyCompletionResponse>(`/owner/properties/${propertyId}/completion`),
      apiRequest<PropertyDescriptionSectionResponse[]>(`/owner/properties/${propertyId}/descriptions`),
      apiRequest<PropertyImageResponse[]>(`/owner/properties/${propertyId}/images`),
      apiRequest<PropertyAmenityResponse[]>(`/owner/properties/${propertyId}/amenities`),
      apiRequest<PropertyCommonAreaResponse[]>(`/owner/properties/${propertyId}/common-areas`),
      apiRequest<NearbyPlaceResponse[]>(`/owner/properties/${propertyId}/nearby-places`),
      apiRequest<PropertyViewResponse[]>(`/owner/properties/${propertyId}/views`),
    ])
      .then(async ([propertyResult, roomTypeResult, completionResult, descriptionResult, imageResult, amenityResult, commonAreaResult, nearbyResult, viewResult]) => {
        setProperty(propertyResult);
        setAdminStatus(propertyResult.status);
        setAdminOwnerId(String(propertyResult.ownerId));
        setCompletion(completionResult);
        setCoverImageId(imageResult.find((image) => image.isCover)?.id ?? null);
        setDescriptionIds(Object.fromEntries(descriptionResult.map((section) => [section.sectionType, section.id])));
        const roomEntries = await Promise.all(roomTypeResult.map(async (roomType) => [
          roomType,
          propertyResult.inventoryMode === "NamedRooms" ? await apiRequest<RoomResponse[]>(`/owner/room-types/${roomType.id}/rooms`) : [],
        ] as const));
        setAccommodations(roomEntries.map(([roomType, rooms], index) => {
          const room = rooms[0];
          return {
            id: room?.id ?? roomType.id ?? index + 1,
            name: room?.name ?? roomType.name,
            englishName: room?.englishName ?? roomType.englishName ?? "",
            description: room?.description ?? roomType.description ?? "",
            maxAdults: roomType.maxAdults,
            maxChildren: roomType.maxChildren,
            totalInventory: roomType.totalInventory,
            basePrice: roomType.basePrice == null ? "" : String(roomType.basePrice),
            bedConfigurations: roomType.bedConfigurations.map((bed) => ({ bedTypeId: bed.bedTypeId, quantity: bed.quantity })),
            amenityIds: roomType.amenities.map((amenity) => amenity.amenityId),
            notes: room?.notes ?? "",
            floorNumber: room?.floorNumber ?? null,
            stairCount: room?.stairCount ?? null,
            hasWindow: room?.hasWindow ?? null,
            hasPrivateBathroom: room?.hasPrivateBathroom ?? null,
            roomTypeId: roomType.id,
            roomId: room?.id,
          };
        }));
        setInventoryBulk((current) => ({ ...current, roomTypeId: current.roomTypeId || roomTypeResult[0]?.id.toString() || "" }));
        const intro = descriptionResult.find((section) => section.sectionType === "PropertyIntroduction");
        const notes = descriptionResult.find((section) => section.sectionType === "ImportantNotes");
        update("name", propertyResult.name);
        update("englishName", propertyResult.englishName ?? "");
        update("type", propertyResult.type);
        update("city", propertyResult.city);
        update("address", propertyResult.address);
        update("totalArea", propertyResult.totalAreaM2 == null ? "" : String(propertyResult.totalAreaM2));
        update("floors", propertyResult.floorsCount ?? 1);
        update("hasElevator", propertyResult.hasElevator);
        update("isWheelchairAccessible", Boolean(propertyResult.isWheelchairAccessible));
        update("hasGroundFloorRoom", Boolean(propertyResult.hasGroundFloorRoom));
        update("hasAccessibleBathroom", Boolean(propertyResult.hasAccessibleBathroom));
        update("inventoryMode", propertyResult.inventoryMode);
        update("selectedAmenityIds", amenityResult.map((amenity) => amenity.amenityId));
        update("coverImage", imageResult.find((image) => image.isCover)?.url ?? "");
        const propertyImageDrafts: ImageDraft[] = imageResult
          .filter((image) => !image.isCover && !image.roomTypeId && !image.roomId)
          .map((image) => ({ url: image.url, tag: image.tag ?? "", imageId: image.id }));
        const roomImageDrafts: ImageDraft[] = imageResult
          .filter((image) => image.roomTypeId || image.roomId)
          .map((image) => ({ url: image.url, tag: image.tag ?? "", imageId: image.id, accommodationId: image.roomId ?? image.roomTypeId ?? undefined }));
        update("propertyImages", [...propertyImageDrafts, { url: "", tag: "gallery" }]);
        update("roomImages", [...roomImageDrafts, { url: "", tag: "room" }]);
        update("propertyDescription", intro?.content ?? propertyResult.description ?? "");
        update("additionalNotes", notes?.content ?? "");
        update("commonAreas", commonAreaResult.length ? commonAreaResult.map((area) => ({ name: area.name, description: area.description ?? "" })) : [{ name: "", description: "" }]);
        update("nearbyPlaces", nearbyResult.length ? nearbyResult.filter((place) => place.isActive).map((place) => ({ title: place.title, drivingMinutes: place.drivingMinutes == null ? "" : String(place.drivingMinutes), walkingMinutes: place.walkingMinutes == null ? "" : String(place.walkingMinutes), isDefault: place.isDefault })) : [{ title: "", drivingMinutes: "", walkingMinutes: "", isDefault: false }]);
        update("views", viewResult.map((view) => view.viewType));
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [isAdmin, mode, propertyId]);

  useEffect(() => {
    if (!property?.id || step !== 3) return;
    loadInventoryMonth().catch((caught: Error) => setError(caught.message));
  }, [inventoryMonth, property?.id, step]);

  const selectedAmenities = useMemo(
    () => amenities.filter((item) => data.selectedAmenityIds.includes(item.id)),
    [amenities, data.selectedAmenityIds],
  );
  const propertyAmenityOptions = amenities.filter((item) => item.scope !== "RoomType");
  const roomAmenityOptions = amenities.filter((item) => item.scope !== "Property");

  const completionItems = [
    { label: "اطلاعات پایه", complete: Boolean(data.name.trim() && data.city.trim() && data.address.trim()) },
    { label: "اطلاعات ساختمان", complete: data.floors > 0 },
    { label: "مدل اقامت", complete: accommodations.length > 0 },
    { label: "امکانات", complete: data.selectedAmenityIds.length > 0 },
    { label: "تصاویر", complete: Boolean(data.coverImage.trim() || compactImages(data.propertyImages).length || compactImages(data.roomImages).length) },
    { label: "توضیحات", complete: Boolean(data.propertyDescription.trim()) },
    { label: "مکان‌های نزدیک", complete: compactNearbyPlaces(data.nearbyPlaces).length > 0 },
  ];

  function update<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((current) => ({ ...current, [key]: value }));
  }

  function validateCurrentStep() {
    if (step === 0 && (!data.name.trim() || !data.englishName.trim() || !data.city.trim() || !data.address.trim())) {
      return "نام فارسی، نام انگلیسی، شهر و نشانی را کامل کنید.";
    }
    if (step === 1 && data.floors < 1) {
      return "Floors must be at least 1.";
    }
    if (step === 2 && accommodations.length === 0) {
      return `حداقل یک ${data.inventoryMode === "NamedRooms" ? "اتاق نام‌دار" : "نوع اتاق"} اضافه کنید.`;
    }
    if (step === 6 && !data.propertyDescription.trim()) {
      return "پیش از ادامه، توضیحات اقامتگاه را وارد کنید.";
    }
    return "";
  }

  async function nextStep() {
    const validationError = validateCurrentStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const savedProperty = await saveCurrentStep();
      const propertyId = savedProperty?.id ?? property?.id;
      if (propertyId) {
        setCompletion(await apiRequest<PropertyCompletionResponse>(`/owner/properties/${propertyId}/completion`));
      }
      setStep((current) => Math.min(current + 1, steps.length - 1));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This step could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  function addAccommodation() {
    if (!accommodation.name.trim() || !accommodation.englishName.trim()) {
      setError("نام فارسی و انگلیسی اتاق را وارد کنید.");
      return;
    }
    setAccommodations((current) => [
      ...current,
      {
        ...accommodation,
        id: Date.now(),
        name: accommodation.name.trim(),
        totalInventory: data.inventoryMode === "NamedRooms" ? 1 : Math.max(1, accommodation.totalInventory),
      },
    ]);
    setAccommodation(emptyAccommodation);
    setError("");
  }

  function changeInventoryMode(mode: InventoryMode) {
    if (mode !== data.inventoryMode) {
      if (accommodations.some((item) => item.roomTypeId)) {
        setError("The accommodation model cannot be changed after rooms have been saved.");
        return;
      }
      update("inventoryMode", mode);
      setAccommodations([]);
      setAccommodation(emptyAccommodation);
    }
  }

  function updateCommonArea(index: number, patch: Partial<CommonAreaDraft>) {
    const values = [...data.commonAreas];
    values[index] = { ...values[index], ...patch };
    update("commonAreas", values);
  }

  function updateNearbyPlace(index: number, patch: Partial<NearbyPlaceDraft>) {
    const values = [...data.nearbyPlaces];
    values[index] = { ...values[index], ...patch };
    update("nearbyPlaces", values);
  }

  function updateImageList(key: "propertyImages" | "roomImages", index: number, patch: Partial<ImageDraft>) {
    const values = [...data[key]];
    values[index] = { ...values[index], ...patch };
    update(key, values);
  }

  function addImageField(key: "propertyImages" | "roomImages") {
    update(key, [...data[key], { url: "", tag: key === "roomImages" ? "room" : "gallery" }]);
  }

  function propertyPayload(description = property?.description ?? "") {
    return toPropertyPayload({
      name: data.name,
      englishName: data.englishName,
      description,
      address: data.address,
      city: data.city,
      type: data.type,
      inventoryMode: data.inventoryMode,
      checkInTime: "14:00",
      checkOutTime: "11:00",
      totalAreaM2: data.totalArea === "" ? null : Number(data.totalArea),
      floorsCount: data.floors,
      stairCount: null,
      hasElevator: data.hasElevator,
      isWheelchairAccessible: data.isWheelchairAccessible,
      hasGroundFloorRoom: data.hasGroundFloorRoom,
      hasAccessibleBathroom: data.hasAccessibleBathroom,
    });
  }

  async function saveProperty(description = property?.description ?? "") {
    const payload = propertyPayload(description);
    const saved = await apiRequest<PropertyResponse>(
      property && isAdmin ? `/admin/properties/${property.id}` : property ? `/owner/properties/${property.id}` : "/owner/properties",
      {
        method: property ? "PUT" : "POST",
        body: JSON.stringify(property && isAdmin ? {
          ownerId: Number(adminOwnerId) || property.ownerId,
          destinationId: property.destinationId,
          name: payload.name,
          englishName: payload.englishName,
          description: payload.description,
          seoTitle: property.seoTitle,
          seoDescription: property.seoDescription,
          address: payload.address,
          city: payload.city,
          country: payload.country,
          status: adminStatus,
          type: payload.type,
          inventoryMode: payload.inventoryMode,
          checkInTime: payload.checkInTime,
          checkOutTime: payload.checkOutTime,
        } : payload),
      },
    );
    setProperty(saved);
    if (isAdmin) {
      setAdminStatus(saved.status);
      setAdminOwnerId(String(saved.ownerId));
    }
    return saved;
  }

  async function setAdminPropertyStatus(status: string) {
    if (!property) return;
    setLoading(true);
    setError("");
    try {
      const saved = await apiRequest<PropertyResponse>(`/admin/properties/${property.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setProperty(saved);
      setAdminStatus(saved.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "وضعیت اقامتگاه ذخیره نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function saveAccommodations(propertyId: number) {
    const saved = [...accommodations];
    for (let index = 0; index < saved.length; index += 1) {
      const item = saved[index];
      const roomType = await apiRequest<RoomTypeResponse>(item.roomTypeId ? `/owner/room-types/${item.roomTypeId}` : `/owner/properties/${propertyId}/room-types`, {
        method: item.roomTypeId ? "PUT" : "POST",
        body: JSON.stringify({
          name: item.name,
          englishName: item.englishName,
          description: item.description || `${item.name} at ${data.name}`,
          maxAdults: item.maxAdults,
          maxChildren: item.maxChildren,
          totalInventory: data.inventoryMode === "NamedRooms" ? 1 : item.totalInventory,
          inventoryMode: data.inventoryMode,
          basePrice: item.basePrice === "" ? null : Number(item.basePrice),
          bedConfigurations: item.bedConfigurations,
          amenityIds: item.amenityIds,
          isActive: true,
        }),
      });
      let roomId: number | undefined;
      if (data.inventoryMode === "NamedRooms" && !item.roomId) {
        const room = await apiRequest<RoomResponse>(`/owner/room-types/${roomType.id}/rooms`, {
          method: "POST",
          body: JSON.stringify({
            name: item.name,
            englishName: item.englishName,
            description: item.description || null,
            notes: item.notes || null,
            floorNumber: item.floorNumber,
            stairCount: item.stairCount,
            hasWindow: item.hasWindow,
            hasPrivateBathroom: item.hasPrivateBathroom,
          }),
        });
        roomId = room.id;
      }
      saved[index] = { ...item, roomTypeId: roomType.id, roomId: item.roomId ?? roomId };
    }
    setAccommodations(saved);
    setInventoryBulk((current) => ({ ...current, roomTypeId: current.roomTypeId || saved.find((item) => item.roomTypeId)?.roomTypeId?.toString() || "" }));
  }

  async function loadInventoryMonth() {
    if (!property?.id) return;
    const rows = await apiRequest<PropertyInventoryResponse>(
      `/owner/properties/${property.id}/inventory?month=${encodeURIComponent(inventoryMonth)}`,
    );
    setInventoryData(rows);
  }

  function maxInventory(roomTypeId: number) {
    const roomType = inventoryData?.roomTypes.find((item) => item.roomTypeId === roomTypeId);
    if (!roomType) return 0;
    return roomType.inventoryMode === "NamedRooms" ? 1 : roomType.totalInventory;
  }

  function clampInventory(roomTypeId: number, value: number) {
    const max = maxInventory(roomTypeId);
    return Math.min(Math.max(0, value), max);
  }

  async function applyBulkInventory() {
    if (!property?.id) return;
    setLoading(true);
    setError("");
    try {
      const roomTypeId = inventoryBulk.roomTypeId ? Number(inventoryBulk.roomTypeId) : null;
      const count = roomTypeId ? clampInventory(roomTypeId, inventoryBulk.availableCount) : Math.max(0, inventoryBulk.availableCount);
      const rows = await apiRequest<PropertyInventoryResponse>(`/owner/properties/${property.id}/inventory/bulk`, {
        method: "POST",
        body: JSON.stringify({
          roomTypeId,
          startDate: inventoryBulk.startDate,
          endDate: inventoryBulk.endDate,
          availableCount: count,
        }),
      });
      setInventoryData(rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "موجودی ذخیره نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function saveInventoryCell(roomTypeId: number, date: string, availableCount: number) {
    if (!property?.id) return;
    const count = clampInventory(roomTypeId, availableCount);
    setInventoryData((current) => current && {
      ...current,
      roomTypes: current.roomTypes.map((roomType) => roomType.roomTypeId === roomTypeId
        ? {
            ...roomType,
            days: roomType.days.map((day) => day.date === date
              ? { ...day, roomTypeId, availableCount: count, status: count === 0 ? "Unavailable" : "Available" }
              : day),
          }
        : roomType),
    });
    try {
      const row = await apiRequest<{ availabilityId: number | null; roomTypeId: number; date: string; availableCount: number; status: AvailabilityStatus }>(
        `/owner/properties/${property.id}/inventory/cell`,
        {
          method: "POST",
          body: JSON.stringify({ roomTypeId, date, availableCount: count }),
        },
      );
      setInventoryData((current) => current && {
        ...current,
        roomTypes: current.roomTypes.map((roomType) => roomType.roomTypeId === roomTypeId
          ? {
              ...roomType,
              days: roomType.days.map((day) => day.date === date ? row : day),
            }
          : roomType),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "موجودی ذخیره نشد.");
      await loadInventoryMonth();
    }
  }

  async function oldLoadAvailabilityRowsUnused() {
    return;
  }

  async function saveAvailability() {
    if (!availability.roomTypeId) {
      setError("ابتدا نوع اتاق را انتخاب کنید.");
      return;
    }
    if (!availability.price) {
      setError("قیمت را وارد کنید.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const rows = await apiRequest<AvailabilityResponse[]>(`/owner/room-types/${availability.roomTypeId}/availability`, {
        method: "POST",
        body: JSON.stringify({
          startDate: availability.startDate,
          endDate: availability.endDate,
          price: Number(availability.price),
          originalPrice: availability.originalPrice === "" ? null : Number(availability.originalPrice),
          availableCount: availability.status === "Unavailable" ? 0 : availability.availableCount,
          status: availability.status,
          minNightsOverride: availability.minNightsOverride === "" ? null : Number(availability.minNightsOverride),
        }),
      });
      setAvailabilityRows(rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "موجودی و قیمت ذخیره نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function saveImages(propertyId: number) {
    if (data.coverImage.trim()) {
      const response = await apiRequest<PropertyImageResponse>(coverImageId ? `/owner/property-images/${coverImageId}` : `/owner/properties/${propertyId}/images`, {
        method: coverImageId ? "PUT" : "POST",
        body: JSON.stringify({ url: data.coverImage.trim(), tag: "cover", sortOrder: 0, isCover: true, isGallery: true }),
      });
      setCoverImageId(response.id);
    }

    for (const key of ["propertyImages", "roomImages"] as const) {
      const images = [...data[key]];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        if (!image.url.trim()) continue;
        const accommodation = accommodations.find((item) => item.id === image.accommodationId);
        const response = await apiRequest<PropertyImageResponse>(image.imageId ? `/owner/property-images/${image.imageId}` : `/owner/properties/${propertyId}/images`, {
          method: image.imageId ? "PUT" : "POST",
          body: JSON.stringify({
            url: image.url.trim(),
            tag: image.tag.trim() || null,
            roomTypeId: key === "roomImages" ? accommodation?.roomTypeId ?? null : null,
            roomId: key === "roomImages" ? accommodation?.roomId ?? null : null,
            sortOrder: index + 1,
            isCover: false,
            isGallery: true,
          }),
        });
        images[index] = { ...image, imageId: response.id };
      }
      update(key, images);
    }
  }

  async function saveDescriptions(propertyId: number) {
    const sections = [
      { sectionType: "PropertyIntroduction", title: "Property Introduction", content: data.propertyDescription.trim(), sortOrder: 0 },
      { sectionType: "ImportantNotes", title: "Important Notes", content: data.additionalNotes.trim(), sortOrder: 1 },
    ] as const;

    const ids = { ...descriptionIds };
    for (const section of sections) {
      if (!section.content) continue;
      const id = ids[section.sectionType];
      const response = await apiRequest<PropertyDescriptionSectionResponse>(id ? `/owner/property-descriptions/${id}` : `/owner/properties/${propertyId}/descriptions`, {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(section),
      });
      ids[section.sectionType] = response.id;
    }
    await apiRequest(`/owner/properties/${propertyId}/common-areas`, {
      method: "PUT",
      body: JSON.stringify({
        commonAreas: compactCommonAreas(data.commonAreas).map((area, index) => ({
          name: area.name.trim(),
          description: area.description.trim() || null,
          sortOrder: index,
        })),
      }),
    });
    setDescriptionIds(ids);
    await saveProperty(data.propertyDescription.trim());
  }

  async function saveNearbyPlaces(propertyId: number) {
    const existing = await apiRequest<NearbyPlaceResponse[]>(`/owner/properties/${propertyId}/nearby-places`);
    const desired = compactNearbyPlaces(data.nearbyPlaces).map((place) => ({
      title: place.title.trim(),
      drivingMinutes: place.drivingMinutes === "" ? null : Number(place.drivingMinutes),
      walkingMinutes: place.walkingMinutes === "" ? null : Number(place.walkingMinutes),
      isDefault: place.isDefault,
      isCustom: !place.isDefault,
    }));
    const desiredTitles = new Set(desired.map((place) => place.title.toLocaleLowerCase()));
    for (const place of desired) {
      const found = existing.find((item) => item.title.toLocaleLowerCase() === place.title.toLocaleLowerCase());
      const payload = { ...place, category: nearbyCategory(place.title), distanceInMeters: null, description: null, latitude: null, longitude: null, isActive: true };
      await apiRequest<NearbyPlaceResponse>(found ? `/owner/nearby-places/${found.id}` : `/owner/properties/${propertyId}/nearby-places`, {
        method: found ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
    }
    for (const place of existing.filter((item) => item.isActive && !desiredTitles.has(item.title.toLocaleLowerCase()))) {
      await apiRequest<NearbyPlaceResponse>(`/owner/nearby-places/${place.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...place, isActive: false }),
      });
    }
  }

  async function saveCurrentStep() {
    if (step === 0) return saveProperty("");
    if (!property) throw new Error("Save basic information first.");
    if (step === 1) return saveProperty(property.description);
    if (step === 2) {
      await saveProperty(property.description);
      await saveAccommodations(property.id);
    }
    if (step === 3) return property;
    if (step === 4) {
      await apiRequest<PropertyAmenityResponse[]>(`/owner/properties/${property.id}/amenities`, { method: "PUT", body: JSON.stringify({ amenityIds: data.selectedAmenityIds }) });
      await apiRequest(`/owner/properties/${property.id}/views`, { method: "PUT", body: JSON.stringify({ views: data.views }) });
    }
    if (step === 5) await saveImages(property.id);
    if (step === 6) await saveDescriptions(property.id);
    if (step === 7) await saveNearbyPlaces(property.id);
    return property;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (property) {
      onDone?.(property);
      if (!onDone) router.push(isAdmin ? `/admin/properties/${property.id}` : `/owner/properties/${property.id}`);
    }
  }

  const namedRooms = data.inventoryMode === "NamedRooms";

  return (
    <div>
      <div className="mb-6" dir="rtl">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <span>{mode === "edit" ? "ویرایش" : "ثبت"} · مرحله {step + 1} از {steps.length}</span>
          <span>{steps[step]}</span>
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((label, index) => (
            <button
              aria-label={label}
              className={`h-2 rounded-full ${index <= step ? "bg-ink" : "bg-ink/15"}`}
              key={label}
              onClick={() => index < step && setStep(index)}
              title={label}
              type="button"
            />
          ))}
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {property && <p className="mb-4 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">پیش‌نویس اقامتگاه #{property.id} ذخیره شده است. هر مرحله پس از تکمیل ذخیره می‌شود.</p>}

      {isAdmin && property && (
        <section className={`${cardClass} mb-5 grid gap-4`}>
          <div>
            <h2 className="text-xl font-black text-slate-950">کنترل‌های مدیریت</h2>
            <p className="mt-1 text-sm text-slate-500">وضعیت و مالک اقامتگاه در همین ویزارد ذخیره می‌شود.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">وضعیت
              <select className={inputClass} onChange={(event) => setAdminStatus(event.target.value)} value={adminStatus}>
                <option value="Draft">پیش‌نویس</option>
                <option value="PendingReview">در انتظار تایید</option>
                <option value="Approved">تایید شده</option>
                <option value="Rejected">رد شده</option>
                <option value="Suspended">تعلیق شده</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">شناسه مالک
              <input className={inputClass} min="1" onChange={(event) => setAdminOwnerId(event.target.value)} type="number" value={adminOwnerId} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={loading} onClick={() => setAdminPropertyStatus("Approved")} type="button">تایید</button>
            <button className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50" disabled={loading} onClick={() => setAdminPropertyStatus("Rejected")} type="button">رد</button>
            <button className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-bold text-amber-700 disabled:opacity-50" disabled={loading} onClick={() => setAdminPropertyStatus("Suspended")} type="button">تعلیق</button>
          </div>
        </section>
      )}

      <form dir="rtl" onSubmit={submit}>
        {step === 0 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">اطلاعات پایه</h2>
            <label className="grid gap-1 text-sm font-semibold">نام فارسی اقامتگاه<input className={inputClass} onChange={(event) => update("name", event.target.value)} required value={data.name} /></label>
            <label className="grid gap-1 text-sm font-semibold">نام انگلیسی اقامتگاه<input className={inputClass} dir="ltr" onChange={(event) => update("englishName", event.target.value)} placeholder="Khademi Traditional House" required value={data.englishName} /></label>
            <label className="grid gap-1 text-sm font-semibold">نوع اقامتگاه<select className={inputClass} onChange={(event) => update("type", event.target.value as PropertyType)} value={data.type}>{propertyTypes.map((type) => <option key={type} value={type}>{type.replace(/([A-Z])/g, " $1").trim()}</option>)}</select></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">شهر<input className={inputClass} onChange={(event) => update("city", event.target.value)} required value={data.city} /></label>
              <label className="grid gap-1 text-sm font-semibold">نشانی<input className={inputClass} onChange={(event) => update("address", event.target.value)} required value={data.address} /></label>
            </div>
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-ink/25 bg-ink/[0.03] text-center text-sm text-ink/55">انتخاب موقعیت روی نقشه در نسخه بعدی اضافه می‌شود.</div>
          </section>
        )}

        {step === 1 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">اطلاعات ساختمان</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1 text-sm font-semibold">مساحت کل (مترمربع)<input className={inputClass} min="0" onChange={(event) => update("totalArea", event.target.value)} type="number" value={data.totalArea} /></label>
              <label className="grid gap-1 text-sm font-semibold">تعداد طبقات<input className={inputClass} min="1" onChange={(event) => update("floors", Number(event.target.value))} type="number" value={data.floors} /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-lg border border-ink/15 p-4 font-semibold"><input checked={data.isWheelchairAccessible} onChange={(event) => update("isWheelchairAccessible", event.target.checked)} type="checkbox" />مناسب ویلچر هست؟</label>
              <label className="flex items-center gap-3 rounded-lg border border-ink/15 p-4 font-semibold"><input checked={data.hasElevator} onChange={(event) => update("hasElevator", event.target.checked)} type="checkbox" />آسانسور دارد؟</label>
              <label className="flex items-center gap-3 rounded-lg border border-ink/15 p-4 font-semibold"><input checked={data.hasGroundFloorRoom} onChange={(event) => update("hasGroundFloorRoom", event.target.checked)} type="checkbox" />اتاق همکف دارد؟</label>
              <label className="flex items-center gap-3 rounded-lg border border-ink/15 p-4 font-semibold"><input checked={data.hasAccessibleBathroom} onChange={(event) => update("hasAccessibleBathroom", event.target.checked)} type="checkbox" />سرویس بهداشتی مناسب افراد کم‌توان دارد؟</label>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="grid gap-5">
            <div className={cardClass}>
              <h2 className="mb-3 text-2xl font-bold">مدل اقامت</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["NamedRooms", "TypeBasedInventory"] as InventoryMode[]).map((mode) => (
                  <button className={`rounded-xl border p-4 text-left ${data.inventoryMode === mode ? "border-ink bg-ink text-white" : "border-ink/20 bg-white"}`} key={mode} onClick={() => changeInventoryMode(mode)} type="button">
                    <strong>{mode === "NamedRooms" ? "اتاق‌های نام‌دار" : "موجودی بر اساس نوع اتاق"}</strong>
                    <span className="mt-1 block text-sm opacity-75">{mode === "NamedRooms" ? "اتاق‌های مستقل مانند شاه‌عباسی، ترنج یا پنج‌دری." : "نوع‌هایی مانند دابل، سه‌تخته یا سوئیت خانوادگی."}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`${cardClass} grid gap-4`}>
              <h3 className="text-xl font-bold">{namedRooms ? "افزودن اتاق نام‌دار" : "افزودن نوع اتاق"}</h3>
              <label className="grid gap-1 text-sm font-semibold">نام فارسی<input className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, name: event.target.value })} placeholder={namedRooms ? "شاه‌عباسی" : "اتاق دابل"} value={accommodation.name} /></label>
              <label className="grid gap-1 text-sm font-semibold">نام انگلیسی<input className={inputClass} dir="ltr" onChange={(event) => setAccommodation({ ...accommodation, englishName: event.target.value })} placeholder={namedRooms ? "Shah Abbasi" : "Double Room"} value={accommodation.englishName} /></label>
              <label className="grid gap-1 text-sm font-semibold">توضیحات<textarea className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, description: event.target.value })} rows={2} value={accommodation.description} /></label>
              <div className="grid gap-3 rounded-lg border border-ink/10 p-4"><strong>ترکیب تخت‌ها</strong>{accommodation.bedConfigurations.map((bed, index) => <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]" key={index}><select className={inputClass} onChange={(event) => { const beds = [...accommodation.bedConfigurations]; beds[index] = { ...bed, bedTypeId: Number(event.target.value) }; setAccommodation({ ...accommodation, bedConfigurations: beds }); }} value={bed.bedTypeId}><option value={0}>نوع تخت</option>{bedTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select><input className={inputClass} min="1" onChange={(event) => { const beds = [...accommodation.bedConfigurations]; beds[index] = { ...bed, quantity: Number(event.target.value) }; setAccommodation({ ...accommodation, bedConfigurations: beds }); }} type="number" value={bed.quantity} /><button className="text-sm font-bold text-red-700" onClick={() => setAccommodation({ ...accommodation, bedConfigurations: accommodation.bedConfigurations.filter((_, candidate) => candidate !== index) })} type="button">حذف</button></div>)}<button className="justify-self-start rounded-lg border border-ink/20 px-3 py-2 text-sm font-bold" onClick={() => setAccommodation({ ...accommodation, bedConfigurations: [...accommodation.bedConfigurations, { bedTypeId: bedTypes[0]?.id ?? 0, quantity: 1 }] })} type="button">افزودن تخت</button></div>
              <div className="grid gap-3 rounded-lg border border-ink/10 p-4">
                <strong>امکانات اتاق</strong>
                {amenityCategories.map((category) => {
                  const categoryAmenities = roomAmenityOptions.filter((item) => item.amenityCategoryId === category.id);
                  if (categoryAmenities.length === 0) return null;
                  return <fieldset className="grid gap-2" key={category.id}><legend className="text-sm font-bold text-ink/60">{category.name}</legend><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{categoryAmenities.map((amenity) => <label className="flex items-center gap-2 rounded-lg border border-ink/10 p-3 text-sm" key={amenity.id}><input checked={accommodation.amenityIds.includes(amenity.id)} onChange={(event) => setAccommodation({ ...accommodation, amenityIds: event.target.checked ? [...accommodation.amenityIds, amenity.id] : accommodation.amenityIds.filter((id) => id !== amenity.id) })} type="checkbox" />{amenity.name}</label>)}</div></fieldset>;
                })}
              </div>
              {namedRooms && <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">یادداشت کوتاه<input className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, notes: event.target.value })} placeholder="ورودی اتاق ۱۸ پله رو به پایین دارد" value={accommodation.notes} /></label><label className="grid gap-1 text-sm font-semibold">طبقه<input className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, floorNumber: event.target.value === "" ? null : Number(event.target.value) })} type="number" value={accommodation.floorNumber ?? ""} /></label><label className="grid gap-1 text-sm font-semibold">تعداد پله<input className={inputClass} min="0" onChange={(event) => setAccommodation({ ...accommodation, stairCount: event.target.value === "" ? null : Number(event.target.value) })} type="number" value={accommodation.stairCount ?? ""} /></label><label className="grid gap-1 text-sm font-semibold">پنجره<select className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, hasWindow: event.target.value === "" ? null : event.target.value === "true" })} value={accommodation.hasWindow == null ? "" : String(accommodation.hasWindow)}><option value="">نامشخص</option><option value="true">دارد</option><option value="false">ندارد</option></select></label><label className="grid gap-1 text-sm font-semibold">سرویس بهداشتی اختصاصی<select className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, hasPrivateBathroom: event.target.value === "" ? null : event.target.value === "true" })} value={accommodation.hasPrivateBathroom == null ? "" : String(accommodation.hasPrivateBathroom)}><option value="">نامشخص</option><option value="true">دارد</option><option value="false">ندارد</option></select></label></div>}
              <div className={`grid gap-4 ${namedRooms ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
                <label className="grid gap-1 text-sm font-semibold">حداکثر بزرگسال<input className={inputClass} min="1" onChange={(event) => setAccommodation({ ...accommodation, maxAdults: Number(event.target.value) })} type="number" value={accommodation.maxAdults} /></label>
                <label className="grid gap-1 text-sm font-semibold">حداکثر کودک<input className={inputClass} min="0" onChange={(event) => setAccommodation({ ...accommodation, maxChildren: Number(event.target.value) })} type="number" value={accommodation.maxChildren} /></label>
                {!namedRooms && <label className="grid gap-1 text-sm font-semibold">تعداد موجودی<input className={inputClass} min="1" onChange={(event) => setAccommodation({ ...accommodation, totalInventory: Number(event.target.value) })} type="number" value={accommodation.totalInventory} /></label>}
                <label className="grid gap-1 text-sm font-semibold">قیمت پایه<input className={inputClass} min="0" onChange={(event) => setAccommodation({ ...accommodation, basePrice: event.target.value })} type="number" value={accommodation.basePrice} /></label>
              </div>
              <button className="rounded-lg bg-ink px-4 py-3 font-bold text-white" onClick={addAccommodation} type="button">{namedRooms ? "افزودن اتاق" : "افزودن نوع اتاق"}</button>
            </div>
            <div className="grid gap-2">
              {accommodations.map((item) => <div className="flex items-center justify-between rounded-lg border border-ink/15 bg-white p-3" key={item.id}><span><strong>{item.name}</strong>{!namedRooms && ` - ${item.totalInventory} واحد`}</span>{item.roomTypeId ? <span className="text-sm font-semibold text-green-700">ذخیره شده</span> : <button className="text-sm font-semibold text-red-700" onClick={() => setAccommodations((current) => current.filter((candidate) => candidate.id !== item.id))} type="button">حذف</button>}</div>)}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className={`${cardClass} grid gap-5`}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">موجودی اتاق‌ها</h2>
                <p className="text-sm text-ink/60">برای هر روز فقط تعداد موجودی را مدیریت کنید. قیمت در بخش جداگانه اضافه می‌شود.</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-ink/20 px-3 py-2 text-sm font-bold" onClick={() => setInventoryMonth(dayjs(inventoryMonth).subtract(1, "month").format("YYYY-MM"))} type="button">ماه قبل</button>
                <strong>{dayjs(`${inventoryMonth}-01`).calendar("jalali").locale("fa").format("MMMM YYYY")}</strong>
                <button className="rounded-lg border border-ink/20 px-3 py-2 text-sm font-bold" onClick={() => setInventoryMonth(dayjs(inventoryMonth).add(1, "month").format("YYYY-MM"))} type="button">ماه بعد</button>
              </div>
            </div>

            <div className="grid gap-4 rounded-xl border border-ink/10 bg-slate-50 p-4 md:grid-cols-5">
              <label className="grid gap-1 text-sm font-semibold">نوع اتاق
                <select className={inputClass} onChange={(event) => setInventoryBulk({ ...inventoryBulk, roomTypeId: event.target.value })} value={inventoryBulk.roomTypeId}>
                  <option value="">همه اتاق‌ها</option>
                  {inventoryData?.roomTypes.map((item) => <option key={item.roomTypeId} value={item.roomTypeId}>{item.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">تاریخ شروع<input className={inputClass} onChange={(event) => setInventoryBulk({ ...inventoryBulk, startDate: event.target.value })} type="date" value={inventoryBulk.startDate} /></label>
              <label className="grid gap-1 text-sm font-semibold">تاریخ پایان<input className={inputClass} onChange={(event) => setInventoryBulk({ ...inventoryBulk, endDate: event.target.value })} type="date" value={inventoryBulk.endDate} /></label>
              <label className="grid gap-1 text-sm font-semibold">تعداد موجود<input className={inputClass} min="0" max={inventoryBulk.roomTypeId ? maxInventory(Number(inventoryBulk.roomTypeId)) : undefined} onChange={(event) => setInventoryBulk({ ...inventoryBulk, availableCount: Number(event.target.value) })} type="number" value={inventoryBulk.availableCount} /></label>
              <button className="self-end rounded-lg bg-ink px-4 py-3 font-bold text-white disabled:opacity-60" disabled={loading || !property?.id} onClick={applyBulkInventory} type="button">اعمال</button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
              <table className="min-w-max text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="sticky right-0 z-10 min-w-44 bg-slate-50 p-3 text-right">اتاق</th>
                    {inventoryData?.roomTypes[0]?.days.map((day) => {
                      const jalaliDay = dayjs(day.date).calendar("jalali").locale("fa");
                      const today = day.date === dayjs().format("YYYY-MM-DD");
                      return <th className={`min-w-14 p-2 text-center ${today ? "text-blue-700" : ""}`} key={day.date}>{jalaliDay.format("D")}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {inventoryData?.roomTypes.map((roomType) => (
                    <tr className="border-t" key={roomType.roomTypeId}>
                      <th className="sticky right-0 z-10 bg-white p-3 text-right align-middle">
                        <span className="font-bold">{roomType.name}</span>
                        <span className="mt-1 block text-xs text-slate-400">{roomType.inventoryMode === "NamedRooms" ? "۰/۱" : `حداکثر ${roomType.totalInventory}`}</span>
                      </th>
                      {roomType.days.map((day) => {
                        const isUnavailable = day.availableCount === 0;
                        const isOnRequest = day.status === "OnRequest";
                        return (
                          <td className={`border-r border-slate-100 p-1 ${isOnRequest ? "bg-amber-50" : isUnavailable ? "bg-red-50" : "bg-green-50"}`} key={day.date}>
                            <input
                              aria-label={`${roomType.name} ${day.date}`}
                              className={`h-10 w-12 rounded-md border text-center font-bold ${isUnavailable ? "border-red-200 text-red-700" : "border-green-200 text-green-700"}`}
                              max={roomType.inventoryMode === "NamedRooms" ? 1 : roomType.totalInventory}
                              min="0"
                              onBlur={(event) => saveInventoryCell(roomType.roomTypeId, day.date, Number(event.target.value))}
                              onChange={(event) => {
                                const nextCount = clampInventory(roomType.roomTypeId, Number(event.target.value));
                                setInventoryData((current) => current && {
                                  ...current,
                                  roomTypes: current.roomTypes.map((candidate) => candidate.roomTypeId === roomType.roomTypeId
                                    ? { ...candidate, days: candidate.days.map((candidateDay) => candidateDay.date === day.date ? { ...candidateDay, availableCount: nextCount } : candidateDay) }
                                    : candidate),
                                });
                              }}
                              type="number"
                              value={day.availableCount}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!inventoryData?.roomTypes.length && <p className="p-5 text-center text-sm text-slate-500">ابتدا نوع اتاق را ذخیره کنید.</p>}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className={`${cardClass} grid gap-5`}>
            <div><h2 className="text-2xl font-bold">امکانات</h2><p className="text-sm text-ink/60">امکانات موجود در اقامتگاه را انتخاب کنید.</p></div>
            {amenitiesLoading && <p>در حال بارگذاری امکانات...</p>}
            {!amenitiesLoading && amenityCategories.map((category) => {
              const categoryAmenities = propertyAmenityOptions.filter((item) => item.amenityCategoryId === category.id);
              return <fieldset className="grid gap-2" key={category.id}><legend className="mb-2 text-lg font-bold">{category.name}</legend><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{categoryAmenities.map((amenity) => <label className="flex items-center gap-2 rounded-lg border border-ink/10 p-3" key={amenity.id}><input checked={data.selectedAmenityIds.includes(amenity.id)} onChange={(event) => update("selectedAmenityIds", event.target.checked ? [...data.selectedAmenityIds, amenity.id] : data.selectedAmenityIds.filter((id) => id !== amenity.id))} type="checkbox" />{amenity.name}</label>)}</div></fieldset>;
            })}
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-lg font-bold">چشم‌انداز اقامتگاه</legend>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {propertyViewOptions.map((view) => (
                  <label className="flex items-center gap-2 rounded-lg border border-ink/10 p-3" key={view}>
                    <input checked={data.views.includes(view)} onChange={(event) => update("views", event.target.checked ? [...data.views, view] : data.views.filter((item) => item !== view))} type="checkbox" />
                    {propertyViewLabels[view]}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        )}

        {step === 5 && (
          <section className={`${cardClass} grid gap-5`}>
            <div><h2 className="text-2xl font-bold">تصاویر</h2><p className="text-sm text-ink/60">تا زمان فعال شدن آپلود، نشانی اینترنتی تصویر را وارد کنید.</p></div>
            <label className="grid gap-1 text-sm font-semibold">نشانی تصویر کاور<input className={inputClass} dir="ltr" onChange={(event) => update("coverImage", event.target.value)} type="url" value={data.coverImage} /></label>
            <ImageFields images={data.propertyImages} label="تصویر اقامتگاه" onAdd={() => addImageField("propertyImages")} onChange={(index, value) => updateImageList("propertyImages", index, value)} />
            <ImageFields accommodations={accommodations} images={data.roomImages} label="تصویر اتاق" onAdd={() => addImageField("roomImages")} onChange={(index, value) => updateImageList("roomImages", index, value)} />
          </section>
        )}

        {step === 6 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">توضیحات</h2>
            <label className="grid gap-1 text-sm font-semibold">توضیحات اقامتگاه<textarea className={inputClass} onChange={(event) => update("propertyDescription", event.target.value)} required rows={5} value={data.propertyDescription} /></label>
            <div className="grid gap-3 rounded-lg border border-ink/10 p-4">
              <strong>فضاهای مشترک</strong>
              {data.commonAreas.map((area, index) => (
                <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]" key={index}>
                  <input className={inputClass} onChange={(event) => updateCommonArea(index, { name: event.target.value })} placeholder="حیاط مرکزی" value={area.name} />
                  <input className={inputClass} onChange={(event) => updateCommonArea(index, { description: event.target.value })} placeholder="توضیح اختیاری" value={area.description} />
                  <button className="text-sm font-bold text-red-700" onClick={() => update("commonAreas", data.commonAreas.filter((_, candidate) => candidate !== index))} type="button">حذف</button>
                </div>
              ))}
              <button className="justify-self-start rounded-lg border border-ink/20 px-3 py-2 text-sm font-bold" onClick={() => update("commonAreas", [...data.commonAreas, { name: "", description: "" }])} type="button">افزودن فضای مشترک</button>
            </div>
            <label className="grid gap-1 text-sm font-semibold">نکات تکمیلی<textarea className={inputClass} onChange={(event) => update("additionalNotes", event.target.value)} rows={4} value={data.additionalNotes} /></label>
          </section>
        )}

        {step === 7 && (
          <section className={`${cardClass} grid gap-5`}>
            <div><h2 className="text-2xl font-bold">مکان‌های نزدیک</h2><p className="text-sm text-ink/60">مکان‌های مهم کاشان یا نقاط دلخواه نزدیک اقامتگاه را انتخاب کنید.</p></div>
            <div className="grid gap-2 sm:grid-cols-2">{defaultNearbyPlaces.map((place) => <button className="rounded-lg border border-ink/10 p-3 text-left font-semibold" key={place} onClick={() => update("nearbyPlaces", data.nearbyPlaces.some((item) => item.title === place) ? data.nearbyPlaces.filter((item) => item.title !== place) : [...data.nearbyPlaces, { title: place, drivingMinutes: "", walkingMinutes: "", isDefault: true }])} type="button">{data.nearbyPlaces.some((item) => item.title === place) ? "انتخاب شده: " : ""}{place}</button>)}</div>
            <div className="grid gap-3">
              {data.nearbyPlaces.map((place, index) => (
                <div className="grid gap-2 rounded-lg border border-ink/10 p-3 sm:grid-cols-[1fr_140px_140px_auto]" key={index}>
                  <input className={inputClass} disabled={place.isDefault} onChange={(event) => updateNearbyPlace(index, { title: event.target.value })} placeholder="مکان دلخواه" value={place.title} />
                  <input className={inputClass} min="0" onChange={(event) => updateNearbyPlace(index, { drivingMinutes: event.target.value })} placeholder="دقیقه با خودرو" type="number" value={place.drivingMinutes} />
                  <input className={inputClass} min="0" onChange={(event) => updateNearbyPlace(index, { walkingMinutes: event.target.value })} placeholder="دقیقه پیاده" type="number" value={place.walkingMinutes} />
                  <button className="text-sm font-bold text-red-700" onClick={() => update("nearbyPlaces", data.nearbyPlaces.filter((_, candidate) => candidate !== index))} type="button">حذف</button>
                </div>
              ))}
              <button className="justify-self-start rounded-lg border border-ink/20 px-3 py-2 text-sm font-semibold" onClick={() => update("nearbyPlaces", [...data.nearbyPlaces, { title: "", drivingMinutes: "", walkingMinutes: "", isDefault: false }])} type="button">افزودن مکان دلخواه</button>
            </div>
          </section>
        )}

        {step === 8 && (
          <section className="grid gap-5">
            <div className={cardClass}><h2 className="text-2xl font-bold">بازبینی</h2><p className="mt-1 text-sm text-ink/60">میزان تکمیل اطلاعات: {completion?.completionPercentage ?? 0}٪</p></div>
            <div className={cardClass}>
              <h3 className="mb-3 text-lg font-bold">وضعیت تکمیل</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {completionItems.map((item) => {
                  const sectionKey: Record<string, string> = { "اطلاعات پایه": "basic info", "اطلاعات ساختمان": "building info", "مدل اقامت": "room types", "امکانات": "amenities", "تصاویر": "images", "توضیحات": "descriptions", "مکان‌های نزدیک": "nearby places" };
                  const complete = completion ? completion.completedSections.includes(sectionKey[item.label]) : item.complete;
                  return (
                  <div className="flex items-center justify-between rounded-lg border border-ink/10 px-3 py-2" key={item.label}>
                    <span>{item.label}</span>
                    <span className={`text-sm font-bold ${complete ? "text-green-700" : "text-amber-700"}`}>
                      {complete ? "تکمیل" : "اختیاری / ناقص"}
                    </span>
                  </div>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ReviewCard title="اطلاعات پایه" lines={[data.name, `${data.type} در ${data.city}`, data.address]} />
              <ReviewCard title="ساختمان و دسترسی" lines={[data.totalArea ? `${data.totalArea} مترمربع` : "مساحت ثبت نشده", `${data.floors} طبقه`, data.hasElevator ? "آسانسور دارد" : "آسانسور ندارد", data.isWheelchairAccessible ? "مناسب ویلچر" : "", data.hasGroundFloorRoom ? "اتاق همکف" : "", data.hasAccessibleBathroom ? "سرویس مناسب افراد کم‌توان" : ""]} />
              <ReviewCard title={namedRooms ? "اتاق‌های نام‌دار" : "انواع اتاق"} lines={accommodations.map((item) => namedRooms ? item.name : `${item.name} (${item.totalInventory})`)} />
              <ReviewCard title="امکانات" lines={selectedAmenities.map((item) => item.name)} />
              <ReviewCard title="تصاویر" lines={[data.coverImage && "تصویر کاور", `${compactImages(data.propertyImages).length} تصویر اقامتگاه`, `${compactImages(data.roomImages).length} تصویر اتاق`].filter(Boolean)} />
              <ReviewCard title="فضاهای مشترک" lines={compactCommonAreas(data.commonAreas).map((area) => area.name)} />
              <ReviewCard title="چشم‌اندازها" lines={data.views.map((view) => propertyViewLabels[view])} />
              <ReviewCard title="مکان‌های نزدیک" lines={compactNearbyPlaces(data.nearbyPlaces).map((place) => place.title)} />
            </div>
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">جزئیات اقامتگاه، اتاق‌ها، امکانات، تصاویر، توضیحات و مکان‌های نزدیک ذخیره شده‌اند.</p>
          </section>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button className="rounded-lg border border-ink/20 px-5 py-3 font-bold disabled:opacity-40" disabled={step === 0 || loading} onClick={() => { setError(""); setStep((current) => Math.max(0, current - 1)); }} type="button">بازگشت</button>
          {step < steps.length - 1 ? <button className="rounded-lg bg-ink px-5 py-3 font-bold text-white disabled:opacity-60" disabled={loading} onClick={nextStep} type="button">{loading ? "در حال ذخیره..." : "ذخیره و ادامه"}</button> : <button className="rounded-lg bg-ink px-5 py-3 font-bold text-white disabled:opacity-60" disabled={loading || !property} type="submit">پایان</button>}
        </div>
      </form>
    </div>
  );
}

function UrlFields({ label, values, onChange, onAdd, addLabel = "Add another URL" }: { label: string; values: string[]; onChange: (index: number, value: string) => void; onAdd: () => void; addLabel?: string }) {
  return <div className="grid gap-2"><span className="text-sm font-semibold">{label}</span>{values.map((value, index) => <input className={inputClass} key={index} onChange={(event) => onChange(index, event.target.value)} placeholder={label} type={label.includes("URL") ? "url" : "text"} value={value} />)}<button className="justify-self-start rounded-lg border border-ink/20 px-3 py-2 text-sm font-semibold" onClick={onAdd} type="button">{addLabel}</button></div>;
}

function ImageFields({ label, images, accommodations, onChange, onAdd }: { label: string; images: ImageDraft[]; accommodations?: AccommodationDraft[]; onChange: (index: number, patch: Partial<ImageDraft>) => void; onAdd: () => void }) {
  return <div className="grid gap-3"><span className="text-sm font-semibold">{label}s</span>{images.map((image, index) => <div className="grid gap-2 rounded-lg border border-ink/10 p-3 sm:grid-cols-2" key={index}><input className={inputClass} onChange={(event) => onChange(index, { url: event.target.value })} placeholder={`${label} URL`} type="url" value={image.url} /><input className={inputClass} onChange={(event) => onChange(index, { tag: event.target.value })} placeholder="Tag (room, exterior, bathroom...)" value={image.tag} />{accommodations && <select className={`${inputClass} sm:col-span-2`} onChange={(event) => onChange(index, { accommodationId: Number(event.target.value) || undefined })} value={image.accommodationId ?? ""}><option value="">Attach to the property</option>{accommodations.map((item) => <option key={item.id} value={item.id}>{item.roomId ? `Room: ${item.name}` : `Room type: ${item.name}`}</option>)}</select>}</div>)}<button className="justify-self-start rounded-lg border border-ink/20 px-3 py-2 text-sm font-semibold" onClick={onAdd} type="button">Add another image</button></div>;
}

function ReviewCard({ title, lines }: { title: string; lines: string[] }) {
  const visibleLines = lines.filter(Boolean);
  return <article className={cardClass}><h3 className="mb-2 text-lg font-bold">{title}</h3>{visibleLines.length ? <ul className="grid gap-1 text-sm text-ink/70">{visibleLines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : <p className="text-sm text-ink/50">موردی انتخاب نشده است.</p>}</article>;
}
