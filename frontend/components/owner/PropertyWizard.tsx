"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import {
  AmenityCategoryResponse,
  AmenityResponse,
  ApiRequestError,
  apiRequest,
  BreakfastOption,
  InventoryMode,
  NearbyPlaceCategory,
  NearbyPlaceResponse,
  PropertyAmenityResponse,
  PropertyCommonAreaResponse,
  PropertyCompletionResponse,
  PropertyDescriptionSectionResponse,
  PropertyImageResponse,
  propertyTypes,
  PropertyResponse,
  PropertyStatus,
  PropertyType,
  PropertyViewResponse,
  PropertyViewType,
  replacePropertyCommonAreas,
  resolveDestinationId,
  RoomTypeResponse,
} from "@/lib/owner-api";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import { PropertyImageManager } from "@/components/owner/PropertyImageManager";
import { PropertyCompletionCard } from "@/components/property/PropertyCompletionCard";
import {
  getPropertyFinancialWarnings,
  PricingSettingsWarning,
} from "@/components/pricing/PricingWarnings";
import { useSiteCurrencyLabel } from "@/lib/currency";
import {
  formatLocalizedAmount,
  rawLocalizedAmount,
} from "@/lib/localized-amount";
import { propertyCompletionHref } from "@/lib/property-completion";

const steps = [
  "اطلاعات پایه",
  "موقعیت",
  "ساختمان و دسترسی",
  "امکانات",
  "تصاویر",
  "توضیحات و فضاها",
  "مکان‌های نزدیک",
  "قوانین و زمان‌ها",
  "کودک و نفر اضافه",
  "تنظیمات سئو",
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
const propertyStatusOptions: PropertyStatus[] = [
  "Draft",
  "PendingReview",
  "Approved",
  "Rejected",
  "Suspended",
];

const propertyViewLabels: Record<PropertyViewType, string> = {
  CourtyardView: "نمای حیاط",
  GardenView: "نمای باغ",
  CityView: "نمای شهر",
  MountainView: "نمای کوه",
  DesertView: "نمای کویر",
};

const propertyTypeLabels: Record<PropertyType, string> = {
  TraditionalHouse: "خانه سنتی",
  BoutiqueHotel: "هتل بوتیک",
  EcoLodge: "بوم‌گردی",
  Hotel: "هتل",
  Villa: "ویلا",
  Apartment: "آپارتمان",
};

const statusLabels: Record<PropertyStatus, string> = {
  Draft: "پیش‌نویس",
  PendingReview: "در انتظار بررسی",
  Approved: "تایید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
};

interface CommonAreaDraft {
  id?: number;
  name: string;
  description: string;
}

interface NearbyPlaceDraft {
  id?: number;
  title: string;
  drivingMinutes: string;
  walkingMinutes: string;
  isDefault: boolean;
}

interface WizardData {
  name: string;
  englishName: string;
  type: PropertyType;
  city: string;
  address: string;
  latitude: string;
  longitude: string;
  totalArea: string;
  landArea: string;
  floors: string;
  hasElevator: boolean;
  isWheelchairAccessible: boolean;
  hasGroundFloorRoom: boolean;
  hasAccessibleBathroom: boolean;
  inventoryMode: InventoryMode;
  selectedAmenityIds: number[];
  propertyDescription: string;
  additionalNotes: string;
  commonAreas: CommonAreaDraft[];
  views: PropertyViewType[];
  nearbyPlaces: NearbyPlaceDraft[];
  checkInTime: string;
  checkOutTime: string;
  breakfastOption: BreakfastOption;
  breakfastPrice: string;
  freeChildAgeLimit: string;
  maxFreeChildren: string;
  childPrice: string;
  extraGuestPrice: string;
  seoTitle: string;
  seoDescription: string;
}

const initialData: WizardData = {
  name: "",
  englishName: "",
  type: "TraditionalHouse",
  city: "Kashan",
  address: "",
  latitude: "",
  longitude: "",
  totalArea: "",
  landArea: "",
  floors: "1",
  hasElevator: false,
  isWheelchairAccessible: false,
  hasGroundFloorRoom: false,
  hasAccessibleBathroom: false,
  inventoryMode: "NamedRooms",
  selectedAmenityIds: [],
  propertyDescription: "",
  additionalNotes: "",
  commonAreas: [{ name: "", description: "" }],
  views: [],
  nearbyPlaces: [
    { title: "", drivingMinutes: "", walkingMinutes: "", isDefault: false },
  ],
  checkInTime: "14:00",
  checkOutTime: "12:00",
  breakfastOption: "NoBreakfast",
  breakfastPrice: "",
  freeChildAgeLimit: "",
  maxFreeChildren: "",
  childPrice: "",
  extraGuestPrice: "",
  seoTitle: "",
  seoDescription: "",
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const cardClass =
  "rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm";
const choiceClass =
  "flex items-center gap-2 rounded-xl border border-border bg-background p-3 text-sm font-bold text-foreground transition hover:bg-muted";
const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";
interface PropertyWizardProps {
  mode: "create" | "edit";
  propertyId?: number;
  isAdmin?: boolean;
  onDone?: (property: PropertyResponse) => void;
}

interface CompletionSection {
  key: string;
  label: string;
  isComplete: boolean;
  missingItems: string[];
  recommendedMissingItems: string[];
  targetStepIndex: number;
}

function cleanCommonAreas(values: CommonAreaDraft[]) {
  return values.filter((area) => area.name.trim());
}

function cleanNearbyPlaces(values: NearbyPlaceDraft[]) {
  return values.filter((place) => place.title.trim());
}

function nearbyCategory(title: string): NearbyPlaceCategory {
  const normalized = title.toLocaleLowerCase();
  if (
    normalized.includes("station") ||
    normalized.includes("terminal") ||
    normalized.includes("airport")
  )
    return "Transport";
  if (normalized.includes("bazaar") || normalized.includes("market"))
    return "Market";
  if (normalized.includes("square") || normalized.includes("center"))
    return "Landmark";
  if (normalized.includes("garden") || normalized.includes("house"))
    return "Attraction";
  return "Other";
}

function boolLabel(value: boolean, label: string) {
  return value ? label : "";
}

export function PropertyWizard({
  mode,
  propertyId,
  isAdmin = false,
  onDone,
}: PropertyWizardProps) {
  const router = useRouter();
  const currencyLabel = useSiteCurrencyLabel();
  const {
    authenticated,
    loading: sessionLoading,
    workspaces,
  } = useAuthSession();
  const canLoadWorkspace =
    !sessionLoading &&
    authenticated &&
    workspaces.includes(isAdmin ? "admin" : "owner");
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(initialData);
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [adminStatus, setAdminStatus] =
    useState<PropertyStatus>("PendingReview");
  const [amenityCategories, setAmenityCategories] = useState<
    AmenityCategoryResponse[]
  >([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [allImages, setAllImages] = useState<PropertyImageResponse[]>([]);
  const [completion, setCompletion] =
    useState<PropertyCompletionResponse | null>(null);
  const [descriptionIds, setDescriptionIds] = useState<
    Partial<Record<string, number>>
  >({});
  const [loading, setLoading] = useState(false);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [booting, setBooting] = useState(mode === "edit");
  const [error, setError] = useState("");

  useEffect(() => {
    const requestedStep = Number(
      new URLSearchParams(window.location.search).get("step") ?? 0,
    );
    if (Number.isFinite(requestedStep) && requestedStep > 0) {
      setStep(Math.min(Math.max(requestedStep, 0), steps.length - 1));
    }
  }, []);

  useEffect(() => {
    if (!canLoadWorkspace) return;
    Promise.all([
      apiRequest<AmenityCategoryResponse[]>("/amenity-categories"),
      apiRequest<AmenityResponse[]>("/amenities"),
    ])
      .then(([categories, items]) => {
        setAmenityCategories(categories);
        setAmenities(items);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [canLoadWorkspace]);

  useEffect(() => {
    if (!canLoadWorkspace || mode !== "edit" || !propertyId) return;
    setBooting(true);
    Promise.all([
      apiRequest<PropertyResponse>(
        isAdmin
          ? `/admin/properties/${propertyId}`
          : `/owner/properties/${propertyId}`,
      ),
      apiRequest<PropertyCompletionResponse>(
        isAdmin
          ? `/admin/properties/${propertyId}/completion`
          : `/owner/properties/${propertyId}/completion`,
      ),
      apiRequest<PropertyDescriptionSectionResponse[]>(
        `/owner/properties/${propertyId}/descriptions`,
      ),
      apiRequest<PropertyImageResponse[]>(
        `/owner/properties/${propertyId}/images`,
      ),
      apiRequest<PropertyAmenityResponse[]>(
        `/owner/properties/${propertyId}/amenities`,
      ),
      apiRequest<PropertyCommonAreaResponse[]>(
        `/owner/properties/${propertyId}/common-areas`,
      ),
      apiRequest<NearbyPlaceResponse[]>(
        `/owner/properties/${propertyId}/nearby-places`,
      ),
      apiRequest<PropertyViewResponse[]>(
        `/owner/properties/${propertyId}/views`,
      ),
      apiRequest<RoomTypeResponse[]>(
        `/owner/properties/${propertyId}/room-types`,
      ).catch(() => []),
    ])
      .then(
        ([
          propertyResult,
          completionResult,
          descriptions,
          images,
          propertyAmenities,
          commonAreas,
          nearbyPlaces,
          views,
          roomTypeItems,
        ]) => {
          setProperty(propertyResult);
          setAllImages(images);
          setRoomTypes(roomTypeItems);
          setCompletion(completionResult);
          setAdminStatus(propertyResult.status as PropertyStatus);
          setDescriptionIds(
            Object.fromEntries(
              descriptions.map((section) => [section.sectionType, section.id]),
            ),
          );
          const intro = descriptions.find(
            (section) => section.sectionType === "PropertyIntroduction",
          );
          const notes = descriptions.find(
            (section) => section.sectionType === "ImportantNotes",
          );
          setData({
            name: propertyResult.name,
            englishName: propertyResult.englishName ?? "",
            type: propertyResult.type,
            city: propertyResult.city,
            address: propertyResult.address,
            latitude:
              propertyResult.latitude == null
                ? ""
                : String(propertyResult.latitude),
            longitude:
              propertyResult.longitude == null
                ? ""
                : String(propertyResult.longitude),
            totalArea:
              propertyResult.totalAreaM2 == null
                ? ""
                : String(propertyResult.totalAreaM2),
            landArea:
              propertyResult.landAreaM2 == null
                ? ""
                : String(propertyResult.landAreaM2),
            floors:
              propertyResult.floorsCount == null
                ? "1"
                : String(propertyResult.floorsCount),
            hasElevator: propertyResult.hasElevator,
            isWheelchairAccessible: Boolean(
              propertyResult.isWheelchairAccessible,
            ),
            hasGroundFloorRoom: Boolean(propertyResult.hasGroundFloorRoom),
            hasAccessibleBathroom: Boolean(
              propertyResult.hasAccessibleBathroom,
            ),
            inventoryMode: propertyResult.inventoryMode,
            selectedAmenityIds: propertyAmenities.map(
              (amenity) => amenity.amenityId,
            ),
            propertyDescription:
              intro?.content ?? propertyResult.description ?? "",
            additionalNotes: notes?.content ?? "",
            commonAreas: commonAreas.length
              ? commonAreas.map((area) => ({
                  id: area.id,
                  name: area.name,
                  description: area.description ?? "",
                }))
              : [{ name: "", description: "" }],
            views: views.map((view) => view.viewType),
            nearbyPlaces: nearbyPlaces.filter((place) => place.isActive).length
              ? nearbyPlaces
                  .filter((place) => place.isActive)
                  .map((place) => ({
                    id: place.id,
                    title: place.title,
                    drivingMinutes:
                      place.drivingMinutes == null
                        ? ""
                        : String(place.drivingMinutes),
                    walkingMinutes:
                      place.walkingMinutes == null
                        ? ""
                        : String(place.walkingMinutes),
                    isDefault: place.isDefault,
                  }))
              : [
                  {
                    title: "",
                    drivingMinutes: "",
                    walkingMinutes: "",
                    isDefault: false,
                  },
                ],
            checkInTime: propertyResult.checkInTime ?? "14:00",
            checkOutTime: propertyResult.checkOutTime ?? "12:00",
            breakfastOption: propertyResult.breakfastOption ?? "NoBreakfast",
            breakfastPrice:
              propertyResult.breakfastPrice == null
                ? ""
                : String(propertyResult.breakfastPrice),
            freeChildAgeLimit:
              propertyResult.freeChildAgeLimit == null
                ? ""
                : String(propertyResult.freeChildAgeLimit),
            maxFreeChildren:
              propertyResult.maxFreeChildren == null
                ? ""
                : String(propertyResult.maxFreeChildren),
            childPrice:
              propertyResult.childPrice == null
                ? ""
                : String(propertyResult.childPrice),
            extraGuestPrice:
              propertyResult.extraGuestPrice == null
                ? ""
                : String(propertyResult.extraGuestPrice),
            seoTitle: propertyResult.seoTitle ?? "",
            seoDescription: propertyResult.seoDescription ?? "",
          });
        },
      )
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBooting(false));
  }, [canLoadWorkspace, isAdmin, mode, propertyId]);

  const propertyAmenityOptions = amenities.filter(
    (item) => item.scope !== "RoomType",
  );
  const completed = useMemo(
    () => [
      Boolean(data.name.trim() && data.englishName.trim()),
      Boolean(data.city.trim() && data.address.trim()),
      Number(data.floors) > 0,
      data.selectedAmenityIds.length > 0 || data.views.length > 0,
      allImages.some((image) => !image.roomTypeId && !image.roomId),
      Boolean(
        data.propertyDescription.trim() ||
        cleanCommonAreas(data.commonAreas).length,
      ),
      cleanNearbyPlaces(data.nearbyPlaces).length > 0,
      Boolean(data.checkInTime && data.checkOutTime),
      Boolean(
        data.freeChildAgeLimit ||
        data.maxFreeChildren ||
        data.childPrice ||
        data.extraGuestPrice,
      ),
      Boolean(data.seoTitle || data.seoDescription),
      Boolean(property),
    ],
    [allImages, data, property],
  );

  const completionSections = useMemo<CompletionSection[]>(() => {
    const hasImages = allImages.some(
      (image) => !image.roomTypeId && !image.roomId,
    );
    const hasDescription = Boolean(data.propertyDescription.trim());
    const hasCommonAreas = cleanCommonAreas(data.commonAreas).length > 0;
    const hasNearbyPlaces = cleanNearbyPlaces(data.nearbyPlaces).length > 0;
    const required = (items: Array<[boolean, string]>) =>
      items.filter(([done]) => !done).map(([, label]) => label);
    const recommended = (items: Array<[boolean, string]>) =>
      items.filter(([done]) => !done).map(([, label]) => label);

    return [
      {
        key: "basic",
        label: "اطلاعات پایه",
        targetStepIndex: 0,
        isComplete: Boolean(data.name.trim() && data.englishName.trim()),
        missingItems: required([
          [Boolean(data.name.trim()), "نام فارسی"],
          [Boolean(data.englishName.trim()), "نام انگلیسی"],
        ]),
        recommendedMissingItems: recommended([
          [Boolean(data.seoTitle.trim()), "عنوان سئو"],
          [Boolean(data.seoDescription.trim()), "توضیحات سئو"],
        ]),
      },
      {
        key: "location",
        label: "موقعیت و نشانی",
        targetStepIndex: 1,
        isComplete: Boolean(data.city.trim() && data.address.trim()),
        missingItems: required([
          [Boolean(data.city.trim()), "شهر"],
          [Boolean(data.address.trim()), "نشانی"],
        ]),
        recommendedMissingItems: recommended([
          [Boolean(data.latitude && data.longitude), "مختصات نقشه"],
        ]),
      },
      {
        key: "building",
        label: "ساختمان و دسترسی",
        targetStepIndex: 2,
        isComplete: Number(data.floors || 0) > 0,
        missingItems: required([[Number(data.floors || 0) > 0, "تعداد طبقات"]]),
        recommendedMissingItems: [],
      },
      {
        key: "amenities",
        label: "امکانات و چشم‌انداز",
        targetStepIndex: 3,
        isComplete: data.selectedAmenityIds.length > 0 || data.views.length > 0,
        missingItems: required([
          [
            data.selectedAmenityIds.length > 0 || data.views.length > 0,
            "حداقل یک امکان یا چشم‌انداز",
          ],
        ]),
        recommendedMissingItems: [],
      },
      {
        key: "images",
        label: "تصاویر",
        targetStepIndex: 4,
        isComplete: hasImages,
        missingItems: required([[hasImages, "حداقل یک تصویر"]]),
        recommendedMissingItems: [],
      },
      {
        key: "descriptions",
        label: "توضیحات و فضاها",
        targetStepIndex: 5,
        isComplete: hasDescription || hasCommonAreas,
        missingItems: required([
          [hasDescription || hasCommonAreas, "توضیح اقامتگاه یا فضای مشترک"],
        ]),
        recommendedMissingItems: recommended([
          [hasCommonAreas, "فضاهای مشترک"],
        ]),
      },
      {
        key: "nearby",
        label: "مکان‌های نزدیک",
        targetStepIndex: 6,
        isComplete: hasNearbyPlaces,
        missingItems: required([[hasNearbyPlaces, "حداقل یک مکان نزدیک"]]),
        recommendedMissingItems: [],
      },
      {
        key: "rules",
        label: "قوانین و زمان‌ها",
        targetStepIndex: 7,
        isComplete: Boolean(data.checkInTime && data.checkOutTime),
        missingItems: required([
          [Boolean(data.checkInTime), "ساعت ورود"],
          [Boolean(data.checkOutTime), "ساعت خروج"],
        ]),
        recommendedMissingItems: recommended([
          [
            data.breakfastOption !== "Paid" || Boolean(data.breakfastPrice),
            "قیمت صبحانه",
          ],
        ]),
      },
      {
        key: "financial",
        label: "کودک و نفر اضافه",
        targetStepIndex: 8,
        isComplete:
          data.freeChildAgeLimit !== "" &&
          data.maxFreeChildren !== "" &&
          Number(data.childPrice) > 0 &&
          Number(data.extraGuestPrice) > 0,
        missingItems: required([
          [
            data.freeChildAgeLimit !== "" && data.maxFreeChildren !== "",
            "قانون کودک رایگان",
          ],
          [Number(data.childPrice) > 0, "نرخ کودک"],
          [Number(data.extraGuestPrice) > 0, "نرخ نفر اضافه"],
        ]),
        recommendedMissingItems: [],
      },
      {
        key: "seo",
        label: "تنظیمات سئو",
        targetStepIndex: 9,
        isComplete: true,
        missingItems: [],
        recommendedMissingItems: recommended([
          [Boolean(data.seoTitle.trim()), "عنوان سئو"],
          [Boolean(data.seoDescription.trim()), "توضیحات سئو"],
        ]),
      },
      {
        key: "review",
        label: "بازبینی",
        targetStepIndex: 10,
        isComplete: Boolean(property),
        missingItems: required([[Boolean(property), "ذخیره اولیه اقامتگاه"]]),
        recommendedMissingItems: [],
      },
    ];
  }, [allImages, data, property]);

  const requiredIncompleteSections = completionSections.filter(
    (section) => !section.isComplete,
  );
  const recommendedIncompleteSections = completionSections.filter(
    (section) =>
      section.isComplete && section.recommendedMissingItems.length > 0,
  );
  const localCompletionPercentage = Math.round(
    (completionSections.filter((section) => section.isComplete).length /
      completionSections.length) *
      100,
  );

  function jumpToStep(index: number) {
    setError("");
    setStep(index);
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: 0, behavior: "smooth" }),
    );
  }

  function completionStepTarget(actionTarget: string) {
    const stepByTarget: Record<string, number> = {
      basic: 0,
      location: 1,
      amenities: 3,
      images: 4,
      policies: 7,
      financial: 8,
    };
    return stepByTarget[actionTarget];
  }

  function update<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((current) => ({ ...current, [key]: value }));
  }

  function propertyPayload(description = data.propertyDescription.trim()) {
    const payload = {
      destinationId: resolveDestinationId(data.city),
      name: data.name.trim(),
      englishName: data.englishName.trim() || null,
      description,
      seoTitle: data.seoTitle.trim() || null,
      seoDescription: data.seoDescription.trim() || null,
      address: data.address.trim(),
      city: data.city.trim(),
      country: "Iran",
      latitude: data.latitude === "" ? null : Number(data.latitude),
      longitude: data.longitude === "" ? null : Number(data.longitude),
      type: data.type,
      inventoryMode: data.inventoryMode,
      checkInTime: data.checkInTime || null,
      checkOutTime: data.checkOutTime || null,
      breakfastOption: data.breakfastOption,
      breakfastPrice:
        data.breakfastOption === "Paid" && data.breakfastPrice !== ""
          ? Number(data.breakfastPrice)
          : null,
      freeChildAgeLimit:
        data.freeChildAgeLimit === "" ? null : Number(data.freeChildAgeLimit),
      maxFreeChildren:
        data.maxFreeChildren === "" ? null : Number(data.maxFreeChildren),
      childPrice: data.childPrice === "" ? null : Number(data.childPrice),
      extraGuestPrice:
        data.extraGuestPrice === "" ? null : Number(data.extraGuestPrice),
      totalAreaM2: data.totalArea === "" ? null : Number(data.totalArea),
      landAreaM2: data.landArea === "" ? null : Number(data.landArea),
      floorsCount: data.floors === "" ? null : Number(data.floors),
      stairCount: null,
      hasElevator: data.hasElevator,
      isWheelchairAccessible: data.isWheelchairAccessible,
      hasGroundFloorRoom: data.hasGroundFloorRoom,
      hasAccessibleBathroom: data.hasAccessibleBathroom,
    };
    return payload;
  }

  async function saveProperty(description?: string) {
    const body = JSON.stringify(propertyPayload(description));
    if (property) {
      const updated = await apiRequest<PropertyResponse>(
        isAdmin
          ? `/admin/properties/${property.id}`
          : `/owner/properties/${property.id}`,
        {
          method: "PUT",
          body,
        },
      );
      setProperty(updated);
      return updated;
    }
    const created = await apiRequest<PropertyResponse>("/owner/properties", {
      method: "POST",
      body,
    });
    setProperty(created);
    return created;
  }

  async function updatePropertySection(section: string, payload: object) {
    if (!property) throw new Error("ابتدا اقامتگاه را ایجاد کنید.");
    const base = isAdmin ? "/admin/properties" : "/owner/properties";
    const updated = await apiRequest<PropertyResponse>(
      `${base}/${property.id}/sections/${section}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
    setProperty(updated);
    return updated;
  }

  async function saveAmenities(propertyId: number) {
    await apiRequest<PropertyAmenityResponse[]>(
      `/owner/properties/${propertyId}/amenities`,
      {
        method: "PUT",
        body: JSON.stringify({ amenityIds: data.selectedAmenityIds }),
      },
    );
    await apiRequest(`/owner/properties/${propertyId}/views`, {
      method: "PUT",
      body: JSON.stringify({ views: data.views }),
    });
  }

  async function saveDescriptions(propertyId: number) {
    const sections = [
      {
        sectionType: "PropertyIntroduction",
        title: "معرفی اقامتگاه",
        content: data.propertyDescription.trim(),
        sortOrder: 1,
      },
      {
        sectionType: "ImportantNotes",
        title: "نکات مهم",
        content: data.additionalNotes.trim(),
        sortOrder: 2,
      },
    ].filter((section) => section.content);
    const ids = { ...descriptionIds };
    for (const section of sections) {
      const id = ids[section.sectionType];
      const saved = await apiRequest<PropertyDescriptionSectionResponse>(
        id
          ? `/owner/property-descriptions/${id}`
          : `/owner/properties/${propertyId}/descriptions`,
        {
          method: id ? "PUT" : "POST",
          body: JSON.stringify(section),
        },
      );
      ids[section.sectionType] = saved.id;
    }
    setDescriptionIds(ids);

    const desired = cleanCommonAreas(data.commonAreas);
    const commonAreas = await replacePropertyCommonAreas(
      propertyId,
      desired.map((area, index) => ({
        name: area.name.trim(),
        description: area.description.trim() || null,
        sortOrder: index + 1,
      })),
    );
    update(
      "commonAreas",
      commonAreas.length
        ? commonAreas.map((area) => ({
            id: area.id,
            name: area.name,
            description: area.description ?? "",
          }))
        : [{ name: "", description: "" }],
    );
    await updatePropertySection("description", {
      description: data.propertyDescription.trim(),
    });
  }

  async function saveNearbyPlaces(propertyId: number) {
    const existing = await apiRequest<NearbyPlaceResponse[]>(
      `/owner/properties/${propertyId}/nearby-places`,
    );
    const desired = cleanNearbyPlaces(data.nearbyPlaces);
    const desiredTitles = new Set(
      desired.map((place) => place.title.toLocaleLowerCase()),
    );
    for (const place of desired) {
      const found = place.id
        ? existing.find((item) => item.id === place.id)
        : existing.find(
            (item) =>
              item.title.toLocaleLowerCase() ===
              place.title.toLocaleLowerCase(),
          );
      await apiRequest<NearbyPlaceResponse>(
        found
          ? `/owner/nearby-places/${found.id}`
          : `/owner/properties/${propertyId}/nearby-places`,
        {
          method: found ? "PUT" : "POST",
          body: JSON.stringify({
            title: place.title.trim(),
            category: nearbyCategory(place.title),
            distanceInMeters: null,
            walkingMinutes:
              place.walkingMinutes === "" ? null : Number(place.walkingMinutes),
            drivingMinutes:
              place.drivingMinutes === "" ? null : Number(place.drivingMinutes),
            description: null,
            latitude: null,
            longitude: null,
            isDefault: place.isDefault,
            isCustom: !place.isDefault,
            isActive: true,
          }),
        },
      );
    }
    for (const place of existing.filter(
      (item) =>
        item.isActive && !desiredTitles.has(item.title.toLocaleLowerCase()),
    )) {
      await apiRequest<NearbyPlaceResponse>(
        `/owner/nearby-places/${place.id}`,
        { method: "PUT", body: JSON.stringify({ ...place, isActive: false }) },
      );
    }
  }

  function validateStep(index = step) {
    if (
      mode === "create" &&
      index === 0 &&
      (!data.name.trim() || !data.englishName.trim())
    )
      return "نام فارسی و انگلیسی را وارد کنید.";
    if (index === 2 && data.floors !== "" && Number(data.floors) < 1)
      return "تعداد طبقات باید حداقل ۱ باشد.";
    if (
      index === 7 &&
      data.breakfastOption === "Paid" &&
      data.breakfastPrice === ""
    )
      return "قیمت صبحانه را وارد کنید.";
    return "";
  }

  async function saveCurrentStep() {
    if (!property) {
      const created = await saveProperty(data.propertyDescription.trim());
      setCompletion(
        await apiRequest<PropertyCompletionResponse>(
          `/owner/properties/${created.id}/completion`,
        ).catch(() => completion as PropertyCompletionResponse),
      );
      return created;
    }

    let saved = property;
    if (step === 0)
      saved = await updatePropertySection("basic", {
        name: data.name.trim(),
        englishName: data.englishName.trim() || null,
        type: data.type,
        inventoryMode: data.inventoryMode,
      });
    if (step === 1)
      saved = await updatePropertySection("location", {
        destinationId: resolveDestinationId(data.city),
        address: data.address.trim(),
        city: data.city.trim(),
        country: "Iran",
        latitude: data.latitude === "" ? null : Number(data.latitude),
        longitude: data.longitude === "" ? null : Number(data.longitude),
      });
    if (step === 2)
      saved = await updatePropertySection("building", {
        totalAreaM2: data.totalArea === "" ? null : Number(data.totalArea),
        landAreaM2: data.landArea === "" ? null : Number(data.landArea),
        floorsCount: data.floors === "" ? null : Number(data.floors),
        hasElevator: data.hasElevator,
        isWheelchairAccessible: data.isWheelchairAccessible,
        hasGroundFloorRoom: data.hasGroundFloorRoom,
        hasAccessibleBathroom: data.hasAccessibleBathroom,
      });
    if (step === 3) await saveAmenities(saved.id);
    if (step === 5) await saveDescriptions(saved.id);
    if (step === 6) await saveNearbyPlaces(saved.id);
    if (step === 7)
      saved = await updatePropertySection("rules", {
        checkInTime: data.checkInTime || null,
        checkOutTime: data.checkOutTime || null,
        breakfastOption: data.breakfastOption,
        breakfastPrice:
          data.breakfastOption === "Paid" && data.breakfastPrice !== ""
            ? Number(data.breakfastPrice)
            : null,
      });
    if (step === 8)
      saved = await updatePropertySection("financial", {
        freeChildAgeLimit:
          data.freeChildAgeLimit === "" ? null : Number(data.freeChildAgeLimit),
        maxFreeChildren:
          data.maxFreeChildren === "" ? null : Number(data.maxFreeChildren),
        childPrice: data.childPrice === "" ? null : Number(data.childPrice),
        extraGuestPrice:
          data.extraGuestPrice === "" ? null : Number(data.extraGuestPrice),
      });
    if (step === 9)
      saved = await updatePropertySection("seo", {
        seoTitle: data.seoTitle.trim() || null,
        seoDescription: data.seoDescription.trim() || null,
      });
    const completionPath = isAdmin
      ? `/admin/properties/${saved.id}/completion`
      : `/owner/properties/${saved.id}/completion`;
    setCompletion(
      await apiRequest<PropertyCompletionResponse>(completionPath).catch(
        () => completion as PropertyCompletionResponse,
      ),
    );
    return saved;
  }

  async function nextStep() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setSavingSection(String(step));
    setError("");
    try {
      await saveCurrentStep();
      toast.success("این بخش ذخیره شد.");
      setStep((current) => Math.min(current + 1, steps.length - 1));
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "این مرحله ذخیره نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setSavingSection(null);
    }
  }

  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const saved = await saveCurrentStep();
      toast.success("اطلاعات این بخش ذخیره شد.");
      onDone?.(saved);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "ذخیره نهایی انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function saveAdminStatus() {
    if (!property || !isAdmin) return;
    setSavingSection("status");
    setError("");
    try {
      const updated = await apiRequest<PropertyResponse>(
        `/admin/properties/${property.id}/status`,
        {
          method: "PUT",
          body: JSON.stringify({ status: adminStatus }),
        },
      );
      setProperty(updated);
      toast.success("وضعیت اقامتگاه به‌روزرسانی شد.");
    } catch (caught) {
      const body =
        caught instanceof ApiRequestError
          ? (caught.body as { completion?: PropertyCompletionResponse } | null)
          : null;
      if (body?.completion) setCompletion(body.completion);
      const message =
        caught instanceof Error ? caught.message : "تغییر وضعیت انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSavingSection(null);
    }
  }

  function syncImages(images: PropertyImageResponse[]) {
    setAllImages(images);
  }

  if (booting) {
    return (
      <KoochCard variant="elevated">
        در حال بارگذاری اطلاعات اقامتگاه...
      </KoochCard>
    );
  }

  return (
    <form
      className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]"
      dir="rtl"
      onSubmit={finish}
    >
      <aside className="h-fit rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm lg:sticky lg:top-5">
        <div className="mb-3 px-2">
          <p className="text-xs font-bold text-muted-foreground">
            {mode === "create" ? "ثبت اقامتگاه" : "ویرایش اقامتگاه"}
          </p>
          <p className="mt-1 text-sm font-bold text-foreground">
            مرحله {step + 1} از {steps.length}
          </p>
        </div>
        <nav className="grid gap-1">
          {steps.map((label, index) => {
            const section = completionSections.find(
              (item) => item.targetStepIndex === index,
            );
            const isComplete = Boolean(section?.isComplete);
            const hasRequiredMissing = Boolean(section && !section.isComplete);
            const hasRecommendedMissing = Boolean(
              section?.isComplete && section.recommendedMissingItems.length,
            );
            return (
              <button
                className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-right text-sm font-bold transition ${step === index ? "bg-primary text-primary-foreground" : isComplete ? "bg-[var(--theme-success-soft)] text-[var(--theme-success)] hover:bg-muted" : "text-muted-foreground hover:bg-muted"}`}
                key={label}
                onClick={() => jumpToStep(index)}
                title={
                  section
                    ? [
                        ...section.missingItems,
                        ...section.recommendedMissingItems,
                      ].join("، ")
                    : undefined
                }
                type="button"
              >
                <span>{label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${step === index ? "bg-primary-foreground/20 text-primary-foreground" : hasRequiredMissing ? "bg-[var(--theme-danger-soft)] text-[var(--theme-danger)]" : hasRecommendedMissing ? "bg-[var(--theme-warning-soft)] text-[var(--theme-warning)]" : "bg-[var(--theme-success-soft)] text-[var(--theme-success)]"}`}
                >
                  {isComplete
                    ? hasRecommendedMissing
                      ? "پیشنهاد"
                      : "✓"
                    : "ناقص"}
                </span>
              </button>
            );
          })}
        </nav>
        {property && (
          <div className="mt-4 grid gap-2 border-t border-border pt-4">
            <Link
              className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
              href={
                isAdmin
                  ? `/admin/properties/${property.id}/rooms`
                  : `/owner/properties/${property.id}/rooms`
              }
            >
              مدیریت اتاق‌ها
            </Link>
            <Link
              className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
              href="/owner/properties"
            >
              بازگشت به لیست اقامتگاه‌ها
            </Link>
          </div>
        )}
        <div className="mt-4 border-t border-border px-2 pt-4">
          <KoochBadge variant="muted">واحد پول: {currencyLabel}</KoochBadge>
        </div>
      </aside>

      <main className="min-w-0">
        {error && (
          <p className="mb-4 rounded-xl bg-[var(--theme-danger-soft)] p-3 text-sm font-semibold text-[var(--theme-danger)]">
            {error}
          </p>
        )}

        {step === 0 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">اطلاعات پایه</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">
                نام فارسی
                <input
                  className={inputClass}
                  onChange={(event) => update("name", event.target.value)}
                  value={data.name}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                نام انگلیسی
                <input
                  className={inputClass}
                  dir="ltr"
                  onChange={(event) =>
                    update("englishName", event.target.value)
                  }
                  value={data.englishName}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                نوع اقامتگاه
                <select
                  className={inputClass}
                  onChange={(event) =>
                    update("type", event.target.value as PropertyType)
                  }
                  value={data.type}
                >
                  {propertyTypes.map((type) => (
                    <option key={type} value={type}>
                      {propertyTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-bold">
                مدل موجودی
                <select
                  className={inputClass}
                  onChange={(event) =>
                    update("inventoryMode", event.target.value as InventoryMode)
                  }
                  value={data.inventoryMode}
                >
                  <option value="NamedRooms">اتاق نام‌دار</option>
                  <option value="TypeBasedInventory">موجودی تعدادی</option>
                </select>
              </label>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">موقعیت و نشانی</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">
                شهر
                <input
                  className={inputClass}
                  onChange={(event) => update("city", event.target.value)}
                  value={data.city}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold md:col-span-2">
                نشانی
                <input
                  className={inputClass}
                  onChange={(event) => update("address", event.target.value)}
                  value={data.address}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                عرض جغرافیایی
                <input
                  className={inputClass}
                  dir="ltr"
                  onChange={(event) => update("latitude", event.target.value)}
                  type="number"
                  value={data.latitude}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                طول جغرافیایی
                <input
                  className={inputClass}
                  dir="ltr"
                  onChange={(event) => update("longitude", event.target.value)}
                  type="number"
                  value={data.longitude}
                />
              </label>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">ساختمان و دسترسی</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="grid gap-1 text-sm font-bold">
                زیربنا
                <input
                  className={inputClass}
                  min="0"
                  onChange={(event) => update("totalArea", event.target.value)}
                  type="number"
                  value={data.totalArea}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                مساحت زمین
                <input
                  className={inputClass}
                  min="0"
                  onChange={(event) => update("landArea", event.target.value)}
                  type="number"
                  value={data.landArea}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                تعداد طبقات
                <input
                  className={inputClass}
                  min="1"
                  onChange={(event) => update("floors", event.target.value)}
                  type="number"
                  value={data.floors}
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["hasElevator", "آسانسور دارد؟"],
                ["isWheelchairAccessible", "مناسب ویلچر هست؟"],
                ["hasGroundFloorRoom", "اتاق همکف دارد؟"],
                [
                  "hasAccessibleBathroom",
                  "سرویس بهداشتی مناسب افراد کم‌توان دارد؟",
                ],
              ].map(([key, label]) => (
                <label className={choiceClass} key={key}>
                  <input
                    checked={Boolean(data[key as keyof WizardData])}
                    className="h-4 w-4 accent-[var(--theme-primary)]"
                    onChange={(event) =>
                      update(
                        key as keyof WizardData,
                        event.target.checked as never,
                      )
                    }
                    type="checkbox"
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className={`${cardClass} grid gap-5`}>
            <h2 className="text-2xl font-bold">امکانات و چشم‌انداز</h2>
            {amenityCategories.map((category) => {
              const categoryAmenities = propertyAmenityOptions.filter(
                (item) => item.amenityCategoryId === category.id,
              );
              if (!categoryAmenities.length) return null;
              return (
                <fieldset className="grid gap-2" key={category.id}>
                  <legend className="mb-2 text-lg font-bold">
                    {category.name}
                  </legend>
                  <div className="grid gap-2 md:grid-cols-3">
                    {categoryAmenities.map((amenity) => (
                      <label className={choiceClass} key={amenity.id}>
                        <input
                          checked={data.selectedAmenityIds.includes(amenity.id)}
                          className="h-4 w-4 accent-[var(--theme-primary)]"
                          onChange={(event) =>
                            update(
                              "selectedAmenityIds",
                              event.target.checked
                                ? [...data.selectedAmenityIds, amenity.id]
                                : data.selectedAmenityIds.filter(
                                    (id) => id !== amenity.id,
                                  ),
                            )
                          }
                          type="checkbox"
                        />
                        {amenity.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            <fieldset>
              <legend className="mb-2 text-lg font-bold">چشم‌انداز</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {propertyViewOptions.map((view) => (
                  <label className={choiceClass} key={view}>
                    <input
                      checked={data.views.includes(view)}
                      className="h-4 w-4 accent-[var(--theme-primary)]"
                      onChange={(event) =>
                        update(
                          "views",
                          event.target.checked
                            ? [...data.views, view]
                            : data.views.filter((item) => item !== view),
                        )
                      }
                      type="checkbox"
                    />
                    {propertyViewLabels[view]}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        )}

        {step === 4 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">تصاویر اقامتگاه</h2>
            <div className="grid gap-3">
              <h3 className="font-bold">گالری تصاویر</h3>
              <PropertyImageManager
                allowFreeCrop={isAdmin}
                images={allImages}
                onImagesChange={syncImages}
                propertyId={property?.id ?? null}
                roomTypes={roomTypes}
              />
            </div>
          </section>
        )}

        {step === 5 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">توضیحات و فضاها</h2>
            <label className="grid gap-1 text-sm font-bold">
              توضیحات اقامتگاه
              <textarea
                className={inputClass}
                onChange={(event) =>
                  update("propertyDescription", event.target.value)
                }
                rows={5}
                value={data.propertyDescription}
              />
            </label>
            <div className="grid gap-3 rounded-xl border border-border bg-muted p-4">
              <strong>فضاهای مشترک</strong>
              {data.commonAreas.map((area, index) => (
                <div
                  className="grid gap-2 md:grid-cols-[1fr_1.5fr_auto]"
                  key={index}
                >
                  <input
                    className={inputClass}
                    onChange={(event) => {
                      const next = [...data.commonAreas];
                      next[index] = {
                        ...next[index],
                        name: event.target.value,
                      };
                      update("commonAreas", next);
                    }}
                    placeholder="حیاط مرکزی"
                    value={area.name}
                  />
                  <input
                    className={inputClass}
                    onChange={(event) => {
                      const next = [...data.commonAreas];
                      next[index] = {
                        ...next[index],
                        description: event.target.value,
                      };
                      update("commonAreas", next);
                    }}
                    placeholder="توضیح اختیاری"
                    value={area.description}
                  />
                  <KoochButton
                    onClick={() =>
                      update(
                        "commonAreas",
                        data.commonAreas.filter(
                          (_, candidate) => candidate !== index,
                        ),
                      )
                    }
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    حذف
                  </KoochButton>
                </div>
              ))}
              <KoochButton
                className="justify-self-start"
                onClick={() =>
                  update("commonAreas", [
                    ...data.commonAreas,
                    { name: "", description: "" },
                  ])
                }
                type="button"
                variant="outline"
              >
                افزودن فضای مشترک
              </KoochButton>
            </div>
            <label className="grid gap-1 text-sm font-bold">
              نکات تکمیلی
              <textarea
                className={inputClass}
                onChange={(event) =>
                  update("additionalNotes", event.target.value)
                }
                rows={4}
                value={data.additionalNotes}
              />
            </label>
          </section>
        )}

        {step === 6 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">مکان‌های نزدیک</h2>
            <div className="grid gap-2 md:grid-cols-3">
              {defaultNearbyPlaces.map((place) => (
                <button
                  className="rounded-xl border border-border bg-background p-3 text-right text-sm font-bold text-foreground transition hover:bg-muted"
                  key={place}
                  onClick={() =>
                    update(
                      "nearbyPlaces",
                      data.nearbyPlaces.some((item) => item.title === place)
                        ? data.nearbyPlaces.filter(
                            (item) => item.title !== place,
                          )
                        : [
                            ...data.nearbyPlaces,
                            {
                              title: place,
                              drivingMinutes: "",
                              walkingMinutes: "",
                              isDefault: true,
                            },
                          ],
                    )
                  }
                  type="button"
                >
                  {data.nearbyPlaces.some((item) => item.title === place)
                    ? "انتخاب شده: "
                    : ""}
                  {place}
                </button>
              ))}
            </div>
            {data.nearbyPlaces.map((place, index) => (
              <div
                className="grid gap-2 rounded-xl border border-border bg-background p-3 md:grid-cols-[1fr_140px_140px_auto]"
                key={index}
              >
                <input
                  className={inputClass}
                  disabled={place.isDefault}
                  onChange={(event) => {
                    const next = [...data.nearbyPlaces];
                    next[index] = { ...next[index], title: event.target.value };
                    update("nearbyPlaces", next);
                  }}
                  placeholder="مکان دلخواه"
                  value={place.title}
                />
                <input
                  className={inputClass}
                  min="0"
                  onChange={(event) => {
                    const next = [...data.nearbyPlaces];
                    next[index] = {
                      ...next[index],
                      drivingMinutes: event.target.value,
                    };
                    update("nearbyPlaces", next);
                  }}
                  placeholder="با خودرو"
                  type="number"
                  value={place.drivingMinutes}
                />
                <input
                  className={inputClass}
                  min="0"
                  onChange={(event) => {
                    const next = [...data.nearbyPlaces];
                    next[index] = {
                      ...next[index],
                      walkingMinutes: event.target.value,
                    };
                    update("nearbyPlaces", next);
                  }}
                  placeholder="پیاده"
                  type="number"
                  value={place.walkingMinutes}
                />
                <KoochButton
                  onClick={() =>
                    update(
                      "nearbyPlaces",
                      data.nearbyPlaces.filter(
                        (_, candidate) => candidate !== index,
                      ),
                    )
                  }
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  حذف
                </KoochButton>
              </div>
            ))}
            <KoochButton
              className="justify-self-start"
              onClick={() =>
                update("nearbyPlaces", [
                  ...data.nearbyPlaces,
                  {
                    title: "",
                    drivingMinutes: "",
                    walkingMinutes: "",
                    isDefault: false,
                  },
                ])
              }
              type="button"
              variant="outline"
            >
              افزودن مکان
            </KoochButton>
          </section>
        )}

        {step === 7 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">قوانین و زمان‌ها</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">
                ساعت ورود
                <input
                  className={inputClass}
                  onChange={(event) =>
                    update("checkInTime", event.target.value)
                  }
                  type="time"
                  value={data.checkInTime}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                ساعت خروج
                <input
                  className={inputClass}
                  onChange={(event) =>
                    update("checkOutTime", event.target.value)
                  }
                  type="time"
                  value={data.checkOutTime}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                صبحانه
                <select
                  className={inputClass}
                  onChange={(event) =>
                    update(
                      "breakfastOption",
                      event.target.value as BreakfastOption,
                    )
                  }
                  value={data.breakfastOption}
                >
                  <option value="NoBreakfast">بدون صبحانه</option>
                  <option value="Included">صبحانه رایگان</option>
                  <option value="Paid">صبحانه با هزینه</option>
                </select>
              </label>
              {data.breakfastOption === "Paid" && (
                <label className="grid gap-1 text-sm font-bold">
                  هزینه صبحانه ({currencyLabel})
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    onChange={(event) =>
                      update(
                        "breakfastPrice",
                        rawLocalizedAmount(event.target.value),
                      )
                    }
                    type="text"
                    value={formatLocalizedAmount(data.breakfastPrice)}
                  />
                </label>
              )}
            </div>
          </section>
        )}

        {step === 8 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">قوانین کودک و نفر اضافه</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">
                سن کودک رایگان تا
                <input
                  className={inputClass}
                  max="17"
                  min="0"
                  onChange={(event) =>
                    update("freeChildAgeLimit", event.target.value)
                  }
                  type="number"
                  value={data.freeChildAgeLimit}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold">
                حداکثر تعداد کودک رایگان
                <input
                  className={inputClass}
                  min="0"
                  onChange={(event) =>
                    update("maxFreeChildren", event.target.value)
                  }
                  type="number"
                  value={data.maxFreeChildren}
                />
              </label>
              <KoochField label={`نرخ کودک (${currencyLabel})`}>
                <KoochInput
                  inputMode="numeric"
                  onChange={(event) =>
                    update("childPrice", rawLocalizedAmount(event.target.value))
                  }
                  type="text"
                  value={formatLocalizedAmount(data.childPrice)}
                />
              </KoochField>
              <KoochField label={`نرخ نفر اضافه (${currencyLabel})`}>
                <KoochInput
                  inputMode="numeric"
                  onChange={(event) =>
                    update(
                      "extraGuestPrice",
                      rawLocalizedAmount(event.target.value),
                    )
                  }
                  type="text"
                  value={formatLocalizedAmount(data.extraGuestPrice)}
                />
              </KoochField>
            </div>
          </section>
        )}

        {step === 9 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">تنظیمات سئو</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold md:col-span-2">
                عنوان سئو
                <input
                  className={inputClass}
                  onChange={(event) => update("seoTitle", event.target.value)}
                  value={data.seoTitle}
                />
              </label>
              <label className="grid gap-1 text-sm font-bold md:col-span-2">
                توضیح سئو
                <textarea
                  className={inputClass}
                  onChange={(event) =>
                    update("seoDescription", event.target.value)
                  }
                  rows={3}
                  value={data.seoDescription}
                />
              </label>
            </div>
          </section>
        )}

        {step === 10 && (
          <section className="grid gap-4">
            {property && (
              <PricingSettingsWarning
                editHref={`${isAdmin ? "/admin" : "/owner"}/properties/${property.id}?step=8`}
                title="تنظیمات مالی کامل نشده"
                warnings={getPropertyFinancialWarnings(property)}
              />
            )}
            {isAdmin && property && (
              <div
                className={`${cardClass} grid gap-3 md:grid-cols-[1fr_auto] md:items-end`}
              >
                <label className="grid gap-1 text-sm font-bold">
                  وضعیت اقامتگاه
                  <select
                    className={inputClass}
                    onChange={(event) =>
                      setAdminStatus(event.target.value as PropertyStatus)
                    }
                    value={adminStatus}
                  >
                    {propertyStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {statusLabels[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <KoochButton
                  disabled={savingSection === "status"}
                  loading={savingSection === "status"}
                  onClick={saveAdminStatus}
                  type="button"
                >
                  ذخیره وضعیت
                </KoochButton>
                {adminStatus === "Approved" && !completion?.canActivate && (
                  <p className="rounded-lg bg-[var(--theme-warning-soft)] p-3 text-sm font-bold text-[var(--theme-warning)] md:col-span-2">
                    برای فعال‌سازی، ابتدا موارد ناقص زیر را تکمیل کنید.
                  </p>
                )}
              </div>
            )}
            {completion && property && (
              <PropertyCompletionCard
                completion={completion}
                getActionHref={(section) => {
                  const target = section.actionTarget || section.key;
                  if (completionStepTarget(target) != null) return undefined;
                  return propertyCompletionHref(
                    isAdmin ? "admin" : "owner",
                    property.id,
                    section,
                  );
                }}
                onSectionAction={(section) => {
                  const target = completionStepTarget(
                    section.actionTarget || section.key,
                  );
                  if (target != null) jumpToStep(target);
                }}
              />
            )}
            <div className={cardClass}>
              <h2 className="text-2xl font-bold">بازبینی</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                میزان تکمیل اطلاعات: {localCompletionPercentage}٪
              </p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${localCompletionPercentage}%` }}
                />
              </div>
              <p className="mt-3 inline-flex rounded-full bg-[var(--theme-primary-soft)] px-3 py-1 text-sm font-bold text-[var(--theme-primary-text)]">
                {localCompletionPercentage}٪ تکمیل شده
              </p>
              {isAdmin && requiredIncompleteSections.length > 0 && (
                <p className="mt-3 rounded-xl bg-[var(--theme-warning-soft)] p-3 text-sm font-bold text-[var(--theme-warning)]">
                  این اقامتگاه هنوز بخش‌های ناقص دارد.
                </p>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-xl font-bold">موارد ناقص</h3>
              {requiredIncompleteSections.length === 0 &&
              recommendedIncompleteSections.length === 0 ? (
                <p className="mt-3 rounded-xl bg-[var(--theme-success-soft)] p-3 text-sm font-bold text-[var(--theme-success)]">
                  اطلاعات اقامتگاه کامل است.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {[
                    ...requiredIncompleteSections,
                    ...recommendedIncompleteSections,
                  ].map((section) => {
                    const requiredMissing = section.missingItems.length > 0;
                    const items = requiredMissing
                      ? section.missingItems
                      : section.recommendedMissingItems;
                    return (
                      <article
                        className={`rounded-xl border p-4 ${requiredMissing ? "border-destructive bg-destructive/10" : "border-[var(--theme-warning)] bg-[var(--theme-warning-soft)]"}`}
                        key={section.key}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="font-bold text-foreground">
                              {section.label}
                            </h4>
                            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
                              {items.map((item) => (
                                <li key={item}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                          <KoochButton
                            onClick={() => jumpToStep(section.targetStepIndex)}
                            size="sm"
                            type="button"
                          >
                            تکمیل این بخش
                          </KoochButton>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ReviewCard
                title="اطلاعات پایه"
                lines={[data.name, propertyTypeLabels[data.type], data.city]}
              />
              <ReviewCard
                title="دسترسی"
                lines={[
                  boolLabel(data.hasElevator, "آسانسور"),
                  boolLabel(data.isWheelchairAccessible, "مناسب ویلچر"),
                  boolLabel(data.hasGroundFloorRoom, "اتاق همکف"),
                  boolLabel(
                    data.hasAccessibleBathroom,
                    "سرویس مناسب افراد کم‌توان",
                  ),
                ]}
              />
              <ReviewCard
                title="فضاهای مشترک"
                lines={cleanCommonAreas(data.commonAreas).map(
                  (area) => area.name,
                )}
              />
              <ReviewCard
                title="مکان‌های نزدیک"
                lines={cleanNearbyPlaces(data.nearbyPlaces).map(
                  (place) => place.title,
                )}
              />
            </div>
            {property && (
              <div className={`${cardClass} grid gap-3 md:grid-cols-3`}>
                <Link
                  className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
                  href={
                    isAdmin
                      ? `/admin/properties/${property.id}/rooms`
                      : `/owner/properties/${property.id}/rooms`
                  }
                >
                  مدیریت اتاق‌ها
                </Link>
                {property.slug && (
                  <Link
                    className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
                    href={`/properties/${property.slug}`}
                  >
                    مشاهده صفحه عمومی
                  </Link>
                )}
                <Link
                  className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
                  href={isAdmin ? "/admin/properties" : "/owner/properties"}
                >
                  بازگشت به لیست اقامتگاه‌ها
                </Link>
              </div>
            )}
          </section>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <KoochButton
            disabled={step === 0 || loading}
            onClick={() => {
              setError("");
              setStep((current) => Math.max(0, current - 1));
            }}
            type="button"
            variant="outline"
          >
            قبلی
          </KoochButton>
          <div className="flex gap-2">
            <KoochButton
              disabled={loading || savingSection !== null}
              loading={savingSection === String(step)}
              onClick={async () => {
                setLoading(true);
                setSavingSection(String(step));
                setError("");
                try {
                  await saveCurrentStep();
                  toast.success("این بخش ذخیره شد.");
                } catch (caught) {
                  const message =
                    caught instanceof Error
                      ? caught.message
                      : "ذخیره انجام نشد.";
                  setError(message);
                  toast.error(message);
                } finally {
                  setLoading(false);
                  setSavingSection(null);
                }
              }}
              type="button"
              variant="outline"
            >
              ذخیره
            </KoochButton>
            {step < steps.length - 1 ? (
              <KoochButton
                disabled={loading || savingSection !== null}
                loading={savingSection === String(step)}
                onClick={nextStep}
                type="button"
              >
                ذخیره و ادامه
              </KoochButton>
            ) : (
              <KoochButton
                disabled={loading || savingSection !== null}
                loading={loading}
                type="submit"
              >
                پایان
              </KoochButton>
            )}
          </div>
        </div>
      </main>
    </form>
  );
}

function ReviewCard({ title, lines }: { title: string; lines: string[] }) {
  const visibleLines = lines.filter(Boolean);
  return (
    <KoochCard variant="elevated">
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      {visibleLines.length ? (
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {visibleLines.map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">موردی ثبت نشده است.</p>
      )}
    </KoochCard>
  );
}
