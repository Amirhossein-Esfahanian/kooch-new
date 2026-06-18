"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AmenityCategoryResponse,
  AmenityResponse,
  apiRequest,
  getToken,
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
  resolveDestinationId,
  RoomTypeResponse,
} from "@/lib/owner-api";
import { ImageUploadDropzone } from "@/components/owner/ImageUploadDropzone";
import { PropertyImageManager } from "@/components/owner/PropertyImageManager";

const steps = [
  "اطلاعات پایه",
  "موقعیت",
  "ساختمان و دسترسی",
  "امکانات",
  "تصاویر",
  "توضیحات و فضاها",
  "مکان‌های نزدیک",
  "قوانین و زمان‌ها",
  "بازبینی",
];

const defaultNearbyPlaces = ["Railway Station", "Bus Terminal", "Airport", "City Center", "Hospital"];
const propertyViewOptions: PropertyViewType[] = ["CourtyardView", "GardenView", "CityView", "MountainView", "DesertView"];
const propertyStatusOptions: PropertyStatus[] = ["Draft", "PendingReview", "Approved", "Rejected", "Suspended"];

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

interface ImageDraft {
  url: string;
  tag: string;
  imageId?: number;
}

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
  coverImage: string;
  propertyImages: ImageDraft[];
  propertyDescription: string;
  additionalNotes: string;
  commonAreas: CommonAreaDraft[];
  views: PropertyViewType[];
  nearbyPlaces: NearbyPlaceDraft[];
  checkInTime: string;
  checkOutTime: string;
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
  coverImage: "",
  propertyImages: [{ url: "", tag: "gallery" }],
  propertyDescription: "",
  additionalNotes: "",
  commonAreas: [{ name: "", description: "" }],
  views: [],
  nearbyPlaces: [{ title: "", drivingMinutes: "", walkingMinutes: "", isDefault: false }],
  checkInTime: "14:00",
  checkOutTime: "12:00",
  seoTitle: "",
  seoDescription: "",
};

const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

interface PropertyWizardProps {
  mode: "create" | "edit";
  propertyId?: number;
  isAdmin?: boolean;
  onDone?: (property: PropertyResponse) => void;
}

function cleanImages(values: ImageDraft[]) {
  return values.filter((image) => image.url.trim());
}

function cleanCommonAreas(values: CommonAreaDraft[]) {
  return values.filter((area) => area.name.trim());
}

function cleanNearbyPlaces(values: NearbyPlaceDraft[]) {
  return values.filter((place) => place.title.trim());
}

function nearbyCategory(title: string): NearbyPlaceCategory {
  const normalized = title.toLocaleLowerCase();
  if (normalized.includes("station") || normalized.includes("terminal") || normalized.includes("airport")) return "Transport";
  if (normalized.includes("bazaar") || normalized.includes("market")) return "Market";
  if (normalized.includes("square") || normalized.includes("center")) return "Landmark";
  if (normalized.includes("garden") || normalized.includes("house")) return "Attraction";
  return "Other";
}

function boolLabel(value: boolean, label: string) {
  return value ? label : "";
}

export function PropertyWizard({ mode, propertyId, isAdmin = false, onDone }: PropertyWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(initialData);
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [adminStatus, setAdminStatus] = useState<PropertyStatus>("PendingReview");
  const [adminOwnerId, setAdminOwnerId] = useState("");
  const [amenityCategories, setAmenityCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [allImages, setAllImages] = useState<PropertyImageResponse[]>([]);
  const [completion, setCompletion] = useState<PropertyCompletionResponse | null>(null);
  const [coverImageId, setCoverImageId] = useState<number | null>(null);
  const [descriptionIds, setDescriptionIds] = useState<Partial<Record<string, number>>>({});
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(mode === "edit");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([
      apiRequest<AmenityCategoryResponse[]>("/amenity-categories"),
      apiRequest<AmenityResponse[]>("/amenities"),
    ])
      .then(([categories, items]) => {
        setAmenityCategories(categories);
        setAmenities(items);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [router]);

  useEffect(() => {
    if (mode !== "edit" || !propertyId) return;
    setBooting(true);
    Promise.all([
      apiRequest<PropertyResponse>(isAdmin ? `/admin/properties/${propertyId}` : `/owner/properties/${propertyId}`),
      apiRequest<PropertyCompletionResponse>(`/owner/properties/${propertyId}/completion`),
      apiRequest<PropertyDescriptionSectionResponse[]>(`/owner/properties/${propertyId}/descriptions`),
      apiRequest<PropertyImageResponse[]>(`/owner/properties/${propertyId}/images`),
      apiRequest<PropertyAmenityResponse[]>(`/owner/properties/${propertyId}/amenities`),
      apiRequest<PropertyCommonAreaResponse[]>(`/owner/properties/${propertyId}/common-areas`),
      apiRequest<NearbyPlaceResponse[]>(`/owner/properties/${propertyId}/nearby-places`),
      apiRequest<PropertyViewResponse[]>(`/owner/properties/${propertyId}/views`),
      apiRequest<RoomTypeResponse[]>(`/owner/properties/${propertyId}/room-types`).catch(() => []),
    ])
      .then(([propertyResult, completionResult, descriptions, images, propertyAmenities, commonAreas, nearbyPlaces, views, roomTypeItems]) => {
        setProperty(propertyResult);
        setAllImages(images);
        setRoomTypes(roomTypeItems);
        setCompletion(completionResult);
        setAdminStatus(propertyResult.status as PropertyStatus);
        setAdminOwnerId(String(propertyResult.ownerId));
        setCoverImageId(images.find((image) => image.isCover)?.id ?? null);
        setDescriptionIds(Object.fromEntries(descriptions.map((section) => [section.sectionType, section.id])));
        const intro = descriptions.find((section) => section.sectionType === "PropertyIntroduction");
        const notes = descriptions.find((section) => section.sectionType === "ImportantNotes");
        setData({
          name: propertyResult.name,
          englishName: propertyResult.englishName ?? "",
          type: propertyResult.type,
          city: propertyResult.city,
          address: propertyResult.address,
          latitude: propertyResult.latitude == null ? "" : String(propertyResult.latitude),
          longitude: propertyResult.longitude == null ? "" : String(propertyResult.longitude),
          totalArea: propertyResult.totalAreaM2 == null ? "" : String(propertyResult.totalAreaM2),
          landArea: propertyResult.landAreaM2 == null ? "" : String(propertyResult.landAreaM2),
          floors: propertyResult.floorsCount == null ? "1" : String(propertyResult.floorsCount),
          hasElevator: propertyResult.hasElevator,
          isWheelchairAccessible: Boolean(propertyResult.isWheelchairAccessible),
          hasGroundFloorRoom: Boolean(propertyResult.hasGroundFloorRoom),
          hasAccessibleBathroom: Boolean(propertyResult.hasAccessibleBathroom),
          inventoryMode: propertyResult.inventoryMode,
          selectedAmenityIds: propertyAmenities.map((amenity) => amenity.amenityId),
          coverImage: images.find((image) => image.isCover)?.url ?? "",
          propertyImages: [
            ...images.filter((image) => !image.isCover && !image.roomTypeId && !image.roomId).map((image) => ({ url: image.url, tag: image.tag ?? "", imageId: image.id })),
            { url: "", tag: "gallery" },
          ],
          propertyDescription: intro?.content ?? propertyResult.description ?? "",
          additionalNotes: notes?.content ?? "",
          commonAreas: commonAreas.length ? commonAreas.map((area) => ({ id: area.id, name: area.name, description: area.description ?? "" })) : [{ name: "", description: "" }],
          views: views.map((view) => view.viewType),
          nearbyPlaces: nearbyPlaces.filter((place) => place.isActive).length
            ? nearbyPlaces.filter((place) => place.isActive).map((place) => ({ id: place.id, title: place.title, drivingMinutes: place.drivingMinutes == null ? "" : String(place.drivingMinutes), walkingMinutes: place.walkingMinutes == null ? "" : String(place.walkingMinutes), isDefault: place.isDefault }))
            : [{ title: "", drivingMinutes: "", walkingMinutes: "", isDefault: false }],
          checkInTime: propertyResult.checkInTime ?? "14:00",
          checkOutTime: propertyResult.checkOutTime ?? "12:00",
          seoTitle: propertyResult.seoTitle ?? "",
          seoDescription: propertyResult.seoDescription ?? "",
        });
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBooting(false));
  }, [isAdmin, mode, propertyId]);

  const propertyAmenityOptions = amenities.filter((item) => item.scope !== "RoomType");
  const completed = useMemo(() => [
    Boolean(data.name.trim() && data.englishName.trim()),
    Boolean(data.city.trim() && data.address.trim()),
    Number(data.floors) > 0,
    data.selectedAmenityIds.length > 0 || data.views.length > 0,
    Boolean(data.coverImage.trim() || cleanImages(data.propertyImages).length),
    Boolean(data.propertyDescription.trim() || cleanCommonAreas(data.commonAreas).length),
    cleanNearbyPlaces(data.nearbyPlaces).length > 0,
    Boolean(data.checkInTime && data.checkOutTime),
    Boolean(property),
  ], [data, property]);

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
      totalAreaM2: data.totalArea === "" ? null : Number(data.totalArea),
      landAreaM2: data.landArea === "" ? null : Number(data.landArea),
      floorsCount: data.floors === "" ? null : Number(data.floors),
      stairCount: null,
      hasElevator: data.hasElevator,
      isWheelchairAccessible: data.isWheelchairAccessible,
      hasGroundFloorRoom: data.hasGroundFloorRoom,
      hasAccessibleBathroom: data.hasAccessibleBathroom,
    };
    return isAdmin && property ? { ...payload, ownerId: Number(adminOwnerId || property.ownerId), status: adminStatus } : payload;
  }

  async function saveProperty(description?: string) {
    const body = JSON.stringify(propertyPayload(description));
    if (property) {
      const updated = await apiRequest<PropertyResponse>(isAdmin ? `/admin/properties/${property.id}` : `/owner/properties/${property.id}`, {
        method: "PUT",
        body,
      });
      setProperty(updated);
      return updated;
    }
    const created = await apiRequest<PropertyResponse>("/owner/properties", { method: "POST", body });
    setProperty(created);
    return created;
  }

  async function saveAmenities(propertyId: number) {
    await apiRequest<PropertyAmenityResponse[]>(`/owner/properties/${propertyId}/amenities`, {
      method: "PUT",
      body: JSON.stringify({ amenityIds: data.selectedAmenityIds }),
    });
    await apiRequest(`/owner/properties/${propertyId}/views`, {
      method: "PUT",
      body: JSON.stringify({ views: data.views }),
    });
  }

  async function saveImages(propertyId: number) {
    if (data.coverImage.trim()) {
      const response = await apiRequest<PropertyImageResponse>(coverImageId ? `/owner/property-images/${coverImageId}` : `/owner/properties/${propertyId}/images`, {
        method: coverImageId ? "PUT" : "POST",
        body: JSON.stringify({ url: data.coverImage.trim(), tag: "cover", sortOrder: 0, isCover: true, isGallery: true }),
      });
      setCoverImageId(response.id);
      setAllImages((current) => [
        ...current.map((image) => image.roomTypeId == null && image.roomId == null ? { ...image, isCover: false } : image).filter((image) => image.id !== response.id),
        response,
      ]);
    }

    const images = [...data.propertyImages];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      if (!image.url.trim()) continue;
      const response = await apiRequest<PropertyImageResponse>(image.imageId ? `/owner/property-images/${image.imageId}` : `/owner/properties/${propertyId}/images`, {
        method: image.imageId ? "PUT" : "POST",
        body: JSON.stringify({ url: image.url.trim(), tag: image.tag.trim() || null, sortOrder: index + 1, isCover: false, isGallery: true }),
      });
      images[index] = { ...image, imageId: response.id };
      setAllImages((current) => [...current.filter((item) => item.id !== response.id), response]);
    }
    update("propertyImages", images.some((image) => !image.url.trim()) ? images : [...images, { url: "", tag: "gallery" }]);
  }

  async function saveDescriptions(propertyId: number) {
    const sections = [
      { sectionType: "PropertyIntroduction", title: "معرفی اقامتگاه", content: data.propertyDescription.trim(), sortOrder: 1 },
      { sectionType: "ImportantNotes", title: "نکات مهم", content: data.additionalNotes.trim(), sortOrder: 2 },
    ].filter((section) => section.content);
    const ids = { ...descriptionIds };
    for (const section of sections) {
      const id = ids[section.sectionType];
      const saved = await apiRequest<PropertyDescriptionSectionResponse>(id ? `/owner/property-descriptions/${id}` : `/owner/properties/${propertyId}/descriptions`, {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(section),
      });
      ids[section.sectionType] = saved.id;
    }
    setDescriptionIds(ids);

    const existing = await apiRequest<PropertyCommonAreaResponse[]>(`/owner/properties/${propertyId}/common-areas`);
    const desired = cleanCommonAreas(data.commonAreas);
    for (let index = 0; index < desired.length; index += 1) {
      const area = desired[index];
      const found = area.id ? existing.find((item) => item.id === area.id) : existing.find((item) => item.name === area.name);
      await apiRequest<PropertyCommonAreaResponse>(found ? `/owner/common-areas/${found.id}` : `/owner/properties/${propertyId}/common-areas`, {
        method: found ? "PUT" : "POST",
        body: JSON.stringify({ name: area.name.trim(), description: area.description.trim() || null, sortOrder: index + 1 }),
      });
    }
    await saveProperty(data.propertyDescription.trim());
  }

  async function saveNearbyPlaces(propertyId: number) {
    const existing = await apiRequest<NearbyPlaceResponse[]>(`/owner/properties/${propertyId}/nearby-places`);
    const desired = cleanNearbyPlaces(data.nearbyPlaces);
    const desiredTitles = new Set(desired.map((place) => place.title.toLocaleLowerCase()));
    for (const place of desired) {
      const found = place.id ? existing.find((item) => item.id === place.id) : existing.find((item) => item.title.toLocaleLowerCase() === place.title.toLocaleLowerCase());
      await apiRequest<NearbyPlaceResponse>(found ? `/owner/nearby-places/${found.id}` : `/owner/properties/${propertyId}/nearby-places`, {
        method: found ? "PUT" : "POST",
        body: JSON.stringify({
          title: place.title.trim(),
          category: nearbyCategory(place.title),
          distanceInMeters: null,
          walkingMinutes: place.walkingMinutes === "" ? null : Number(place.walkingMinutes),
          drivingMinutes: place.drivingMinutes === "" ? null : Number(place.drivingMinutes),
          description: null,
          latitude: null,
          longitude: null,
          isDefault: place.isDefault,
          isCustom: !place.isDefault,
          isActive: true,
        }),
      });
    }
    for (const place of existing.filter((item) => item.isActive && !desiredTitles.has(item.title.toLocaleLowerCase()))) {
      await apiRequest<NearbyPlaceResponse>(`/owner/nearby-places/${place.id}`, { method: "PUT", body: JSON.stringify({ ...place, isActive: false }) });
    }
  }

  function validateStep(index = step) {
    if (index === 0 && (!data.name.trim() || !data.englishName.trim())) return "نام فارسی و انگلیسی را وارد کنید.";
    if (index === 1 && (!data.city.trim() || !data.address.trim())) return "شهر و نشانی را کامل کنید.";
    if (index === 2 && Number(data.floors || 0) < 1) return "تعداد طبقات باید حداقل ۱ باشد.";
    if (index === 7 && (!data.checkInTime || !data.checkOutTime)) return "زمان ورود و خروج را وارد کنید.";
    return "";
  }

  async function saveCurrentStep() {
    const saved = await saveProperty(step === 5 ? data.propertyDescription.trim() : property?.description ?? data.propertyDescription.trim());
    if (step === 3) await saveAmenities(saved.id);
    if (step === 4) await saveImages(saved.id);
    if (step === 5) await saveDescriptions(saved.id);
    if (step === 6) await saveNearbyPlaces(saved.id);
    if (step === 8 && isAdmin) await saveProperty(data.propertyDescription.trim());
    setCompletion(await apiRequest<PropertyCompletionResponse>(`/owner/properties/${saved.id}/completion`).catch(() => completion as PropertyCompletionResponse));
    return saved;
  }

  async function nextStep() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await saveCurrentStep();
      setStep((current) => Math.min(current + 1, steps.length - 1));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "این مرحله ذخیره نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const saved = await saveCurrentStep();
      onDone?.(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره نهایی انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  function addImageField() {
    update("propertyImages", [...data.propertyImages, { url: "", tag: "gallery" }]);
  }

  function syncImages(images: PropertyImageResponse[]) {
    setAllImages(images);
    const cover = images.find((image) => image.isCover && !image.roomTypeId && !image.roomId);
    setCoverImageId(cover?.id ?? null);
    setData((current) => ({
      ...current,
      coverImage: cover?.url ?? "",
      propertyImages: [
        ...images
          .filter((image) => !image.isCover && !image.roomTypeId && !image.roomId)
          .map((image) => ({ url: image.url, tag: image.tag ?? "", imageId: image.id })),
        { url: "", tag: "gallery" },
      ],
    }));
  }

  function handleUploadedImages(images: PropertyImageResponse[]) {
    if (!images.length) return;
    syncImages([...allImages.filter((image) => !images.some((item) => item.id === image.id)), ...images]);
  }

  if (booting) {
    return <div className={cardClass}>در حال بارگذاری اطلاعات اقامتگاه...</div>;
  }

  return (
    <form className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]" dir="rtl" onSubmit={finish}>
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-5">
        <div className="mb-3 px-2">
          <p className="text-xs font-bold text-slate-400">{mode === "create" ? "ثبت اقامتگاه" : "ویرایش اقامتگاه"}</p>
          <p className="mt-1 text-sm font-black text-slate-900">مرحله {step + 1} از {steps.length}</p>
        </div>
        <nav className="grid gap-1">
          {steps.map((label, index) => (
            <button
              className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-right text-sm font-bold ${step === index ? "bg-blue-600 text-white" : completed[index] ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}
              key={label}
              onClick={() => {
                setError("");
                setStep(index);
              }}
              type="button"
            >
              <span>{label}</span>
              <span>{completed[index] ? "✓" : index + 1}</span>
            </button>
          ))}
        </nav>
        {property && (
          <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4">
            <Link className="rounded-xl border border-slate-200 px-3 py-2 text-center text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" href={isAdmin ? `/admin/properties/${property.id}/rooms` : `/owner/properties/${property.id}/rooms`}>
              مدیریت اتاق‌ها
            </Link>
            <Link className="rounded-xl border border-slate-200 px-3 py-2 text-center text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" href="/owner/properties">
              بازگشت به لیست اقامتگاه‌ها
            </Link>
          </div>
        )}
      </aside>

      <main className="min-w-0">
        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

        {step === 0 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-black">اطلاعات پایه</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">نام فارسی<input className={inputClass} onChange={(event) => update("name", event.target.value)} value={data.name} /></label>
              <label className="grid gap-1 text-sm font-bold">نام انگلیسی<input className={inputClass} dir="ltr" onChange={(event) => update("englishName", event.target.value)} value={data.englishName} /></label>
              <label className="grid gap-1 text-sm font-bold">نوع اقامتگاه<select className={inputClass} onChange={(event) => update("type", event.target.value as PropertyType)} value={data.type}>{propertyTypes.map((type) => <option key={type} value={type}>{propertyTypeLabels[type]}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-bold">مدل موجودی<select className={inputClass} onChange={(event) => update("inventoryMode", event.target.value as InventoryMode)} value={data.inventoryMode}><option value="NamedRooms">اتاق نام‌دار</option><option value="TypeBasedInventory">موجودی تعدادی</option></select></label>
              {isAdmin && <label className="grid gap-1 text-sm font-bold">وضعیت<select className={inputClass} onChange={(event) => setAdminStatus(event.target.value as PropertyStatus)} value={adminStatus}>{propertyStatusOptions.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-black">موقعیت و نشانی</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">شهر<input className={inputClass} onChange={(event) => update("city", event.target.value)} value={data.city} /></label>
              <label className="grid gap-1 text-sm font-bold md:col-span-2">نشانی<input className={inputClass} onChange={(event) => update("address", event.target.value)} value={data.address} /></label>
              <label className="grid gap-1 text-sm font-bold">عرض جغرافیایی<input className={inputClass} dir="ltr" onChange={(event) => update("latitude", event.target.value)} type="number" value={data.latitude} /></label>
              <label className="grid gap-1 text-sm font-bold">طول جغرافیایی<input className={inputClass} dir="ltr" onChange={(event) => update("longitude", event.target.value)} type="number" value={data.longitude} /></label>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-black">ساختمان و دسترسی</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="grid gap-1 text-sm font-bold">زیربنا<input className={inputClass} min="0" onChange={(event) => update("totalArea", event.target.value)} type="number" value={data.totalArea} /></label>
              <label className="grid gap-1 text-sm font-bold">مساحت زمین<input className={inputClass} min="0" onChange={(event) => update("landArea", event.target.value)} type="number" value={data.landArea} /></label>
              <label className="grid gap-1 text-sm font-bold">تعداد طبقات<input className={inputClass} min="1" onChange={(event) => update("floors", event.target.value)} type="number" value={data.floors} /></label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["hasElevator", "آسانسور دارد؟"],
                ["isWheelchairAccessible", "مناسب ویلچر هست؟"],
                ["hasGroundFloorRoom", "اتاق همکف دارد؟"],
                ["hasAccessibleBathroom", "سرویس بهداشتی مناسب افراد کم‌توان دارد؟"],
              ].map(([key, label]) => (
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-bold" key={key}>
                  <input checked={Boolean(data[key as keyof WizardData])} className="h-4 w-4 accent-blue-600" onChange={(event) => update(key as keyof WizardData, event.target.checked as never)} type="checkbox" />
                  {label}
                </label>
              ))}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className={`${cardClass} grid gap-5`}>
            <h2 className="text-2xl font-black">امکانات و چشم‌انداز</h2>
            {amenityCategories.map((category) => {
              const categoryAmenities = propertyAmenityOptions.filter((item) => item.amenityCategoryId === category.id);
              if (!categoryAmenities.length) return null;
              return (
                <fieldset className="grid gap-2" key={category.id}>
                  <legend className="mb-2 text-lg font-black">{category.name}</legend>
                  <div className="grid gap-2 md:grid-cols-3">
                    {categoryAmenities.map((amenity) => (
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-bold" key={amenity.id}>
                        <input checked={data.selectedAmenityIds.includes(amenity.id)} className="h-4 w-4 accent-blue-600" onChange={(event) => update("selectedAmenityIds", event.target.checked ? [...data.selectedAmenityIds, amenity.id] : data.selectedAmenityIds.filter((id) => id !== amenity.id))} type="checkbox" />
                        {amenity.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            <fieldset>
              <legend className="mb-2 text-lg font-black">چشم‌انداز</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {propertyViewOptions.map((view) => (
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-bold" key={view}>
                    <input checked={data.views.includes(view)} className="h-4 w-4 accent-blue-600" onChange={(event) => update("views", event.target.checked ? [...data.views, view] : data.views.filter((item) => item !== view))} type="checkbox" />
                    {propertyViewLabels[view]}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        )}

        {step === 4 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-black">تصاویر اقامتگاه</h2>
            <ImageUploadDropzone
              onUploaded={handleUploadedImages}
              propertyId={property?.id ?? null}
              roomTypes={roomTypes}
            />
            <div className="grid gap-3">
              <h3 className="font-black">گالری تصاویر</h3>
              <PropertyImageManager
                images={allImages}
                onImagesChange={syncImages}
                roomTypes={roomTypes}
              />
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <h3 className="font-black">افزودن تصویر با نشانی</h3>
              <p className="mt-1 text-sm text-slate-500">این روش به عنوان جایگزین ساده برای تصویرهای آماده باقی می‌ماند.</p>
            </div>
            <label className="grid gap-1 text-sm font-bold">تصویر کاور<input className={inputClass} dir="ltr" onChange={(event) => update("coverImage", event.target.value)} type="url" value={data.coverImage} /></label>
            {data.coverImage.trim() && <img alt="تصویر کاور" className="h-[120px] w-[160px] rounded-xl object-cover" src={data.coverImage} />}
            {data.propertyImages.map((image, index) => (
              <div className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-2" key={index}>
                {image.url.trim() && <img alt={image.tag || "تصویر اقامتگاه"} className="h-[120px] w-[160px] rounded-xl object-cover md:col-span-2" src={image.url} />}
                <input className={inputClass} dir="ltr" onChange={(event) => {
                  const next = [...data.propertyImages];
                  next[index] = { ...next[index], url: event.target.value };
                  update("propertyImages", next);
                }} placeholder="نشانی تصویر" type="url" value={image.url} />
                <input className={inputClass} onChange={(event) => {
                  const next = [...data.propertyImages];
                  next[index] = { ...next[index], tag: event.target.value };
                  update("propertyImages", next);
                }} placeholder="برچسب تصویر" value={image.tag} />
              </div>
            ))}
            <button className="justify-self-start rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold" onClick={addImageField} type="button">افزودن تصویر</button>
          </section>
        )}

        {step === 5 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-black">توضیحات و فضاها</h2>
            <label className="grid gap-1 text-sm font-bold">توضیحات اقامتگاه<textarea className={inputClass} onChange={(event) => update("propertyDescription", event.target.value)} rows={5} value={data.propertyDescription} /></label>
            <div className="grid gap-3 rounded-xl border border-slate-200 p-4">
              <strong>فضاهای مشترک</strong>
              {data.commonAreas.map((area, index) => (
                <div className="grid gap-2 md:grid-cols-[1fr_1.5fr_auto]" key={index}>
                  <input className={inputClass} onChange={(event) => {
                    const next = [...data.commonAreas];
                    next[index] = { ...next[index], name: event.target.value };
                    update("commonAreas", next);
                  }} placeholder="حیاط مرکزی" value={area.name} />
                  <input className={inputClass} onChange={(event) => {
                    const next = [...data.commonAreas];
                    next[index] = { ...next[index], description: event.target.value };
                    update("commonAreas", next);
                  }} placeholder="توضیح اختیاری" value={area.description} />
                  <button className="text-sm font-bold text-red-700" onClick={() => update("commonAreas", data.commonAreas.filter((_, candidate) => candidate !== index))} type="button">حذف</button>
                </div>
              ))}
              <button className="justify-self-start rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold" onClick={() => update("commonAreas", [...data.commonAreas, { name: "", description: "" }])} type="button">افزودن فضای مشترک</button>
            </div>
            <label className="grid gap-1 text-sm font-bold">نکات تکمیلی<textarea className={inputClass} onChange={(event) => update("additionalNotes", event.target.value)} rows={4} value={data.additionalNotes} /></label>
          </section>
        )}

        {step === 6 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-black">مکان‌های نزدیک</h2>
            <div className="grid gap-2 md:grid-cols-3">{defaultNearbyPlaces.map((place) => <button className="rounded-xl border border-slate-200 p-3 text-right text-sm font-bold" key={place} onClick={() => update("nearbyPlaces", data.nearbyPlaces.some((item) => item.title === place) ? data.nearbyPlaces.filter((item) => item.title !== place) : [...data.nearbyPlaces, { title: place, drivingMinutes: "", walkingMinutes: "", isDefault: true }])} type="button">{data.nearbyPlaces.some((item) => item.title === place) ? "انتخاب شده: " : ""}{place}</button>)}</div>
            {data.nearbyPlaces.map((place, index) => (
              <div className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_140px_140px_auto]" key={index}>
                <input className={inputClass} disabled={place.isDefault} onChange={(event) => {
                  const next = [...data.nearbyPlaces];
                  next[index] = { ...next[index], title: event.target.value };
                  update("nearbyPlaces", next);
                }} placeholder="مکان دلخواه" value={place.title} />
                <input className={inputClass} min="0" onChange={(event) => {
                  const next = [...data.nearbyPlaces];
                  next[index] = { ...next[index], drivingMinutes: event.target.value };
                  update("nearbyPlaces", next);
                }} placeholder="با خودرو" type="number" value={place.drivingMinutes} />
                <input className={inputClass} min="0" onChange={(event) => {
                  const next = [...data.nearbyPlaces];
                  next[index] = { ...next[index], walkingMinutes: event.target.value };
                  update("nearbyPlaces", next);
                }} placeholder="پیاده" type="number" value={place.walkingMinutes} />
                <button className="text-sm font-bold text-red-700" onClick={() => update("nearbyPlaces", data.nearbyPlaces.filter((_, candidate) => candidate !== index))} type="button">حذف</button>
              </div>
            ))}
            <button className="justify-self-start rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold" onClick={() => update("nearbyPlaces", [...data.nearbyPlaces, { title: "", drivingMinutes: "", walkingMinutes: "", isDefault: false }])} type="button">افزودن مکان</button>
          </section>
        )}

        {step === 7 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-black">قوانین و زمان‌ها</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">ساعت ورود<input className={inputClass} onChange={(event) => update("checkInTime", event.target.value)} type="time" value={data.checkInTime} /></label>
              <label className="grid gap-1 text-sm font-bold">ساعت خروج<input className={inputClass} onChange={(event) => update("checkOutTime", event.target.value)} type="time" value={data.checkOutTime} /></label>
              <label className="grid gap-1 text-sm font-bold md:col-span-2">عنوان سئو<input className={inputClass} onChange={(event) => update("seoTitle", event.target.value)} value={data.seoTitle} /></label>
              <label className="grid gap-1 text-sm font-bold md:col-span-2">توضیح سئو<textarea className={inputClass} onChange={(event) => update("seoDescription", event.target.value)} rows={3} value={data.seoDescription} /></label>
            </div>
          </section>
        )}

        {step === 8 && (
          <section className="grid gap-4">
            <div className={cardClass}>
              <h2 className="text-2xl font-black">بازبینی</h2>
              <p className="mt-1 text-sm text-slate-500">میزان تکمیل اطلاعات: {completion?.completionPercentage ?? 0}٪</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ReviewCard title="اطلاعات پایه" lines={[data.name, propertyTypeLabels[data.type], data.city]} />
              <ReviewCard title="دسترسی" lines={[boolLabel(data.hasElevator, "آسانسور"), boolLabel(data.isWheelchairAccessible, "مناسب ویلچر"), boolLabel(data.hasGroundFloorRoom, "اتاق همکف"), boolLabel(data.hasAccessibleBathroom, "سرویس مناسب افراد کم‌توان")]} />
              <ReviewCard title="فضاهای مشترک" lines={cleanCommonAreas(data.commonAreas).map((area) => area.name)} />
              <ReviewCard title="مکان‌های نزدیک" lines={cleanNearbyPlaces(data.nearbyPlaces).map((place) => place.title)} />
            </div>
            {property && (
              <div className={`${cardClass} grid gap-3 md:grid-cols-3`}>
                <Link className="rounded-xl bg-blue-600 px-4 py-3 text-center font-black text-white" href={isAdmin ? `/admin/properties/${property.id}/rooms` : `/owner/properties/${property.id}/rooms`}>مدیریت اتاق‌ها</Link>
                {property.slug && <Link className="rounded-xl border border-slate-300 px-4 py-3 text-center font-black text-slate-700" href={`/properties/${property.slug}`}>مشاهده صفحه عمومی</Link>}
                <Link className="rounded-xl border border-slate-300 px-4 py-3 text-center font-black text-slate-700" href={isAdmin ? "/admin/properties" : "/owner/properties"}>بازگشت به لیست اقامتگاه‌ها</Link>
              </div>
            )}
          </section>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button className="rounded-xl border border-slate-300 px-5 py-3 font-bold disabled:opacity-40" disabled={step === 0 || loading} onClick={() => { setError(""); setStep((current) => Math.max(0, current - 1)); }} type="button">قبلی</button>
          <div className="flex gap-2">
            <button className="rounded-xl border border-blue-600 px-5 py-3 font-bold text-blue-700 disabled:opacity-50" disabled={loading} onClick={async () => {
              setLoading(true);
              setError("");
              try { await saveCurrentStep(); } catch (caught) { setError(caught instanceof Error ? caught.message : "ذخیره انجام نشد."); } finally { setLoading(false); }
            }} type="button">ذخیره</button>
            {step < steps.length - 1 ? <button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-60" disabled={loading} onClick={nextStep} type="button">{loading ? "در حال ذخیره..." : "ذخیره و ادامه"}</button> : <button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-60" disabled={loading} type="submit">پایان</button>}
          </div>
        </div>
      </main>
    </form>
  );
}

function ReviewCard({ title, lines }: { title: string; lines: string[] }) {
  const visibleLines = lines.filter(Boolean);
  return (
    <article className={cardClass}>
      <h3 className="mb-2 text-lg font-black">{title}</h3>
      {visibleLines.length ? <ul className="grid gap-1 text-sm text-slate-600">{visibleLines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : <p className="text-sm text-slate-400">موردی ثبت نشده است.</p>}
    </article>
  );
}
