"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AmenityResponse,
  apiRequest,
  BedTypeResponse,
  bedTypeLabel,
  PropertyImageResponse,
  RoomCompletionResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import { PropertyImageManager } from "@/components/owner/PropertyImageManager";

interface RoomTypeDraft {
  id?: number;
  name: string;
  englishName: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  totalInventory: number;
  floorNumber: string;
  stairCount: string;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  notes: string;
  bedConfigurations: { bedTypeId: number; quantity: number }[];
  amenityIds: number[];
  isActive: boolean;
}

type WizardMode = "create" | "edit";

const wizardSteps = [
  "اطلاعات اصلی",
  "ویژگی‌ها",
  "امکانات",
  "تخت‌ها / چیدمان",
  "تصاویر",
] as const;

const emptyRoomType: RoomTypeDraft = {
  name: "",
  englishName: "",
  description: "",
  maxAdults: 2,
  maxChildren: 0,
  allowExtraGuest: false,
  maxExtraGuests: 0,
  totalInventory: 1,
  floorNumber: "",
  stairCount: "",
  hasWindow: null,
  hasPrivateBathroom: null,
  notes: "",
  bedConfigurations: [],
  amenityIds: [],
  isActive: false,
};

function nullableNumber(value: string) {
  return value === "" ? null : Number(value);
}

function roomInventoryMode(totalInventory: number) {
  return totalInventory <= 1 ? "NamedRooms" : "TypeBasedInventory";
}

function booleanLabel(value: boolean | null, trueLabel: string, falseLabel: string) {
  if (value === null) return "";
  return value ? trueLabel : falseLabel;
}

function roomTypeToDraft(roomType: RoomTypeResponse): RoomTypeDraft {
  return {
    id: roomType.id,
    name: roomType.name,
    englishName: roomType.englishName ?? "",
    description: roomType.description,
    maxAdults: roomType.maxAdults,
    maxChildren: roomType.maxChildren,
    allowExtraGuest: roomType.allowExtraGuest,
    maxExtraGuests: roomType.maxExtraGuests,
    totalInventory: Math.max(1, roomType.totalInventory),
    floorNumber: roomType.floorNumber == null ? "" : String(roomType.floorNumber),
    stairCount: roomType.stairCount == null ? "" : String(roomType.stairCount),
    hasWindow: roomType.hasWindow,
    hasPrivateBathroom: roomType.hasPrivateBathroom,
    notes: roomType.notes ?? "",
    bedConfigurations: roomType.bedConfigurations.map((bed) => ({
      bedTypeId: bed.bedTypeId,
      quantity: bed.quantity,
    })),
    amenityIds: roomType.amenities.map((amenity) => amenity.amenityId),
    isActive: roomType.isActive,
  };
}

function sectionStatus(
  missingItems: string[],
  started: boolean,
): RoomCompletionResponse["sections"][number]["status"] {
  if (missingItems.length === 0) return "Complete";
  return started ? "Incomplete" : "NotStarted";
}

function calculateDraftCompletion(
  draft: RoomTypeDraft,
  hasImages: boolean,
): RoomCompletionResponse {
  const sections = [
    {
      key: "basic",
      label: "اطلاعات پایه",
      missingItems: [
        draft.name.trim() ? "" : "نام اتاق",
        draft.description.trim() ? "" : "توضیح اتاق",
      ].filter(Boolean),
      started: Boolean(draft.name.trim() || draft.description.trim()),
    },
    {
      key: "capacity",
      label: "ظرفیت",
      missingItems: [
        draft.maxAdults >= 1 ? "" : "ظرفیت بزرگسال",
        draft.maxChildren >= 0 ? "" : "ظرفیت کودک",
      ].filter(Boolean),
      started: draft.maxAdults > 0 || draft.maxChildren > 0,
    },
    {
      key: "inventory",
      label: "موجودی",
      missingItems: [draft.totalInventory >= 1 ? "" : "تعداد موجودی"].filter(
        Boolean,
      ),
      started: draft.totalInventory > 0,
    },
    {
      key: "amenities",
      label: "امکانات",
      missingItems: [
        draft.amenityIds.length > 0 ? "" : "حداقل یک امکان اتاق",
      ].filter(Boolean),
      started: draft.amenityIds.length > 0,
    },
    {
      key: "images",
      label: "تصاویر",
      missingItems: [hasImages ? "" : "حداقل یک تصویر اتاق"].filter(Boolean),
      started: hasImages,
    },
  ].map((section) => ({
    key: section.key,
    label: section.label,
    missingItems: section.missingItems,
    status: sectionStatus(section.missingItems, section.started),
  }));

  const missingItems = sections.flatMap((section) => section.missingItems);
  return {
    isComplete: missingItems.length === 0,
    missingItems,
    sections,
  };
}

const completionStatusLabels = {
  Complete: "کامل",
  Incomplete: "ناقص",
  NotStarted: "شروع نشده",
} as const;

function roomStatus(roomType: RoomTypeResponse) {
  if (roomType.isActive) return { label: "Active", variant: "success" as const };
  if (roomType.completion?.isComplete) return { label: "Inactive", variant: "muted" as const };
  return { label: "Draft", variant: "warning" as const };
}

function roomCapacitySummary(roomType: RoomTypeResponse) {
  const parts = [`${roomType.maxAdults} بزرگسال`];
  if (roomType.maxChildren > 0) parts.push(`${roomType.maxChildren} کودک`);
  if (roomType.allowExtraGuest && roomType.maxExtraGuests > 0) {
    parts.push(`${roomType.maxExtraGuests} نفر اضافه`);
  }
  return parts.join("، ");
}

export function RoomManagement({ propertyId }: { propertyId: number }) {
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [images, setImages] = useState<PropertyImageResponse[]>([]);
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [roomTypeDraft, setRoomTypeDraft] = useState<RoomTypeDraft>(emptyRoomType);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingRoomTypeId, setDeletingRoomTypeId] = useState<number | null>(null);
  const [roomTypeToDelete, setRoomTypeToDelete] = useState<RoomTypeResponse | null>(null);
  const [error, setError] = useState("");
  const [activationWarning, setActivationWarning] = useState<string[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>("create");
  const [activeStep, setActiveStep] = useState(0);

  const roomAmenityOptions = useMemo(
    () => amenities.filter((item) => item.scope !== "Property"),
    [amenities],
  );

  const privateBathroomAmenity = useMemo(
    () => roomAmenityOptions.find((item) => item.slug === "private-bathroom"),
    [roomAmenityOptions],
  );

  const draftHasImages = useMemo(
    () =>
      Boolean(
        roomTypeDraft.id &&
          images.some((image) => image.roomTypeId === roomTypeDraft.id),
      ),
    [images, roomTypeDraft.id],
  );

  const draftCompletion = useMemo(
    () => calculateDraftCompletion(roomTypeDraft, draftHasImages),
    [draftHasImages, roomTypeDraft],
  );

  useEffect(() => {
    Promise.all([
      apiRequest<BedTypeResponse[]>("/bed-types"),
      apiRequest<AmenityResponse[]>("/amenities"),
      loadRoomTypes(),
      loadImages(),
    ])
      .then(([beds, amenityItems]) => {
        setBedTypes(beds);
        setAmenities(amenityItems);
      })
      .catch((caught: Error) => {
        setError(caught.message);
        toast.error(caught.message);
      })
      .finally(() => setLoading(false));
  }, [propertyId]);

  async function loadRoomTypes() {
    const items = await apiRequest<RoomTypeResponse[]>(
      `/owner/properties/${propertyId}/room-types`,
    );
    setRoomTypes(items);
    return items;
  }

  async function loadImages() {
    const items = await apiRequest<PropertyImageResponse[]>(
      `/owner/properties/${propertyId}/images`,
    );
    setImages(items);
    return items;
  }

  function openCreateWizard() {
    setRoomTypeDraft(emptyRoomType);
    setWizardMode("create");
    setActiveStep(0);
    setError("");
    setActivationWarning([]);
    setWizardOpen(true);
  }

  function editRoomType(roomType: RoomTypeResponse) {
    setRoomTypeDraft(roomTypeToDraft(roomType));
    setWizardMode("edit");
    setActiveStep(0);
    setError("");
    setActivationWarning([]);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
    setRoomTypeDraft(emptyRoomType);
    setActiveStep(0);
    setError("");
    setActivationWarning([]);
  }

  function patchDraft(patch: Partial<RoomTypeDraft>) {
    setActivationWarning([]);
    setRoomTypeDraft((current) => ({ ...current, ...patch }));
  }

  function updateBed(index: number, patch: Partial<{ bedTypeId: number; quantity: number }>) {
    setRoomTypeDraft((current) => {
      const next = [...current.bedConfigurations];
      next[index] = { ...next[index], ...patch };
      return { ...current, bedConfigurations: next };
    });
  }

  function inferPrivateBathroom(amenityIds: number[]) {
    return privateBathroomAmenity ? amenityIds.includes(privateBathroomAmenity.id) : roomTypeDraft.hasPrivateBathroom;
  }

  function validateStep(step: number, finalActivation = false) {
    if (step === 0 || finalActivation) {
      if (!roomTypeDraft.name.trim()) return "نام اتاق الزامی است.";
      if (roomTypeDraft.totalInventory < 1) return "تعداد موجودی باید حداقل ۱ باشد.";
      if (roomTypeDraft.maxAdults < 1) return "ظرفیت بزرگسال باید حداقل ۱ باشد.";
      if (roomTypeDraft.maxChildren < 0) return "ظرفیت کودک معتبر نیست.";
    }
    if ((step === 1 || finalActivation) && roomTypeDraft.allowExtraGuest && roomTypeDraft.maxExtraGuests < 1) {
      return "حداکثر تعداد نفر اضافه را وارد کنید.";
    }
    if (finalActivation && !roomTypeDraft.description.trim()) {
      return "توضیح اتاق برای فعال‌سازی الزامی است.";
    }
    return "";
  }

  function buildPayload(isActive: boolean) {
    const totalInventory = Math.max(1, roomTypeDraft.totalInventory);
    const amenityIds = [...new Set(roomTypeDraft.amenityIds)];
    return {
      name: roomTypeDraft.name.trim(),
      englishName: roomTypeDraft.englishName.trim() || null,
      description: roomTypeDraft.description.trim() || roomTypeDraft.name.trim(),
      maxAdults: Math.max(1, roomTypeDraft.maxAdults),
      maxChildren: Math.max(0, roomTypeDraft.maxChildren),
      allowExtraGuest: roomTypeDraft.allowExtraGuest,
      maxExtraGuests: roomTypeDraft.allowExtraGuest ? Math.max(0, roomTypeDraft.maxExtraGuests) : 0,
      inventoryMode: roomInventoryMode(totalInventory),
      totalInventory,
      basePrice: null,
      notes: roomTypeDraft.notes.trim() || null,
      floorNumber: nullableNumber(roomTypeDraft.floorNumber),
      stairCount: nullableNumber(roomTypeDraft.stairCount),
      hasWindow: roomTypeDraft.hasWindow,
      hasPrivateBathroom: inferPrivateBathroom(amenityIds),
      bedConfigurations: roomTypeDraft.bedConfigurations.filter(
        (bed) => bed.bedTypeId && bed.quantity > 0,
      ),
      amenityIds,
      isActive,
    };
  }

  async function saveDraftRoom() {
    const validationError = validateStep(0);
    if (validationError) {
      toast.error(validationError);
      return null;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await apiRequest<RoomTypeResponse>(
        roomTypeDraft.id
          ? `/owner/room-types/${roomTypeDraft.id}`
          : `/owner/properties/${propertyId}/room-types`,
        {
          method: roomTypeDraft.id ? "PUT" : "POST",
          body: JSON.stringify(buildPayload(roomTypeDraft.id ? roomTypeDraft.isActive : false)),
        },
      );
      setRoomTypeDraft(roomTypeToDraft(saved));
      await Promise.all([loadRoomTypes(), loadImages()]);
      if (wizardMode === "create" && !roomTypeDraft.id) toast.success("پیش‌نویس اتاق ذخیره شد");
      return saved;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "پیش‌نویس اتاق ذخیره نشد.";
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function goNext() {
    const validationError = validateStep(activeStep);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (activeStep === 0) {
      const saved = await saveDraftRoom();
      if (!saved) return;
    }

    setActiveStep((current) => Math.min(current + 1, wizardSteps.length - 1));
  }

  async function activateRoom() {
    const validationError = validateStep(activeStep, true);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!draftCompletion.isComplete) {
      setActivationWarning(draftCompletion.missingItems);
      toast.error("برای فعال‌سازی اتاق، موارد ناقص را تکمیل کنید.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const endpoint = roomTypeDraft.id
        ? `/owner/room-types/${roomTypeDraft.id}`
        : `/owner/properties/${propertyId}/room-types`;
      const saved = await apiRequest<RoomTypeResponse>(endpoint, {
        method: roomTypeDraft.id ? "PUT" : "POST",
        body: JSON.stringify(buildPayload(true)),
      });
      setRoomTypeDraft(roomTypeToDraft(saved));
      await Promise.all([loadRoomTypes(), loadImages()]);
      toast.success("اتاق فعال شد");
      closeWizard();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "فعال‌سازی اتاق انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRoomType() {
    if (!roomTypeToDelete) return;

    setDeletingRoomTypeId(roomTypeToDelete.id);
    setError("");
    try {
      await apiRequest<void>(`/owner/room-types/${roomTypeToDelete.id}`, { method: "DELETE" });
      await Promise.all([loadRoomTypes(), loadImages()]);
      toast.success("اتاق حذف شد");
      setRoomTypeToDelete(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "حذف اتاق انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setDeletingRoomTypeId(null);
    }
  }

  function toggleAmenity(amenity: AmenityResponse, checked: boolean) {
    setRoomTypeDraft((current) => {
      const amenityIds = checked
        ? [...current.amenityIds, amenity.id]
        : current.amenityIds.filter((id) => id !== amenity.id);
      return {
        ...current,
        amenityIds,
        hasPrivateBathroom: amenity.slug === "private-bathroom" ? checked : current.hasPrivateBathroom,
      };
    });
  }

  function renderStep() {
    if (activeStep === 0) {
      return (
        <div className="grid gap-5">
          <div>
            <h3 className="font-black">اطلاعات اصلی</h3>
            <p className="mt-1 text-sm text-[var(--theme-muted-text)]">فیلدهای ستاره‌دار برای ساخت پیش‌نویس الزامی هستند.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-bold">
              نام اتاق / عنوان <span className="text-destructive">*</span>
              <KoochInput onChange={(event) => patchDraft({ name: event.target.value })} value={roomTypeDraft.name} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              نام انگلیسی
              <KoochInput dir="ltr" onChange={(event) => patchDraft({ englishName: event.target.value })} value={roomTypeDraft.englishName} />
            </label>
            <label className="grid gap-1 text-sm font-bold md:col-span-2">
              توضیح
              <KoochTextarea onChange={(event) => patchDraft({ description: event.target.value })} rows={4} value={roomTypeDraft.description} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              تعداد موجودی / TotalInventory <span className="text-destructive">*</span>
              <KoochInput min="1" onChange={(event) => patchDraft({ totalInventory: Number(event.target.value) })} type="number" value={roomTypeDraft.totalInventory} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              ظرفیت بزرگسال <span className="text-destructive">*</span>
              <KoochInput min="1" onChange={(event) => patchDraft({ maxAdults: Number(event.target.value) })} type="number" value={roomTypeDraft.maxAdults} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              ظرفیت کودک
              <KoochInput min="0" onChange={(event) => patchDraft({ maxChildren: Number(event.target.value) })} type="number" value={roomTypeDraft.maxChildren} />
            </label>
          </div>
        </div>
      );
    }

    if (activeStep === 1) {
      return (
        <div className="grid gap-5">
          <div>
            <h3 className="font-black">ویژگی‌ها</h3>
            <p className="mt-1 text-sm text-[var(--theme-muted-text)]">اطلاعات فیزیکی و قوانین نفر اضافه را مشخص کنید.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-bold">
              طبقه
              <KoochInput onChange={(event) => patchDraft({ floorNumber: event.target.value })} type="number" value={roomTypeDraft.floorNumber} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              تعداد پله
              <KoochInput min="0" onChange={(event) => patchDraft({ stairCount: event.target.value })} type="number" value={roomTypeDraft.stairCount} />
            </label>
            <label className="grid gap-1 text-sm font-bold">
              پنجره دارد
              <KoochSelect
                onChange={(event) => patchDraft({ hasWindow: event.target.value === "" ? null : event.target.value === "true" })}
                value={roomTypeDraft.hasWindow === null ? "" : String(roomTypeDraft.hasWindow)}
              >
                <option value="">ثبت نشده</option>
                <option value="true">دارد</option>
                <option value="false">ندارد</option>
              </KoochSelect>
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-3 text-sm font-bold">
              <input
                checked={roomTypeDraft.allowExtraGuest}
                className="h-4 w-4 accent-primary"
                onChange={(event) => patchDraft({ allowExtraGuest: event.target.checked, maxExtraGuests: event.target.checked ? roomTypeDraft.maxExtraGuests : 0 })}
                type="checkbox"
              />
              آیا نفر اضافه مجاز است؟
            </label>
            {roomTypeDraft.allowExtraGuest && (
              <label className="grid gap-1 text-sm font-bold">
                حداکثر تعداد نفر اضافه <span className="text-destructive">*</span>
                <KoochInput min="1" onChange={(event) => patchDraft({ maxExtraGuests: Number(event.target.value) })} type="number" value={roomTypeDraft.maxExtraGuests} />
              </label>
            )}
            <label className="grid gap-1 text-sm font-bold md:col-span-2">
              یادداشت‌ها
              <KoochTextarea onChange={(event) => patchDraft({ notes: event.target.value })} rows={4} value={roomTypeDraft.notes} />
            </label>
          </div>
        </div>
      );
    }

    if (activeStep === 2) {
      return (
        <fieldset>
          <legend className="font-black">امکانات اتاق</legend>
          <p className="mt-1 text-sm text-[var(--theme-muted-text)]">امکانات مرتبط با اتاق را انتخاب کنید. سرویس اختصاصی از همین امکانات تشخیص داده می‌شود.</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {roomAmenityOptions.map((amenity) => (
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-3 text-sm font-bold" key={amenity.id}>
                <input
                  checked={roomTypeDraft.amenityIds.includes(amenity.id)}
                  className="h-4 w-4 accent-primary"
                  onChange={(event) => toggleAmenity(amenity, event.target.checked)}
                  type="checkbox"
                />
                {amenity.name}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    if (activeStep === 3) {
      return (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-black">تخت‌ها / چیدمان</h3>
              <p className="mt-1 text-sm text-[var(--theme-muted-text)]">اگر چیدمان تخت مشخص است، اینجا اضافه کنید.</p>
            </div>
            <KoochButton
              onClick={() => patchDraft({ bedConfigurations: [...roomTypeDraft.bedConfigurations, { bedTypeId: bedTypes[0]?.id ?? 0, quantity: 1 }] })}
              variant="outline"
              type="button"
            >
              افزودن تخت
            </KoochButton>
          </div>
          {roomTypeDraft.bedConfigurations.length === 0 && (
            <p className="rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-surface-muted)] p-5 text-center text-sm text-[var(--theme-muted-text)]">هنوز تختی اضافه نشده است.</p>
          )}
          {roomTypeDraft.bedConfigurations.map((bed, index) => (
            <div className="grid gap-2 md:grid-cols-[1fr_120px_auto]" key={index}>
              <KoochSelect onChange={(event) => updateBed(index, { bedTypeId: Number(event.target.value) })} value={bed.bedTypeId}>
                {bedTypes.map((bedType) => (
                  <option key={bedType.id} value={bedType.id}>
                    {bedTypeLabel(bedType.slug, bedType.name)}
                  </option>
                ))}
              </KoochSelect>
              <KoochInput min="1" onChange={(event) => updateBed(index, { quantity: Number(event.target.value) })} type="number" value={bed.quantity} />
              <KoochButton
                onClick={() => patchDraft({ bedConfigurations: roomTypeDraft.bedConfigurations.filter((_, candidate) => candidate !== index) })}
                size="sm"
                type="button"
                variant="destructive"
              >
                حذف
              </KoochButton>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="grid gap-4">
        <div>
          <h3 className="font-black">تصاویر اتاق</h3>
          <p className="mt-1 text-sm text-[var(--theme-muted-text)]">تصاویر این بخش به همین اتاق متصل می‌شوند. این مرحله آخر است.</p>
        </div>
        {roomTypeDraft.id ? (
          <PropertyImageManager
            fixedRoomTypeId={roomTypeDraft.id}
            images={images}
            onImagesChange={setImages}
            propertyId={propertyId}
            roomTypes={roomTypes}
          />
        ) : (
          <p className="rounded-xl bg-[var(--theme-surface-muted)] p-4 text-sm text-[var(--theme-muted-text)]">ابتدا مرحله اول را تکمیل کنید تا پیش‌نویس اتاق ذخیره شود.</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {error && (
        <KoochCard className="border-destructive text-destructive" variant="elevated">
          <p className="text-sm font-semibold">
          {error}
          </p>
        </KoochCard>
      )}

      <KoochCard variant="elevated">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-foreground">مدیریت اتاق‌ها</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              اتاق‌ها را از طریق ویزارد مرحله‌ای ایجاد یا ویرایش کنید. اتاق‌های پیش‌نویس فعال و قابل رزرو نیستند.
            </p>
          </div>
          <KoochButton onClick={openCreateWizard} type="button">
            افزودن اتاق
          </KoochButton>
        </div>
      </KoochCard>

      <KoochCard variant="elevated">
        <h2 className="text-xl font-black text-foreground">اتاق‌های ثبت‌شده</h2>
        {loading && (
          <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
            در حال بارگذاری اتاق‌ها...
          </p>
        )}
        {!loading && roomTypes.length > 0 && (
          <div className="mt-5">
            <KoochTable>
              <KoochTableHeader>
                <KoochTableRow>
                  <KoochTableHead className="w-14">ردیف</KoochTableHead>
                  <KoochTableHead>تصویر</KoochTableHead>
                  <KoochTableHead>نام اتاق</KoochTableHead>
                  <KoochTableHead>وضعیت</KoochTableHead>
                  <KoochTableHead>موجودی</KoochTableHead>
                  <KoochTableHead>ظرفیت</KoochTableHead>
                  <KoochTableHead>موارد ناقص</KoochTableHead>
                  <KoochTableHead>عملیات</KoochTableHead>
                </KoochTableRow>
              </KoochTableHeader>
              <KoochTableBody>
                {roomTypes.map((roomType, index) => {
                  const firstImage = images.find(
                    (image) => image.roomTypeId === roomType.id,
                  );
                  const status = roomStatus(roomType);
                  return (
                    <KoochTableRow key={roomType.id}>
                      <KoochTableCell className="font-bold text-muted-foreground">
                        {index + 1}
                      </KoochTableCell>
                      <KoochTableCell>
                        {firstImage ? (
                          <img
                            alt={firstImage.altText || firstImage.caption || roomType.name}
                            className="h-14 w-20 rounded-lg object-cover"
                            src={firstImage.url}
                          />
                        ) : (
                          <div className="grid h-14 w-20 place-items-center rounded-lg border border-dashed border-border bg-muted text-xs font-bold text-muted-foreground">
                            بدون تصویر
                          </div>
                        )}
                      </KoochTableCell>
                      <KoochTableCell>
                        <p className="font-black text-foreground">{roomType.name}</p>
                        {roomType.englishName && (
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            {roomType.englishName}
                          </p>
                        )}
                      </KoochTableCell>
                      <KoochTableCell>
                        <KoochBadge variant={status.variant}>{status.label}</KoochBadge>
                      </KoochTableCell>
                      <KoochTableCell className="font-bold">
                        {roomType.totalInventory}
                      </KoochTableCell>
                      <KoochTableCell className="text-sm text-muted-foreground">
                        {roomCapacitySummary(roomType)}
                      </KoochTableCell>
                      <KoochTableCell className="max-w-[260px] text-xs text-muted-foreground">
                        {roomType.completion?.missingItems?.length
                          ? roomType.completion.missingItems.join("، ")
                          : "کامل"}
                      </KoochTableCell>
                      <KoochTableCell>
                        <div className="flex flex-wrap gap-2">
                          <KoochButton
                            onClick={() => editRoomType(roomType)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            ویرایش
                          </KoochButton>
                          <KoochButton
                            disabled={deletingRoomTypeId === roomType.id}
                            loading={deletingRoomTypeId === roomType.id}
                            onClick={() => setRoomTypeToDelete(roomType)}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            حذف
                          </KoochButton>
                        </div>
                      </KoochTableCell>
                    </KoochTableRow>
                  );
                })}
                {roomTypes.length === 0 && (
                  <KoochTableEmpty colSpan={8}>
                    هنوز اتاقی ثبت نشده است.
                  </KoochTableEmpty>
                )}
              </KoochTableBody>
            </KoochTable>
          </div>
        )}
        <div className="hidden">
          {roomTypes.map((roomType) => {
            const details = [
              roomType.floorNumber != null ? `طبقه ${roomType.floorNumber}` : "",
              roomType.stairCount != null ? `${roomType.stairCount} پله` : "",
              booleanLabel(roomType.hasWindow, "دارای پنجره", "بدون پنجره"),
              booleanLabel(roomType.hasPrivateBathroom, "سرویس اختصاصی", "سرویس مشترک"),
            ].filter(Boolean);

            return (
              <KoochCard key={roomType.id} padding="sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black text-foreground">{roomType.name}</h3>
                      {!roomType.isActive && (
                        <KoochBadge variant="muted">
                          پیش‌نویس
                        </KoochBadge>
                      )}
                      {roomType.completion?.isComplete ? (
                        <KoochBadge variant="success">کامل</KoochBadge>
                      ) : (
                        <KoochBadge variant="warning">ناقص</KoochBadge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {roomType.maxAdults + roomType.maxChildren} نفر ·{" "}
                      {roomType.totalInventory === 1 ? "یک واحد اختصاصی" : `موجودی کل ${roomType.totalInventory}`}
                    </p>
                    {roomType.allowExtraGuest && (
                      <p className="mt-1 text-sm font-semibold text-muted-foreground">
                        نفر اضافه مجاز: {roomType.maxExtraGuests}
                      </p>
                    )}
                    {roomType.bedConfigurations.length > 0 && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {roomType.bedConfigurations
                          .map((bed) => `${bed.quantity} × ${bedTypeLabel(bed.bedTypeSlug, bed.bedTypeName)}`)
                          .join("، ")}
                      </p>
                    )}
                    {details.length > 0 && (
                      <p className="mt-2 text-sm font-semibold text-muted-foreground">
                        {details.join(" · ")}
                      </p>
                    )}
                    {roomType.notes && <p className="mt-2 text-sm text-muted-foreground">{roomType.notes}</p>}
                    {roomType.completion && !roomType.completion.isComplete && (
                      <KoochAlert className="mt-3" title="موارد ناقص اتاق" variant="warning">
                        <ul className="grid gap-1">
                          {roomType.completion.missingItems.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </KoochAlert>
                    )}
                    {images.some((image) => image.roomTypeId === roomType.id) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {images
                          .filter((image) => image.roomTypeId === roomType.id)
                          .slice(0, 4)
                          .map((image) => (
                            <img
                              alt={image.altText || image.caption || roomType.name}
                              className="h-[120px] w-[160px] rounded-xl object-cover"
                              key={image.id}
                              src={image.url}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <KoochButton onClick={() => editRoomType(roomType)} size="sm" type="button" variant="outline">
                      ویرایش اتاق
                    </KoochButton>
                    <KoochButton
                      disabled={deletingRoomTypeId === roomType.id}
                      loading={deletingRoomTypeId === roomType.id}
                      onClick={() => setRoomTypeToDelete(roomType)}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      حذف
                    </KoochButton>
                  </div>
                </div>
              </KoochCard>
            );
          })}
        </div>
        {!loading && roomTypes.length === 0 && (
          <p className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
            هنوز اتاقی ثبت نشده است.
          </p>
        )}
      </KoochCard>

      <KoochDialog
        closeDisabled={deletingRoomTypeId !== null}
        description={
          roomTypeToDelete
            ? `آیا از حذف اتاق «${roomTypeToDelete.name}» مطمئن هستید؟`
            : undefined
        }
        footer={
          <div className="flex w-full flex-wrap justify-end gap-3">
            <KoochButton
              disabled={deletingRoomTypeId !== null}
              onClick={() => setRoomTypeToDelete(null)}
              variant="outline"
            >
              لغو
            </KoochButton>
            <KoochButton
              disabled={!roomTypeToDelete}
              loading={deletingRoomTypeId !== null}
              onClick={confirmDeleteRoomType}
              variant="destructive"
            >
              حذف
            </KoochButton>
          </div>
        }
        onOpenChange={(open) => {
          if (!open && deletingRoomTypeId === null) setRoomTypeToDelete(null);
        }}
        open={Boolean(roomTypeToDelete)}
        size="md"
        title="حذف اتاق"
      >
        <KoochAlert variant="warning">
          این عملیات قابل بازگشت نیست و اتاق از لیست مدیریت حذف می‌شود.
        </KoochAlert>
      </KoochDialog>

      <KoochDialog
        closeDisabled={saving}
        description={
          roomTypeDraft.id && !roomTypeDraft.isActive
            ? "این اتاق فعلاً پیش‌نویس است."
            : "اطلاعات اتاق را مرحله‌به‌مرحله تکمیل کنید."
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <KoochButton
              disabled={saving || activeStep === 0}
              onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
              variant="outline"
            >
              قبلی
            </KoochButton>
            <div className="flex flex-wrap gap-3">
              <KoochButton
                disabled={saving}
                onClick={closeWizard}
                variant="outline"
              >
                لغو
              </KoochButton>
              {activeStep < wizardSteps.length - 1 ? (
                <KoochButton
                  disabled={saving}
                  loading={saving}
                  onClick={goNext}
                  variant="primary"
                >
                  {saving ? "در حال ذخیره..." : activeStep === 0 ? "ذخیره و بعدی" : "بعدی"}
                </KoochButton>
              ) : (
                <KoochButton
                  disabled={saving}
                  loading={saving}
                  onClick={activateRoom}
                  variant="primary"
                >
                  {saving ? "در حال فعال‌سازی..." : "فعال‌سازی اتاق"}
                </KoochButton>
              )}
            </div>
          </div>
        }
        onOpenChange={(open) => {
          if (!open && !saving) closeWizard();
        }}
        open={wizardOpen}
        size="xl"
        title={wizardMode === "create" ? "افزودن اتاق" : "ویرایش اتاق"}
      >
        <div className="mb-5 border-b border-border pb-4">
          <div className="grid gap-2 md:grid-cols-5">
            {wizardSteps.map((step, index) => (
              <KoochButton
                className={`justify-start text-right ${
                  index === activeStep
                    ? "border-primary bg-primary text-primary-foreground shadow-md"
                    : index < activeStep
                      ? "border-primary bg-muted text-foreground"
                      : "border-border bg-muted text-muted-foreground hover:text-foreground"
                }`}
                disabled={saving || (index > 0 && !roomTypeDraft.id)}
                key={step}
                onClick={() => setActiveStep(index)}
                size="sm"
                type="button"
                variant="outline"
              >
                <span className="ml-1 inline-grid h-5 w-5 place-items-center rounded-full bg-background/20 text-xs">{index + 1}</span>
                {step}
              </KoochButton>
            ))}
          </div>
        </div>

        {error && (
          <KoochAlert className="mb-4" variant="destructive">
            {error}
          </KoochAlert>
        )}
        {activationWarning.length > 0 && (
          <KoochAlert className="mb-4" title="اتاق هنوز قابل فعال‌سازی نیست" variant="warning">
            <ul className="grid gap-1">
              {activationWarning.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </KoochAlert>
        )}
        {!draftCompletion.isComplete && (
          <KoochAlert className="mb-4" title="وضعیت تکمیل اتاق" variant="default">
            <div className="grid gap-2">
              {draftCompletion.sections.map((section) => (
                <div className="flex flex-wrap items-center justify-between gap-2" key={section.key}>
                  <span className="font-black">{section.label}</span>
                  <KoochBadge
                    variant={
                      section.status === "Complete"
                        ? "success"
                        : section.status === "Incomplete"
                          ? "warning"
                          : "muted"
                    }
                  >
                    {completionStatusLabels[section.status]}
                  </KoochBadge>
                  {section.missingItems.length > 0 && (
                    <span className="basis-full text-xs text-muted-foreground">
                      {section.missingItems.join("، ")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </KoochAlert>
        )}
        {renderStep()}
      </KoochDialog>
    </div>
  );
}
