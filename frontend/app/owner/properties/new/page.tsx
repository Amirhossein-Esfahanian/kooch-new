"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OwnerPage } from "@/components/owner/OwnerPage";
import {
  AmenityCategoryResponse,
  AmenityResponse,
  apiRequest,
  BedTypeResponse,
  getToken,
  InventoryMode,
  NearbyPlaceCategory,
  NearbyPlaceResponse,
  PropertyAmenityResponse,
  PropertyCompletionResponse,
  PropertyDescriptionSectionResponse,
  propertyTypes,
  PropertyResponse,
  PropertyImageResponse,
  PropertyViewType,
  PropertyType,
  RoomResponse,
  RoomTypeResponse,
  toPropertyPayload,
} from "@/lib/owner-api";

const steps = [
  "اطلاعات پایه",
  "اطلاعات ساختمان",
  "مدل اقامت",
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

export default function NewPropertyPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialData);
  const [accommodations, setAccommodations] = useState<AccommodationDraft[]>([]);
  const [accommodation, setAccommodation] = useState(emptyAccommodation);
  const [amenityCategories, setAmenityCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [amenitiesLoading, setAmenitiesLoading] = useState(true);
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [completion, setCompletion] = useState<PropertyCompletionResponse | null>(null);
  const [coverImageId, setCoverImageId] = useState<number | null>(null);
  const [descriptionIds, setDescriptionIds] = useState<Partial<Record<string, number>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/owner/login");
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
    if (step === 5 && !data.propertyDescription.trim()) {
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
    const saved = await apiRequest<PropertyResponse>(property ? `/owner/properties/${property.id}` : "/owner/properties", {
      method: property ? "PUT" : "POST",
      body: JSON.stringify(propertyPayload(description)),
    });
    setProperty(saved);
    return saved;
  }

  async function saveAccommodations(propertyId: number) {
    const saved = [...accommodations];
    for (let index = 0; index < saved.length; index += 1) {
      const item = saved[index];
      if (item.roomTypeId) continue;
      const roomType = await apiRequest<RoomTypeResponse>(`/owner/properties/${propertyId}/room-types`, {
        method: "POST",
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
        }),
      });
      let roomId: number | undefined;
      if (data.inventoryMode === "NamedRooms") {
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
      saved[index] = { ...item, roomTypeId: roomType.id, roomId };
    }
    setAccommodations(saved);
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
    if (step === 3) {
      await apiRequest<PropertyAmenityResponse[]>(`/owner/properties/${property.id}/amenities`, { method: "PUT", body: JSON.stringify({ amenityIds: data.selectedAmenityIds }) });
      await apiRequest(`/owner/properties/${property.id}/views`, { method: "PUT", body: JSON.stringify({ views: data.views }) });
    }
    if (step === 4) await saveImages(property.id);
    if (step === 5) await saveDescriptions(property.id);
    if (step === 6) await saveNearbyPlaces(property.id);
    return property;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (property) router.push(`/owner/properties/${property.id}`);
  }

  const namedRooms = data.inventoryMode === "NamedRooms";

  return (
    <OwnerPage title="ثبت اقامتگاه">
      <div className="mb-6" dir="rtl">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <span>مرحله {step + 1} از ۸</span>
          <span>{steps[step]}</span>
        </div>
        <div className="grid grid-cols-8 gap-1" aria-label={`Step ${step + 1} of 8`}>
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

        {step === 4 && (
          <section className={`${cardClass} grid gap-5`}>
            <div><h2 className="text-2xl font-bold">تصاویر</h2><p className="text-sm text-ink/60">تا زمان فعال شدن آپلود، نشانی اینترنتی تصویر را وارد کنید.</p></div>
            <label className="grid gap-1 text-sm font-semibold">نشانی تصویر کاور<input className={inputClass} dir="ltr" onChange={(event) => update("coverImage", event.target.value)} type="url" value={data.coverImage} /></label>
            <ImageFields images={data.propertyImages} label="تصویر اقامتگاه" onAdd={() => addImageField("propertyImages")} onChange={(index, value) => updateImageList("propertyImages", index, value)} />
            <ImageFields accommodations={accommodations} images={data.roomImages} label="تصویر اتاق" onAdd={() => addImageField("roomImages")} onChange={(index, value) => updateImageList("roomImages", index, value)} />
          </section>
        )}

        {step === 5 && (
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

        {step === 6 && (
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

        {step === 7 && (
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
          {step < 7 ? <button className="rounded-lg bg-ink px-5 py-3 font-bold text-white disabled:opacity-60" disabled={loading} onClick={nextStep} type="button">{loading ? "در حال ذخیره..." : "ذخیره و ادامه"}</button> : <button className="rounded-lg bg-ink px-5 py-3 font-bold text-white disabled:opacity-60" disabled={loading || !property} type="submit">پایان</button>}
        </div>
      </form>
    </OwnerPage>
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
