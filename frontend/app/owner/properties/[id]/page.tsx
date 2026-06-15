"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { OwnerPage } from "@/components/owner/OwnerPage";
import { PropertyForm } from "@/components/owner/PropertyForm";
import {
  AvailabilityResponse,
  AvailabilityStatus,
  apiRequest,
  createSlug,
  getToken,
  InventoryMode,
  PropertyCompletionResponse,
  PropertyDescriptionSectionResponse,
  PropertyDescriptionSectionType,
  PropertyFormValues,
  PropertyImageResponse,
  PropertyResponse,
  RoomResponse,
  RoomTypeResponse,
  toPropertyPayload,
} from "@/lib/owner-api";

interface AccommodationFormValues {
  name: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  totalInventory: number;
  basePrice: string;
}

interface AvailabilityFormValues {
  roomTypeId: string;
  startDate: string;
  endDate: string;
  price: string;
  originalPrice: string;
  availableCount: number;
  status: AvailabilityStatus;
  minNightsOverride: string;
}

interface ImageFormValues {
  url: string;
  altText: string;
  caption: string;
  tag: string;
  roomTypeId: string;
  roomId: string;
  sortOrder: number;
  isCover: boolean;
  isGallery: boolean;
}

type PropertyTab =
  | "Overview"
  | "Building Info"
  | "Amenities"
  | "Descriptions"
  | "Nearby Places"
  | "Images"
  | "Rooms";

const tabs: PropertyTab[] = [
  "Overview",
  "Building Info",
  "Rooms",
  "Amenities",
  "Descriptions",
  "Nearby Places",
  "Images",
];
const descriptionTypes: {
  type: PropertyDescriptionSectionType;
  title: string;
}[] = [
  { type: "PropertyIntroduction", title: "Property Introduction" },
  { type: "CommonAreas", title: "Common Areas" },
  { type: "SharedAmenities", title: "Shared Amenities" },
  { type: "ImportantNotes", title: "Important Notes" },
];

function dateFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const emptyAccommodation: AccommodationFormValues = {
  name: "",
  description: "",
  maxAdults: 2,
  maxChildren: 0,
  totalInventory: 1,
  basePrice: "",
};

const initialAvailability: AvailabilityFormValues = {
  roomTypeId: "",
  startDate: dateFromToday(0),
  endDate: dateFromToday(30),
  price: "",
  originalPrice: "",
  availableCount: 1,
  status: "Available",
  minNightsOverride: "",
};

const initialImage: ImageFormValues = {
  url: "",
  altText: "",
  caption: "",
  tag: "",
  roomTypeId: "",
  roomId: "",
  sortOrder: 0,
  isCover: false,
  isGallery: true,
};

const inputClass = "w-full rounded-lg border border-ink/20 bg-white px-3 py-2";

function propertyToForm(property: PropertyResponse): PropertyFormValues {
  return {
    name: property.name,
    description: property.description,
    address: property.address,
    city: property.city,
    type: property.type,
    inventoryMode: property.inventoryMode,
    checkInTime: property.checkInTime?.slice(0, 5) ?? "",
    checkOutTime: property.checkOutTime?.slice(0, 5) ?? "",
    totalAreaM2: property.totalAreaM2,
    landAreaM2: property.landAreaM2,
    floorsCount: property.floorsCount,
    stairCount: property.stairCount,
    hasElevator: property.hasElevator,
  };
}

export default function ManagePropertyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const propertyId = Number(params.id);
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [propertyValues, setPropertyValues] =
    useState<PropertyFormValues | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [rooms, setRooms] = useState<Record<number, RoomResponse[]>>({});
  const [accommodation, setAccommodation] = useState(emptyAccommodation);
  const [availability, setAvailability] = useState(initialAvailability);
  const [availabilityRows, setAvailabilityRows] = useState<
    AvailabilityResponse[]
  >([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [images, setImages] = useState<PropertyImageResponse[]>([]);
  const [imageForm, setImageForm] = useState(initialImage);
  const [imageLoading, setImageLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<PropertyTab>("Overview");
  const [completion, setCompletion] =
    useState<PropertyCompletionResponse | null>(null);
  const [descriptionSections, setDescriptionSections] = useState<
    PropertyDescriptionSectionResponse[]
  >([]);
  const [descriptionDrafts, setDescriptionDrafts] = useState<
    Record<PropertyDescriptionSectionType, string>
  >({
    PropertyIntroduction: "",
    CommonAreas: "",
    SharedAmenities: "",
    ImportantNotes: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadRooms = useCallback(
    async (items: RoomTypeResponse[], mode: InventoryMode) => {
      if (mode !== "NamedRooms") {
        setRooms({});
        return;
      }

      const entries = await Promise.all(
        items.map(
          async (roomType) =>
            [
              roomType.id,
              await apiRequest<RoomResponse[]>(
                `/owner/room-types/${roomType.id}/rooms`,
              ),
            ] as const,
        ),
      );
      setRooms(Object.fromEntries(entries));
    },
    [],
  );

  const load = useCallback(async () => {
    const [
      propertyResult,
      roomTypeResult,
      completionResult,
      descriptionResult,
      imageResult,
    ] = await Promise.all([
      apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`),
      apiRequest<RoomTypeResponse[]>(
        `/owner/properties/${propertyId}/room-types`,
      ),
      apiRequest<PropertyCompletionResponse>(
        `/owner/properties/${propertyId}/completion`,
      ),
      apiRequest<PropertyDescriptionSectionResponse[]>(
        `/owner/properties/${propertyId}/descriptions`,
      ),
      apiRequest<PropertyImageResponse[]>(`/owner/properties/${propertyId}/images`),
    ]);
    setProperty(propertyResult);
    setPropertyValues(propertyToForm(propertyResult));
    setRoomTypes(roomTypeResult);
    setCompletion(completionResult);
    setDescriptionSections(descriptionResult);
    setImages(imageResult);
    setDescriptionDrafts((current) => ({
      ...current,
      ...Object.fromEntries(
        descriptionResult.map((section) => [
          section.sectionType,
          section.content,
        ]),
      ),
    }));
    setAvailability((current) => ({
      ...current,
      roomTypeId: current.roomTypeId || roomTypeResult[0]?.id.toString() || "",
    }));
    await loadRooms(roomTypeResult, propertyResult.inventoryMode);
  }, [loadRooms, propertyId]);

  const loadAvailability = useCallback(
    async (roomTypeId: string, from: string, to: string) => {
      if (!roomTypeId || !from || !to) {
        setAvailabilityRows([]);
        return;
      }

      if (from > to) {
        setAvailabilityRows([]);
        return;
      }

      setAvailabilityLoading(true);
      try {
        const rows = await apiRequest<AvailabilityResponse[]>(
          `/owner/room-types/${roomTypeId}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        );
        setAvailabilityRows(rows);
      } finally {
        setAvailabilityLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!getToken()) {
      router.replace("/owner/login");
      return;
    }
    if (!Number.isInteger(propertyId) || propertyId < 1) {
      setError("Invalid property ID.");
      setLoading(false);
      return;
    }
    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [load, propertyId, router]);

  useEffect(() => {
    if (!availability.roomTypeId) return;
    loadAvailability(
      availability.roomTypeId,
      availability.startDate,
      availability.endDate,
    ).catch((caught: Error) => setError(caught.message));
  }, [
    availability.roomTypeId,
    availability.startDate,
    availability.endDate,
    loadAvailability,
  ]);

  async function updateProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyValues || !property) return;
    setError("");
    setMessage("");
    try {
      const updated = await apiRequest<PropertyResponse>(
        `/owner/properties/${propertyId}`,
        {
          method: "PUT",
          body: JSON.stringify(
            toPropertyPayload(propertyValues, property.destinationId),
          ),
        },
      );
      setProperty(updated);
      setMessage("Property updated.");
      await loadRooms(roomTypes, updated.inventoryMode);
      setCompletion(
        await apiRequest<PropertyCompletionResponse>(
          `/owner/properties/${propertyId}/completion`,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update property.",
      );
    }
  }

  async function addAccommodation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!property) return;
    setError("");
    setMessage("");

    try {
      const namedMode = property.inventoryMode === "NamedRooms";
      const roomType = await apiRequest<RoomTypeResponse>(
        `/owner/properties/${propertyId}/room-types`,
        {
          method: "POST",
          body: JSON.stringify({
            name: accommodation.name,
            slug: createSlug(accommodation.name),
            description:
              accommodation.description ||
              `${accommodation.name} at ${property.name}`,
            maxAdults: accommodation.maxAdults,
            maxChildren: accommodation.maxChildren,
            totalInventory: namedMode ? 1 : accommodation.totalInventory,
            inventoryMode: property.inventoryMode,
            basePrice:
              accommodation.basePrice === ""
                ? null
                : Number(accommodation.basePrice),
          }),
        },
      );

      if (namedMode) {
        await apiRequest<RoomResponse>(
          `/owner/room-types/${roomType.id}/rooms`,
          {
            method: "POST",
            body: JSON.stringify({ name: accommodation.name }),
          },
        );
      }

      setAccommodation(emptyAccommodation);
      await load();
      setMessage(namedMode ? "Named room added." : "Room type added.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not add accommodation.",
      );
    }
  }

  async function setAvailabilityRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!availability.roomTypeId) return;
    setError("");
    setMessage("");
    setAvailabilityLoading(true);

    try {
      const rows = await apiRequest<AvailabilityResponse[]>(
        `/owner/room-types/${availability.roomTypeId}/availability`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate: availability.startDate,
            endDate: availability.endDate,
            price: Number(availability.price),
            originalPrice:
              availability.originalPrice === ""
                ? null
                : Number(availability.originalPrice),
            availableCount: availability.availableCount,
            status: availability.status,
            minNightsOverride:
              availability.minNightsOverride === ""
                ? null
                : Number(availability.minNightsOverride),
          }),
        },
      );
      setAvailabilityRows(rows);
      setMessage(
        `Availability updated for ${rows.length} date${rows.length === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update availability.",
      );
    } finally {
      setAvailabilityLoading(false);
    }
  }

  async function saveBuildingInformation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyValues || !property) return;
    setError("");
    setMessage("");
    try {
      const updated = await apiRequest<PropertyResponse>(
        `/owner/properties/${propertyId}`,
        {
          method: "PUT",
          body: JSON.stringify(
            toPropertyPayload(propertyValues, property.destinationId),
          ),
        },
      );
      setProperty(updated);
      setPropertyValues(propertyToForm(updated));
      setCompletion(
        await apiRequest<PropertyCompletionResponse>(
          `/owner/properties/${propertyId}/completion`,
        ),
      );
      setMessage("Building information updated.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update building information.",
      );
    }
  }

  async function saveDescriptionSection(
    type: PropertyDescriptionSectionType,
    title: string,
    sortOrder: number,
  ) {
    setError("");
    setMessage("");
    try {
      const existing = descriptionSections.find(
        (item) => item.sectionType === type,
      );
      const path = existing
        ? `/owner/property-descriptions/${existing.id}`
        : `/owner/properties/${propertyId}/descriptions`;
      const section = await apiRequest<PropertyDescriptionSectionResponse>(
        path,
        {
          method: existing ? "PUT" : "POST",
          body: JSON.stringify({
            sectionType: type,
            title,
            content: descriptionDrafts[type],
            sortOrder,
          }),
        },
      );
      setDescriptionSections((current) => [
        ...current.filter((item) => item.sectionType !== type),
        section,
      ]);
      setCompletion(
        await apiRequest<PropertyCompletionResponse>(
          `/owner/properties/${propertyId}/completion`,
        ),
      );
      setMessage(`${title} saved.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save description section.",
      );
    }
  }

  async function addImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setImageLoading(true);
    try {
      await apiRequest<PropertyImageResponse>(`/owner/properties/${propertyId}/images`, {
        method: "POST",
        body: JSON.stringify({
          ...imageForm,
          altText: imageForm.altText || null,
          caption: imageForm.caption || null,
          tag: imageForm.tag || null,
          roomTypeId: imageForm.roomTypeId ? Number(imageForm.roomTypeId) : null,
          roomId: imageForm.roomId ? Number(imageForm.roomId) : null,
        }),
      });
      setImages(await apiRequest<PropertyImageResponse[]>(`/owner/properties/${propertyId}/images`));
      setCompletion(await apiRequest<PropertyCompletionResponse>(`/owner/properties/${propertyId}/completion`));
      setImageForm(initialImage);
      setMessage("Image added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add image.");
    } finally {
      setImageLoading(false);
    }
  }

  async function deleteImage(imageId: number) {
    setError("");
    setMessage("");
    setImageLoading(true);
    try {
      await apiRequest<void>(`/owner/property-images/${imageId}`, { method: "DELETE" });
      setImages((current) => current.filter((image) => image.id !== imageId));
      setCompletion(await apiRequest<PropertyCompletionResponse>(`/owner/properties/${propertyId}/completion`));
      setMessage("Image deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete image.");
    } finally {
      setImageLoading(false);
    }
  }

  const namedMode = property?.inventoryMode === "NamedRooms";

  return (
    <OwnerPage title={property ? property.name : "Manage property"}>
      {loading && <p>Loading property...</p>}
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>
      )}
      {message && (
        <p className="mb-4 rounded-lg bg-green-50 p-3 text-green-800">
          {message}
        </p>
      )}

      {property && propertyValues && (
        <div className="grid gap-8">
          <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink/55">
                  Property information
                </p>
                <h2 className="text-2xl font-black">
                  {completion?.completionPercentage ?? 0}% Complete
                </h2>
              </div>
              <span className="text-sm font-semibold">{property.status}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-ink transition-all"
                style={{ width: `${completion?.completionPercentage ?? 0}%` }}
              />
            </div>
            {completion && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                {completion.completedSections.map((section) => (
                  <span
                    className="rounded-full bg-green-50 px-2 py-1 text-green-700"
                    key={section}
                  >
                    {section}
                  </span>
                ))}
                {completion.missingSections.map((section) => (
                  <span
                    className="rounded-full bg-amber-50 px-2 py-1 text-amber-800"
                    key={section}
                  >
                    {section}
                  </span>
                ))}
              </div>
            )}
          </section>

          <nav
            className="flex gap-2 overflow-x-auto border-b border-ink/15 pb-2"
            aria-label="Property sections"
          >
            {tabs.map((tab) => (
              <button
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold ${activeTab === tab ? "bg-ink text-white" : "bg-white"}`}
                key={tab}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tab}
              </button>
            ))}
          </nav>

          {activeTab === "Overview" && (
            <section>
              <h2 className="mb-3 text-2xl font-bold">Property details</h2>
              <PropertyForm
                onChange={setPropertyValues}
                onSubmit={updateProperty}
                submitLabel="Save property"
                values={propertyValues}
              />
            </section>
          )}

          {activeTab === "Building Info" && (
            <section>
              <h2 className="mb-3 text-2xl font-bold">Building information</h2>
              <form
                className="grid gap-4 rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
                onSubmit={saveBuildingInformation}
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="grid gap-1 text-sm font-semibold">
                    Total area (m2)
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) =>
                        setPropertyValues({
                          ...propertyValues,
                          totalAreaM2:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      step="0.01"
                      type="number"
                      value={propertyValues.totalAreaM2 ?? ""}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Land area (m2)
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) =>
                        setPropertyValues({
                          ...propertyValues,
                          landAreaM2:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      step="0.01"
                      type="number"
                      value={propertyValues.landAreaM2 ?? ""}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Floors
                    <input
                      className={inputClass}
                      min="1"
                      onChange={(event) =>
                        setPropertyValues({
                          ...propertyValues,
                          floorsCount:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      type="number"
                      value={propertyValues.floorsCount ?? ""}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Stair count
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) =>
                        setPropertyValues({
                          ...propertyValues,
                          stairCount:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      type="number"
                      value={propertyValues.stairCount ?? ""}
                    />
                  </label>
                </div>
                <label className="flex items-center gap-3 rounded-lg border border-ink/15 p-4 font-semibold">
                  <input
                    checked={propertyValues.hasElevator ?? false}
                    onChange={(event) =>
                      setPropertyValues({
                        ...propertyValues,
                        hasElevator: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  Building has an elevator
                </label>
                <button
                  className="rounded-lg bg-ink px-4 py-3 font-bold text-white"
                  type="submit"
                >
                  Save building information
                </button>
              </form>
            </section>
          )}

          {activeTab === "Amenities" && (
            <StatusPanel
              complete={
                completion?.completedSections.includes("amenities") ?? false
              }
              title="Amenities"
              text="Amenity assignments will appear here once the owner assignment API is available."
            />
          )}

          {activeTab === "Descriptions" && (
            <section className="grid gap-4">
              <h2 className="text-2xl font-bold">Property descriptions</h2>
              {descriptionTypes.map((section, index) => (
                <div
                  className="grid gap-3 rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
                  key={section.type}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">{section.title}</h3>
                    <span className="text-sm text-ink/50">
                      {descriptionSections.some(
                        (item) => item.sectionType === section.type,
                      )
                        ? "Saved"
                        : "Not saved"}
                    </span>
                  </div>
                  <textarea
                    className={inputClass}
                    onChange={(event) =>
                      setDescriptionDrafts({
                        ...descriptionDrafts,
                        [section.type]: event.target.value,
                      })
                    }
                    rows={5}
                    value={descriptionDrafts[section.type]}
                  />
                  <button
                    className="justify-self-start rounded-lg bg-ink px-4 py-2 font-bold text-white"
                    onClick={() =>
                      saveDescriptionSection(section.type, section.title, index)
                    }
                    type="button"
                  >
                    Save section
                  </button>
                </div>
              ))}
            </section>
          )}

          {activeTab === "Nearby Places" && (
            <StatusPanel
              complete={
                completion?.completedSections.includes("nearby places") ?? false
              }
              title="Nearby places"
              text="Nearby-place editing is not exposed by the current owner API yet."
            />
          )}
          {activeTab === "Images" && (
            <section className="grid gap-5">
              <div><h2 className="text-2xl font-bold">Property images</h2><p className="mt-1 text-sm text-ink/60">Add public image URLs and optionally associate them with a room type or named room.</p></div>
              <form className="grid gap-4 rounded-xl border border-ink/10 bg-white p-5 shadow-sm" onSubmit={addImage}>
                <label className="grid gap-1 text-sm font-semibold">Image URL<input className={inputClass} onChange={(event) => setImageForm({ ...imageForm, url: event.target.value })} required type="url" value={imageForm.url} /></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold">Tag<input className={inputClass} onChange={(event) => setImageForm({ ...imageForm, tag: event.target.value })} placeholder="exterior, room, bathroom" value={imageForm.tag} /></label>
                  <label className="grid gap-1 text-sm font-semibold">Alt text<input className={inputClass} onChange={(event) => setImageForm({ ...imageForm, altText: event.target.value })} value={imageForm.altText} /></label>
                </div>
                <label className="grid gap-1 text-sm font-semibold">Caption<input className={inputClass} onChange={(event) => setImageForm({ ...imageForm, caption: event.target.value })} value={imageForm.caption} /></label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="grid gap-1 text-sm font-semibold">Room type<select className={inputClass} onChange={(event) => setImageForm({ ...imageForm, roomTypeId: event.target.value, roomId: "" })} value={imageForm.roomTypeId}><option value="">General property image</option>{roomTypes.map((roomType) => <option key={roomType.id} value={roomType.id}>{roomType.name}</option>)}</select></label>
                  <label className="grid gap-1 text-sm font-semibold">Named room<select className={inputClass} disabled={!imageForm.roomTypeId} onChange={(event) => setImageForm({ ...imageForm, roomId: event.target.value })} value={imageForm.roomId}><option value="">No named room</option>{(rooms[Number(imageForm.roomTypeId)] ?? []).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
                  <label className="grid gap-1 text-sm font-semibold">Sort order<input className={inputClass} onChange={(event) => setImageForm({ ...imageForm, sortOrder: Number(event.target.value) })} type="number" value={imageForm.sortOrder} /></label>
                </div>
                <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm font-semibold"><input checked={imageForm.isCover} onChange={(event) => setImageForm({ ...imageForm, isCover: event.target.checked })} type="checkbox" />Cover image</label><label className="flex items-center gap-2 text-sm font-semibold"><input checked={imageForm.isGallery} onChange={(event) => setImageForm({ ...imageForm, isGallery: event.target.checked })} type="checkbox" />Show in gallery</label></div>
                <button className="rounded-lg bg-ink px-4 py-3 font-bold text-white disabled:opacity-50" disabled={imageLoading} type="submit">{imageLoading ? "Saving..." : "Add image"}</button>
              </form>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((image) => <article className="overflow-hidden rounded-xl border border-ink/10 bg-white shadow-sm" key={image.id}><img alt={image.altText ?? image.caption ?? "Property image"} className="aspect-[4/3] w-full object-cover" src={image.url} /><div className="p-4"><div className="flex items-center justify-between gap-2"><strong>{image.tag || "Property image"}</strong>{image.isCover && <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-bold text-green-700">Cover</span>}</div>{image.caption && <p className="mt-2 text-sm text-ink/60">{image.caption}</p>}<button className="mt-4 text-sm font-bold text-red-700 disabled:opacity-50" disabled={imageLoading} onClick={() => deleteImage(image.id)} type="button">Delete</button></div></article>)}
                {images.length === 0 && <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center sm:col-span-2 lg:col-span-3">No property images yet.</p>}
              </div>
            </section>
          )}

          {activeTab === "Rooms" && (
            <section>
              <h2 className="mb-1 text-2xl font-bold">
                {namedMode ? "Add named room" : "Add room type"}
              </h2>
              <p className="mb-3 text-sm text-ink/60">
                {namedMode
                  ? "Examples: Shah-Abbasi, Toranj, Panjdari. Each room is unique and has inventory 1."
                  : "Examples: Double room, Twin room, Triple room. Set how many rooms of this type are available."}
              </p>
              <form
                className="grid gap-4 rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
                onSubmit={addAccommodation}
              >
                <label className="grid gap-1 text-sm font-semibold">
                  {namedMode ? "Room name" : "Room type name"}
                  <input
                    className={inputClass}
                    onChange={(event) =>
                      setAccommodation({
                        ...accommodation,
                        name: event.target.value,
                      })
                    }
                    required
                    value={accommodation.name}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Description
                  <textarea
                    className={inputClass}
                    onChange={(event) =>
                      setAccommodation({
                        ...accommodation,
                        description: event.target.value,
                      })
                    }
                    rows={3}
                    value={accommodation.description}
                  />
                </label>
                <div
                  className={`grid gap-4 ${namedMode ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}
                >
                  <label className="grid gap-1 text-sm font-semibold">
                    Max adults
                    <input
                      className={inputClass}
                      min="1"
                      onChange={(event) =>
                        setAccommodation({
                          ...accommodation,
                          maxAdults: Number(event.target.value),
                        })
                      }
                      required
                      type="number"
                      value={accommodation.maxAdults}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Max children
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) =>
                        setAccommodation({
                          ...accommodation,
                          maxChildren: Number(event.target.value),
                        })
                      }
                      required
                      type="number"
                      value={accommodation.maxChildren}
                    />
                  </label>
                  {!namedMode && (
                    <label className="grid gap-1 text-sm font-semibold">
                      Total inventory
                      <input
                        className={inputClass}
                        min="1"
                        onChange={(event) =>
                          setAccommodation({
                            ...accommodation,
                            totalInventory: Number(event.target.value),
                          })
                        }
                        required
                        type="number"
                        value={accommodation.totalInventory}
                      />
                    </label>
                  )}
                  <label className="grid gap-1 text-sm font-semibold">
                    Base price
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) =>
                        setAccommodation({
                          ...accommodation,
                          basePrice: event.target.value,
                        })
                      }
                      step="0.01"
                      type="number"
                      value={accommodation.basePrice}
                    />
                  </label>
                </div>
                <button
                  className="rounded-lg bg-ink px-4 py-3 font-bold text-white"
                  type="submit"
                >
                  {namedMode ? "Add named room" : "Add room type"}
                </button>
              </form>
            </section>
          )}

          {activeTab === "Rooms" && (
            <section>
              <h2 className="mb-3 text-2xl font-bold">
                {namedMode ? "Named rooms" : "Room types"}
              </h2>
              <div className="grid gap-4">
                {roomTypes.length === 0 && (
                  <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center">
                    {namedMode ? "No named rooms yet." : "No room types yet."}
                  </p>
                )}
                {roomTypes.map((roomType) => (
                  <article
                    className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
                    key={roomType.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold">
                          {namedMode
                            ? (rooms[roomType.id]?.[0]?.name ?? roomType.name)
                            : roomType.name}
                        </h3>
                        <p className="text-sm text-ink/60">
                          Up to {roomType.maxAdults} adults and{" "}
                          {roomType.maxChildren} children
                          {!namedMode && ` · ${roomType.totalInventory} rooms`}
                          {roomType.basePrice !== null &&
                            ` · base price ${roomType.basePrice}`}
                        </p>
                      </div>
                      <span className="text-sm font-semibold">
                        {roomType.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeTab === "Rooms" && (
            <section>
              <h2 className="mb-1 text-2xl font-bold">
                Availability and pricing
              </h2>
              <p className="mb-3 text-sm text-ink/60">
                Set the same availability values for every date in an inclusive
                range.
              </p>
              {roomTypes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center">
                  Add a room type before managing availability.
                </p>
              ) : (
                <>
                  <form
                    className="grid gap-4 rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
                    onSubmit={setAvailabilityRange}
                  >
                    <label className="grid gap-1 text-sm font-semibold">
                      Room type
                      <select
                        className={inputClass}
                        onChange={(event) =>
                          setAvailability({
                            ...availability,
                            roomTypeId: event.target.value,
                          })
                        }
                        value={availability.roomTypeId}
                      >
                        {roomTypes.map((roomType) => (
                          <option key={roomType.id} value={roomType.id}>
                            {roomType.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="grid gap-1 text-sm font-semibold">
                        Start date
                        <input
                          className={inputClass}
                          onChange={(event) =>
                            setAvailability({
                              ...availability,
                              startDate: event.target.value,
                            })
                          }
                          required
                          type="date"
                          value={availability.startDate}
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        End date
                        <input
                          className={inputClass}
                          min={availability.startDate}
                          onChange={(event) =>
                            setAvailability({
                              ...availability,
                              endDate: event.target.value,
                            })
                          }
                          required
                          type="date"
                          value={availability.endDate}
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        Price
                        <input
                          className={inputClass}
                          min="0"
                          onChange={(event) =>
                            setAvailability({
                              ...availability,
                              price: event.target.value,
                            })
                          }
                          required
                          step="0.01"
                          type="number"
                          value={availability.price}
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        Original price
                        <input
                          className={inputClass}
                          min="0"
                          onChange={(event) =>
                            setAvailability({
                              ...availability,
                              originalPrice: event.target.value,
                            })
                          }
                          step="0.01"
                          type="number"
                          value={availability.originalPrice}
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        Available count
                        <input
                          className={inputClass}
                          min="0"
                          onChange={(event) =>
                            setAvailability({
                              ...availability,
                              availableCount: Number(event.target.value),
                            })
                          }
                          required
                          type="number"
                          value={availability.availableCount}
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        Status
                        <select
                          className={inputClass}
                          onChange={(event) =>
                            setAvailability({
                              ...availability,
                              status: event.target.value as AvailabilityStatus,
                            })
                          }
                          value={availability.status}
                        >
                          <option value="Available">Available</option>
                          <option value="Unavailable">Unavailable</option>
                          <option value="OnRequest">On request</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        Min nights
                        <input
                          className={inputClass}
                          min="1"
                          onChange={(event) =>
                            setAvailability({
                              ...availability,
                              minNightsOverride: event.target.value,
                            })
                          }
                          type="number"
                          value={availability.minNightsOverride}
                        />
                      </label>
                    </div>
                    <button
                      className="rounded-lg bg-ink px-4 py-3 font-bold text-white disabled:opacity-60"
                      disabled={availabilityLoading}
                      type="submit"
                    >
                      {availabilityLoading ? "Saving..." : "Set availability"}
                    </button>
                  </form>

                  <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-sm">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b border-ink/10 bg-ink/[0.03]">
                        <tr>
                          <th className="p-3">Date</th>
                          <th className="p-3">Price</th>
                          <th className="p-3">Original price</th>
                          <th className="p-3">Available</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Min nights</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availabilityRows.map((row) => (
                          <tr
                            className="border-b border-ink/10 last:border-0"
                            key={row.id}
                          >
                            <td className="p-3">{row.date}</td>
                            <td className="p-3">{row.price}</td>
                            <td className="p-3">{row.originalPrice ?? "-"}</td>
                            <td className="p-3">{row.availableCount}</td>
                            <td className="p-3">{row.status}</td>
                            <td className="p-3">
                              {row.minNightsOverride ?? "-"}
                            </td>
                          </tr>
                        ))}
                        {!availabilityLoading &&
                          availabilityRows.length === 0 && (
                            <tr>
                              <td
                                className="p-5 text-center text-ink/55"
                                colSpan={6}
                              >
                                No availability rows in this date range.
                              </td>
                            </tr>
                          )}
                        {availabilityLoading && (
                          <tr>
                            <td
                              className="p-5 text-center text-ink/55"
                              colSpan={6}
                            >
                              Loading availability...
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </OwnerPage>
  );
}

function StatusPanel({
  title,
  text,
  complete,
}: {
  title: string;
  text: string;
  complete: boolean;
}) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{title}</h2>
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold ${complete ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}
        >
          {complete ? "Complete" : "Incomplete"}
        </span>
      </div>
      <p className="mt-3 text-ink/60">{text}</p>
    </section>
  );
}
