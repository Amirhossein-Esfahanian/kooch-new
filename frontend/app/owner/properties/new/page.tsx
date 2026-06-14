"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OwnerPage } from "@/components/owner/OwnerPage";
import {
  AmenityCategoryResponse,
  AmenityResponse,
  apiRequest,
  createSlug,
  getToken,
  InventoryMode,
  propertyTypes,
  PropertyResponse,
  PropertyType,
  RoomResponse,
  RoomTypeResponse,
  toPropertyPayload,
} from "@/lib/owner-api";

const steps = [
  "Basic Information",
  "Building Information",
  "Accommodation Model",
  "Amenities",
  "Images",
  "Descriptions",
  "Nearby Places",
  "Review",
];

const defaultNearbyPlaces = [
  "Railway Station",
  "Bus Terminal",
  "Fin Garden",
  "Bazaar",
  "Tabatabaei House",
  "Borujerdi House",
  "Kamal-ol-Molk Square",
];

interface AccommodationDraft {
  id: number;
  name: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  totalInventory: number;
  basePrice: string;
}

interface WizardData {
  name: string;
  type: PropertyType;
  city: string;
  address: string;
  totalArea: string;
  floors: number;
  hasElevator: boolean;
  stairCount: number;
  inventoryMode: InventoryMode;
  selectedAmenityIds: number[];
  coverImage: string;
  propertyImages: string[];
  roomImages: string[];
  propertyDescription: string;
  commonAreasDescription: string;
  additionalNotes: string;
  selectedNearbyPlaces: string[];
  customNearbyPlaces: string[];
}

const initialData: WizardData = {
  name: "",
  type: "TraditionalHouse",
  city: "Kashan",
  address: "",
  totalArea: "",
  floors: 1,
  hasElevator: false,
  stairCount: 0,
  inventoryMode: "NamedRooms",
  selectedAmenityIds: [],
  coverImage: "",
  propertyImages: [""],
  roomImages: [""],
  propertyDescription: "",
  commonAreasDescription: "",
  additionalNotes: "",
  selectedNearbyPlaces: [],
  customNearbyPlaces: [""],
};

const emptyAccommodation = {
  name: "",
  description: "",
  maxAdults: 2,
  maxChildren: 0,
  totalInventory: 1,
  basePrice: "",
};

const inputClass = "w-full rounded-lg border border-ink/20 bg-white px-3 py-2";
const cardClass = "rounded-xl border border-ink/10 bg-white p-5 shadow-sm";

function compact(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function buildDescription(data: WizardData) {
  const building = [
    data.totalArea && `Total area: ${data.totalArea} m2`,
    `Floors: ${data.floors}`,
    `Elevator: ${data.hasElevator ? "Yes" : "No"}`,
    `Stair count: ${data.stairCount}`,
  ].filter(Boolean).join("; ");

  return [
    data.propertyDescription,
    data.commonAreasDescription && `Common areas: ${data.commonAreasDescription}`,
    data.additionalNotes && `Additional notes: ${data.additionalNotes}`,
    `Building information: ${building}`,
  ].filter(Boolean).join("\n\n");
}

export default function NewPropertyPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialData);
  const [accommodations, setAccommodations] = useState<AccommodationDraft[]>([]);
  const [accommodation, setAccommodation] = useState(emptyAccommodation);
  const [amenityCategories, setAmenityCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [amenitiesLoading, setAmenitiesLoading] = useState(true);
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
    ])
      .then(([categories, items]) => {
        setAmenityCategories(categories);
        setAmenities(items);
      })
      .catch(() => setError("Amenities could not be loaded. You can continue and try again later."))
      .finally(() => setAmenitiesLoading(false));
  }, [router]);

  const selectedAmenities = useMemo(
    () => amenities.filter((item) => data.selectedAmenityIds.includes(item.id)),
    [amenities, data.selectedAmenityIds],
  );

  const completionItems = [
    { label: "Basic information", complete: Boolean(data.name.trim() && data.city.trim() && data.address.trim()) },
    { label: "Building information", complete: data.floors > 0 && data.stairCount >= 0 },
    { label: "Accommodation model", complete: accommodations.length > 0 },
    { label: "Amenities", complete: data.selectedAmenityIds.length > 0 },
    { label: "Images", complete: Boolean(data.coverImage.trim() || compact(data.propertyImages).length || compact(data.roomImages).length) },
    { label: "Descriptions", complete: Boolean(data.propertyDescription.trim()) },
    { label: "Nearby places", complete: Boolean(data.selectedNearbyPlaces.length || compact(data.customNearbyPlaces).length) },
  ];

  function update<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((current) => ({ ...current, [key]: value }));
  }

  function validateCurrentStep() {
    if (step === 0 && (!data.name.trim() || !data.city.trim() || !data.address.trim())) {
      return "Complete the property name, city, and address.";
    }
    if (step === 1 && (data.floors < 1 || data.stairCount < 0)) {
      return "Floors must be at least 1 and stair count cannot be negative.";
    }
    if (step === 2 && accommodations.length === 0) {
      return `Add at least one ${data.inventoryMode === "NamedRooms" ? "named room" : "room type"}.`;
    }
    if (step === 5 && !data.propertyDescription.trim()) {
      return "Add a property description before continuing.";
    }
    return "";
  }

  function nextStep() {
    const validationError = validateCurrentStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function addAccommodation() {
    if (!accommodation.name.trim()) {
      setError(data.inventoryMode === "NamedRooms" ? "Enter a room name." : "Enter a room type name.");
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
      update("inventoryMode", mode);
      setAccommodations([]);
      setAccommodation(emptyAccommodation);
    }
  }

  function updateUrlList(key: "propertyImages" | "roomImages" | "customNearbyPlaces", index: number, value: string) {
    const values = [...data[key]];
    values[index] = value;
    update(key, values);
  }

  function addUrlField(key: "propertyImages" | "roomImages" | "customNearbyPlaces") {
    update(key, [...data[key], ""]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    let propertyId: number | null = null;

    try {
      const property = await apiRequest<PropertyResponse>("/owner/properties", {
        method: "POST",
        body: JSON.stringify(toPropertyPayload({
          name: data.name,
          description: buildDescription(data),
          address: data.address,
          city: data.city,
          type: data.type,
          inventoryMode: data.inventoryMode,
          checkInTime: "14:00",
          checkOutTime: "11:00",
        })),
      });
      propertyId = property.id;

      for (const item of accommodations) {
        const roomType = await apiRequest<RoomTypeResponse>(`/owner/properties/${property.id}/room-types`, {
          method: "POST",
          body: JSON.stringify({
            name: item.name,
            slug: createSlug(item.name),
            description: item.description || `${item.name} at ${property.name}`,
            maxAdults: item.maxAdults,
            maxChildren: item.maxChildren,
            totalInventory: data.inventoryMode === "NamedRooms" ? 1 : item.totalInventory,
            inventoryMode: data.inventoryMode,
            basePrice: item.basePrice === "" ? null : Number(item.basePrice),
          }),
        });

        if (data.inventoryMode === "NamedRooms") {
          await apiRequest<RoomResponse>(`/owner/room-types/${roomType.id}/rooms`, {
            method: "POST",
            body: JSON.stringify({ name: item.name }),
          });
        }
      }

      router.push(`/owner/properties/${property.id}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not create property.";
      setError(propertyId ? `${message} The property was created, but some accommodation data may be incomplete.` : message);
    } finally {
      setLoading(false);
    }
  }

  const namedRooms = data.inventoryMode === "NamedRooms";

  return (
    <OwnerPage title="Property onboarding">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <span>Step {step + 1}/8</span>
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

      <form onSubmit={submit}>
        {step === 0 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">Basic Information</h2>
            <label className="grid gap-1 text-sm font-semibold">Property name<input className={inputClass} onChange={(event) => update("name", event.target.value)} required value={data.name} /></label>
            <label className="grid gap-1 text-sm font-semibold">Property type<select className={inputClass} onChange={(event) => update("type", event.target.value as PropertyType)} value={data.type}>{propertyTypes.map((type) => <option key={type} value={type}>{type.replace(/([A-Z])/g, " $1").trim()}</option>)}</select></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">City<input className={inputClass} onChange={(event) => update("city", event.target.value)} required value={data.city} /></label>
              <label className="grid gap-1 text-sm font-semibold">Address<input className={inputClass} onChange={(event) => update("address", event.target.value)} required value={data.address} /></label>
            </div>
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-ink/25 bg-ink/[0.03] text-center text-sm text-ink/55">Map selection will be added when a map API is available.</div>
          </section>
        )}

        {step === 1 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">Building Information</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1 text-sm font-semibold">Total area (m2)<input className={inputClass} min="0" onChange={(event) => update("totalArea", event.target.value)} type="number" value={data.totalArea} /></label>
              <label className="grid gap-1 text-sm font-semibold">Floors<input className={inputClass} min="1" onChange={(event) => update("floors", Number(event.target.value))} type="number" value={data.floors} /></label>
              <label className="grid gap-1 text-sm font-semibold">Stair count<input className={inputClass} min="0" onChange={(event) => update("stairCount", Number(event.target.value))} type="number" value={data.stairCount} /></label>
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-ink/15 p-4 font-semibold"><input checked={data.hasElevator} onChange={(event) => update("hasElevator", event.target.checked)} type="checkbox" />Building has an elevator</label>
          </section>
        )}

        {step === 2 && (
          <section className="grid gap-5">
            <div className={cardClass}>
              <h2 className="mb-3 text-2xl font-bold">Accommodation Model</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["NamedRooms", "TypeBasedInventory"] as InventoryMode[]).map((mode) => (
                  <button className={`rounded-xl border p-4 text-left ${data.inventoryMode === mode ? "border-ink bg-ink text-white" : "border-ink/20 bg-white"}`} key={mode} onClick={() => changeInventoryMode(mode)} type="button">
                    <strong>{mode === "NamedRooms" ? "Named Rooms" : "Room-Type Inventory"}</strong>
                    <span className="mt-1 block text-sm opacity-75">{mode === "NamedRooms" ? "Unique rooms such as Shah Abbasi, Toranj, or Panjdari." : "Types such as Double Room, Triple Room, or Family Suite."}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`${cardClass} grid gap-4`}>
              <h3 className="text-xl font-bold">{namedRooms ? "Add named room" : "Add room type"}</h3>
              <label className="grid gap-1 text-sm font-semibold">Name<input className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, name: event.target.value })} placeholder={namedRooms ? "Shah Abbasi" : "Double Room"} value={accommodation.name} /></label>
              <label className="grid gap-1 text-sm font-semibold">Description<textarea className={inputClass} onChange={(event) => setAccommodation({ ...accommodation, description: event.target.value })} rows={2} value={accommodation.description} /></label>
              <div className={`grid gap-4 ${namedRooms ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
                <label className="grid gap-1 text-sm font-semibold">Max adults<input className={inputClass} min="1" onChange={(event) => setAccommodation({ ...accommodation, maxAdults: Number(event.target.value) })} type="number" value={accommodation.maxAdults} /></label>
                <label className="grid gap-1 text-sm font-semibold">Max children<input className={inputClass} min="0" onChange={(event) => setAccommodation({ ...accommodation, maxChildren: Number(event.target.value) })} type="number" value={accommodation.maxChildren} /></label>
                {!namedRooms && <label className="grid gap-1 text-sm font-semibold">Inventory count<input className={inputClass} min="1" onChange={(event) => setAccommodation({ ...accommodation, totalInventory: Number(event.target.value) })} type="number" value={accommodation.totalInventory} /></label>}
                <label className="grid gap-1 text-sm font-semibold">Base price<input className={inputClass} min="0" onChange={(event) => setAccommodation({ ...accommodation, basePrice: event.target.value })} type="number" value={accommodation.basePrice} /></label>
              </div>
              <button className="rounded-lg bg-ink px-4 py-3 font-bold text-white" onClick={addAccommodation} type="button">{namedRooms ? "Add named room" : "Add room type"}</button>
            </div>
            <div className="grid gap-2">
              {accommodations.map((item) => <div className="flex items-center justify-between rounded-lg border border-ink/15 bg-white p-3" key={item.id}><span><strong>{item.name}</strong>{!namedRooms && ` - ${item.totalInventory} rooms`}</span><button className="text-sm font-semibold text-red-700" onClick={() => setAccommodations((current) => current.filter((candidate) => candidate.id !== item.id))} type="button">Remove</button></div>)}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className={`${cardClass} grid gap-5`}>
            <div><h2 className="text-2xl font-bold">Amenities</h2><p className="text-sm text-ink/60">Select the amenities available at this property.</p></div>
            {amenitiesLoading && <p>Loading amenities...</p>}
            {!amenitiesLoading && amenityCategories.map((category) => {
              const categoryAmenities = amenities.filter((item) => item.amenityCategoryId === category.id);
              return <fieldset className="grid gap-2" key={category.id}><legend className="mb-2 text-lg font-bold">{category.name}</legend><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{categoryAmenities.map((amenity) => <label className="flex items-center gap-2 rounded-lg border border-ink/10 p-3" key={amenity.id}><input checked={data.selectedAmenityIds.includes(amenity.id)} onChange={(event) => update("selectedAmenityIds", event.target.checked ? [...data.selectedAmenityIds, amenity.id] : data.selectedAmenityIds.filter((id) => id !== amenity.id))} type="checkbox" />{amenity.name}</label>)}</div></fieldset>;
            })}
          </section>
        )}

        {step === 4 && (
          <section className={`${cardClass} grid gap-5`}>
            <div><h2 className="text-2xl font-bold">Images</h2><p className="text-sm text-ink/60">URL inputs are temporary until an upload service is available.</p></div>
            <label className="grid gap-1 text-sm font-semibold">Cover image URL<input className={inputClass} onChange={(event) => update("coverImage", event.target.value)} type="url" value={data.coverImage} /></label>
            <UrlFields label="Property image URL" onAdd={() => addUrlField("propertyImages")} onChange={(index, value) => updateUrlList("propertyImages", index, value)} values={data.propertyImages} />
            <UrlFields label="Room image URL" onAdd={() => addUrlField("roomImages")} onChange={(index, value) => updateUrlList("roomImages", index, value)} values={data.roomImages} />
          </section>
        )}

        {step === 5 && (
          <section className={`${cardClass} grid gap-4`}>
            <h2 className="text-2xl font-bold">Descriptions</h2>
            <label className="grid gap-1 text-sm font-semibold">Property description<textarea className={inputClass} onChange={(event) => update("propertyDescription", event.target.value)} required rows={5} value={data.propertyDescription} /></label>
            <label className="grid gap-1 text-sm font-semibold">Common areas description<textarea className={inputClass} onChange={(event) => update("commonAreasDescription", event.target.value)} rows={4} value={data.commonAreasDescription} /></label>
            <label className="grid gap-1 text-sm font-semibold">Additional notes<textarea className={inputClass} onChange={(event) => update("additionalNotes", event.target.value)} rows={4} value={data.additionalNotes} /></label>
          </section>
        )}

        {step === 6 && (
          <section className={`${cardClass} grid gap-5`}>
            <div><h2 className="text-2xl font-bold">Nearby Places</h2><p className="text-sm text-ink/60">Choose useful Kashan landmarks and add any property-specific places.</p></div>
            <div className="grid gap-2 sm:grid-cols-2">{defaultNearbyPlaces.map((place) => <label className="flex items-center gap-2 rounded-lg border border-ink/10 p-3" key={place}><input checked={data.selectedNearbyPlaces.includes(place)} onChange={(event) => update("selectedNearbyPlaces", event.target.checked ? [...data.selectedNearbyPlaces, place] : data.selectedNearbyPlaces.filter((item) => item !== place))} type="checkbox" />{place}</label>)}</div>
            <UrlFields addLabel="Add custom place" label="Custom nearby place" onAdd={() => addUrlField("customNearbyPlaces")} onChange={(index, value) => updateUrlList("customNearbyPlaces", index, value)} values={data.customNearbyPlaces} />
          </section>
        )}

        {step === 7 && (
          <section className="grid gap-5">
            <div className={cardClass}><h2 className="text-2xl font-bold">Review</h2><p className="mt-1 text-sm text-ink/60">Check the information below before creating the property.</p></div>
            <div className={cardClass}>
              <h3 className="mb-3 text-lg font-bold">Completion status</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {completionItems.map((item) => (
                  <div className="flex items-center justify-between rounded-lg border border-ink/10 px-3 py-2" key={item.label}>
                    <span>{item.label}</span>
                    <span className={`text-sm font-bold ${item.complete ? "text-green-700" : "text-amber-700"}`}>
                      {item.complete ? "Complete" : "Optional / incomplete"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ReviewCard title="Basic information" lines={[data.name, `${data.type} in ${data.city}`, data.address]} />
              <ReviewCard title="Building" lines={[data.totalArea ? `${data.totalArea} m2` : "Area not provided", `${data.floors} floors`, data.hasElevator ? "Elevator" : "No elevator", `${data.stairCount} stairs`]} />
              <ReviewCard title={namedRooms ? "Named rooms" : "Room types"} lines={accommodations.map((item) => namedRooms ? item.name : `${item.name} (${item.totalInventory})`)} />
              <ReviewCard title="Amenities" lines={selectedAmenities.map((item) => item.name)} />
              <ReviewCard title="Images" lines={[data.coverImage && "Cover image", `${compact(data.propertyImages).length} property images`, `${compact(data.roomImages).length} room images`].filter(Boolean)} />
              <ReviewCard title="Nearby places" lines={[...data.selectedNearbyPlaces, ...compact(data.customNearbyPlaces)]} />
            </div>
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The current APIs save property, building notes, descriptions, room types, and named rooms. Amenity selections, image URLs, and nearby-place selections are review-only until their write APIs are added.</p>
          </section>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button className="rounded-lg border border-ink/20 px-5 py-3 font-bold disabled:opacity-40" disabled={step === 0 || loading} onClick={() => { setError(""); setStep((current) => Math.max(0, current - 1)); }} type="button">Back</button>
          {step < 7 ? <button className="rounded-lg bg-ink px-5 py-3 font-bold text-white" onClick={nextStep} type="button">Continue</button> : <button className="rounded-lg bg-ink px-5 py-3 font-bold text-white disabled:opacity-60" disabled={loading} type="submit">{loading ? "Creating property..." : "Create property"}</button>}
        </div>
      </form>
    </OwnerPage>
  );
}

function UrlFields({ label, values, onChange, onAdd, addLabel = "Add another URL" }: { label: string; values: string[]; onChange: (index: number, value: string) => void; onAdd: () => void; addLabel?: string }) {
  return <div className="grid gap-2"><span className="text-sm font-semibold">{label}</span>{values.map((value, index) => <input className={inputClass} key={index} onChange={(event) => onChange(index, event.target.value)} placeholder={label} type={label.includes("URL") ? "url" : "text"} value={value} />)}<button className="justify-self-start rounded-lg border border-ink/20 px-3 py-2 text-sm font-semibold" onClick={onAdd} type="button">{addLabel}</button></div>;
}

function ReviewCard({ title, lines }: { title: string; lines: string[] }) {
  const visibleLines = lines.filter(Boolean);
  return <article className={cardClass}><h3 className="mb-2 text-lg font-bold">{title}</h3>{visibleLines.length ? <ul className="grid gap-1 text-sm text-ink/70">{visibleLines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : <p className="text-sm text-ink/50">Nothing selected.</p>}</article>;
}
