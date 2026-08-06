"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import {
  AmenityResponse,
  apiRequest,
  BedTypeResponse,
  bedTypeLabel,
  PropertyImageResponse,
  RoomKindCatalogResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";
import { useSiteCurrencyLabel } from "@/lib/currency";
import {
  formatLocalizedAmount,
  parseLocalizedAmount,
} from "@/lib/localized-amount";

type RoomTypeDraft = {
  id?: number;
  name: string;
  englishName: string;
  description: string;
  roomKindCode: string;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  totalInventory: number;
  basePrice: number;
  floorNumber: string;
  stairCount: string;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  notes: string;
  bedConfigurations: { bedTypeId: number; quantity: number }[];
  amenityIds: number[];
  isActive: boolean;
};

const emptyRoomType: RoomTypeDraft = {
  name: "",
  englishName: "",
  description: "",
  roomKindCode: "",
  maxAdults: 0,
  maxChildren: 0,
  allowExtraGuest: false,
  maxExtraGuests: 0,
  totalInventory: 0,
  basePrice: 0,
  floorNumber: "",
  stairCount: "",
  hasWindow: null,
  hasPrivateBathroom: null,
  notes: "",
  bedConfigurations: [],
  amenityIds: [],
  isActive: false,
};

const steps = [
  "اطلاعات کلی",
  "ظرفیت",
  "امکانات",
  "تخت‌ها",
  "تصاویر",
] as const;

function nullableNumber(value: string) {
  return value === "" ? null : Number(value);
}

function formatPrice(value: number | null, currencyLabel: string) {
  if (value == null || value <= 0) return "قیمت پایه ثبت نشده";
  return `${value.toLocaleString("fa-IR")} ${currencyLabel}`;
}

function roomTypeToDraft(roomType: RoomTypeResponse): RoomTypeDraft {
  return {
    id: roomType.id,
    name: roomType.name,
    englishName: roomType.englishName ?? "",
    description: roomType.description,
    roomKindCode: roomType.roomKindCode,
    maxAdults: roomType.maxAdults,
    maxChildren: roomType.maxChildren,
    allowExtraGuest: roomType.allowExtraGuest,
    maxExtraGuests: roomType.maxExtraGuests,
    totalInventory: roomType.totalInventory,
    basePrice: roomType.basePrice ?? 0,
    floorNumber:
      roomType.floorNumber == null ? "" : String(roomType.floorNumber),
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

export function RoomManagement({ propertyId }: { propertyId: number }) {
  const currencyLabel = useSiteCurrencyLabel();
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [images, setImages] = useState<PropertyImageResponse[]>([]);
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [roomKinds, setRoomKinds] = useState<RoomKindCatalogResponse[]>([]);
  const [draft, setDraft] = useState<RoomTypeDraft>(emptyRoomType);
  const [activeStep, setActiveStep] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const roomAmenities = useMemo(
    () => amenities.filter((item) => item.scope !== "Property"),
    [amenities],
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadRoomTypes(),
      loadImages(),
      apiRequest<BedTypeResponse[]>("/bed-types"),
      apiRequest<AmenityResponse[]>("/amenities"),
      apiRequest<RoomKindCatalogResponse[]>("/catalogs/room-kinds"),
    ])
      .then(([, , beds, amenityItems, kinds]) => {
        setBedTypes(beds);
        setAmenities(amenityItems);
        setRoomKinds(kinds);
      })
      .catch((caught: Error) => {
        setError(caught.message);
        toast.error("اطلاعات اتاق‌ها بارگذاری نشد.");
      })
      .finally(() => setLoading(false));
  }, [propertyId]);

  async function loadRoomTypes() {
    const result = await apiRequest<RoomTypeResponse[]>(
      `/owner/properties/${propertyId}/room-types`,
    );
    setRoomTypes(result);
    return result;
  }

  async function loadImages() {
    const result = await apiRequest<PropertyImageResponse[]>(
      `/owner/properties/${propertyId}/images`,
    );
    setImages(result);
    return result;
  }

  function patchDraft(patch: Partial<RoomTypeDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  }

  function openCreateDialog() {
    setDraft(emptyRoomType);
    setActiveStep(0);
    setError("");
    setDialogOpen(true);
  }

  function openEditDialog(roomType: RoomTypeResponse) {
    setDraft(roomTypeToDraft(roomType));
    setActiveStep(0);
    setError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setDraft(emptyRoomType);
    setActiveStep(0);
    setError("");
  }

  function validateStep(step: number) {
    if (step === 0) {
      if (!draft.name.trim()) return "نام نوع اتاق الزامی است.";
      if (!roomKinds.some((item) => item.code === draft.roomKindCode)) {
        return "نوع اتاق را انتخاب کنید.";
      }
      if (draft.maxAdults < 1) return "ظرفیت بزرگسال باید حداقل یک نفر باشد.";
      if (draft.maxChildren < 0) return "ظرفیت کودک معتبر نیست.";
      if (draft.totalInventory < 0)
        return "تعداد واحد قابل فروش نمی‌تواند منفی باشد.";
      if (draft.basePrice < 0) return "قیمت پایه معتبر نیست.";
    }
    if (step === 1 && draft.allowExtraGuest && draft.maxExtraGuests < 1) {
      return "حداکثر تعداد نفر اضافه را وارد کنید.";
    }
    return "";
  }

  function toggleAmenity(amenityId: number, checked: boolean) {
    patchDraft({
      amenityIds: checked
        ? [...new Set([...draft.amenityIds, amenityId])]
        : draft.amenityIds.filter((id) => id !== amenityId),
    });
  }

  function updateBed(
    index: number,
    patch: Partial<{ bedTypeId: number; quantity: number }>,
  ) {
    const next = [...draft.bedConfigurations];
    next[index] = { ...next[index], ...patch };
    patchDraft({ bedConfigurations: next });
  }

  async function saveRoomType() {
    for (let step = 0; step < 4; step += 1) {
      const validationError = validateStep(step);
      if (validationError) {
        setActiveStep(step);
        toast.error(validationError);
        return null;
      }
    }

    const roomKind = roomKinds.find(
      (item) => item.code === draft.roomKindCode,
    )?.value;
    if (roomKind == null) return null;

    setSaving(true);
    setError("");
    try {
      const roomType = await apiRequest<RoomTypeResponse>(
        draft.id
          ? `/owner/room-types/${draft.id}`
          : `/owner/properties/${propertyId}/room-types`,
        {
          method: draft.id ? "PUT" : "POST",
          body: JSON.stringify({
            name: draft.name.trim(),
            englishName: draft.englishName.trim() || null,
            description: draft.description.trim() || draft.name.trim(),
            notes: draft.notes.trim() || null,
            floorNumber: nullableNumber(draft.floorNumber),
            stairCount: nullableNumber(draft.stairCount),
            hasWindow: draft.hasWindow,
            hasPrivateBathroom: draft.hasPrivateBathroom,
            roomKind,
            maxAdults: draft.maxAdults,
            maxChildren: draft.maxChildren,
            allowExtraGuest: draft.allowExtraGuest,
            maxExtraGuests: draft.allowExtraGuest ? draft.maxExtraGuests : 0,
            totalInventory: draft.totalInventory,
            basePrice: draft.basePrice,
            bedConfigurations: draft.bedConfigurations.filter(
              (bed) => bed.bedTypeId > 0 && bed.quantity > 0,
            ),
            amenityIds: [...new Set(draft.amenityIds)],
            isActive: draft.isActive,
          }),
        },
      );
      setDraft(roomTypeToDraft(roomType));
      await Promise.all([loadRoomTypes(), loadImages()]);
      toast.success(
        draft.id
          ? "نوع اتاق به‌روزرسانی شد."
          : "نوع اتاق ثبت شد؛ اکنون می‌توانید تصاویر آن را اضافه کنید.",
      );
      return roomType;
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "";
      const message = /already exists|duplicate/i.test(raw)
        ? "نوع اتاقی با این نام قبلاً در این اقامتگاه ثبت شده است."
        : raw || "ثبت نوع اتاق انجام نشد.";
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
    if (activeStep === 3) {
      const roomType = await saveRoomType();
      if (!roomType) return;
    }
    setActiveStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function finish() {
    toast.success("نوع اتاق با موفقیت ذخیره شد.");
    closeDialog();
  }

  async function toggleRoomTypeStatus(roomType: RoomTypeResponse) {
    setSaving(true);
    setError("");
    try {
      await apiRequest<RoomTypeResponse>(`/owner/room-types/${roomType.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: roomType.name,
          englishName: roomType.englishName,
          description: roomType.description,
          roomKind: roomKinds.find(
            (kind) => kind.code === roomType.roomKindCode,
          )?.value,
          maxAdults: roomType.maxAdults,
          maxChildren: roomType.maxChildren,
          allowExtraGuest: roomType.allowExtraGuest,
          maxExtraGuests: roomType.maxExtraGuests,
          totalInventory: roomType.totalInventory,
          basePrice: roomType.basePrice,
          notes: roomType.notes,
          floorNumber: roomType.floorNumber,
          stairCount: roomType.stairCount,
          hasWindow: roomType.hasWindow,
          hasPrivateBathroom: roomType.hasPrivateBathroom,
          bedConfigurations: roomType.bedConfigurations.map((bed) => ({
            bedTypeId: bed.bedTypeId,
            quantity: bed.quantity,
          })),
          amenityIds: roomType.amenities.map((amenity) => amenity.amenityId),
          isActive: !roomType.isActive,
        }),
      });
      await loadRoomTypes();
      toast.success(
        roomType.isActive ? "نوع اتاق غیرفعال شد." : "نوع اتاق فعال شد.",
      );
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "تغییر وضعیت نوع اتاق انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function renderMainStep() {
    return (
      <div className="grid gap-5">
        <div>
          <h3 className="font-black">اطلاعات کلی</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            نام قابل نمایش، نوع استاندارد و ظرفیت فروش را مشخص کنید.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-bold">
            نام نوع اتاق <span className="text-destructive">*</span>
            <KoochInput
              onChange={(event) => patchDraft({ name: event.target.value })}
              value={draft.name}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            نام انگلیسی
            <KoochInput
              dir="ltr"
              onChange={(event) =>
                patchDraft({ englishName: event.target.value })
              }
              value={draft.englishName}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            نوع استاندارد اتاق <span className="text-destructive">*</span>
            <KoochSelect
              onChange={(event) =>
                patchDraft({ roomKindCode: event.target.value })
              }
              value={draft.roomKindCode}
            >
              <option value="">انتخاب نوع استاندارد</option>
              {roomKinds.map((kind) => (
                <option key={kind.code} value={kind.code}>
                  {kind.titleFa}
                </option>
              ))}
            </KoochSelect>
          </label>
          <label className="grid gap-1 text-sm font-bold">
            تعداد واحد قابل فروش <span className="text-destructive">*</span>
            <KoochInput
              min="0"
              onChange={(event) =>
                patchDraft({ totalInventory: Number(event.target.value) })
              }
              type="number"
              value={draft.totalInventory}
            />
            <span className="text-xs font-normal text-muted-foreground">
              صفر یعنی این نوع اتاق هنوز برای فروش آماده نیست.
            </span>
          </label>
          <label className="grid gap-1 text-sm font-bold">
            ظرفیت بزرگسال <span className="text-destructive">*</span>
            <KoochInput
              min="1"
              onChange={(event) =>
                patchDraft({ maxAdults: Number(event.target.value) })
              }
              type="number"
              value={draft.maxAdults}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            ظرفیت کودک
            <KoochInput
              min="0"
              onChange={(event) =>
                patchDraft({ maxChildren: Number(event.target.value) })
              }
              type="number"
              value={draft.maxChildren}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            قیمت پایه ({currencyLabel})
            <KoochInput
              inputMode="numeric"
              onChange={(event) =>
                patchDraft({ basePrice: parseLocalizedAmount(event.target.value) ?? 0 })
              }
              type="text"
              value={formatLocalizedAmount(draft.basePrice)}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold md:col-span-2">
            توضیحات نوع اتاق
            <KoochTextarea
              onChange={(event) =>
                patchDraft({ description: event.target.value })
              }
              rows={4}
              value={draft.description}
            />
          </label>
        </div>
      </div>
    );
  }

  function renderFeaturesStep() {
    return (
      <div className="grid gap-5">
        <div>
          <h3 className="font-black">ویژگی‌های نوع اتاق</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            ویژگی‌های فیزیکی و شرایط پذیرش نفر اضافه را وارد کنید.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-bold">
            طبقه
            <KoochInput
              onChange={(event) =>
                patchDraft({ floorNumber: event.target.value })
              }
              type="number"
              value={draft.floorNumber}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            تعداد پله
            <KoochInput
              min="0"
              onChange={(event) =>
                patchDraft({ stairCount: event.target.value })
              }
              type="number"
              value={draft.stairCount}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            وضعیت پنجره
            <KoochSelect
              onChange={(event) =>
                patchDraft({
                  hasWindow:
                    event.target.value === ""
                      ? null
                      : event.target.value === "true",
                })
              }
              value={draft.hasWindow == null ? "" : String(draft.hasWindow)}
            >
              <option value="">نامشخص</option>
              <option value="true">دارای پنجره</option>
              <option value="false">بدون پنجره</option>
            </KoochSelect>
          </label>
          <label className="grid gap-1 text-sm font-bold">
            سرویس بهداشتی
            <KoochSelect
              onChange={(event) =>
                patchDraft({
                  hasPrivateBathroom:
                    event.target.value === ""
                      ? null
                      : event.target.value === "true",
                })
              }
              value={
                draft.hasPrivateBathroom == null
                  ? ""
                  : String(draft.hasPrivateBathroom)
              }
            >
              <option value="">نامشخص</option>
              <option value="true">اختصاصی</option>
              <option value="false">مشترک</option>
            </KoochSelect>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input
              checked={draft.allowExtraGuest}
              onChange={(event) =>
                patchDraft({ allowExtraGuest: event.target.checked })
              }
              type="checkbox"
            />
            پذیرش نفر اضافه
          </label>
          {draft.allowExtraGuest && (
            <label className="grid gap-1 text-sm font-bold">
              حداکثر نفر اضافه
              <KoochInput
                min="1"
                onChange={(event) =>
                  patchDraft({ maxExtraGuests: Number(event.target.value) })
                }
                type="number"
                value={draft.maxExtraGuests}
              />
            </label>
          )}
          <label className="grid gap-1 text-sm font-bold md:col-span-2">
            یادداشت داخلی
            <KoochTextarea
              onChange={(event) => patchDraft({ notes: event.target.value })}
              rows={3}
              value={draft.notes}
            />
          </label>
        </div>
      </div>
    );
  }

  function renderAmenitiesStep() {
    return (
      <div className="grid gap-5">
        <div>
          <h3 className="font-black">امکانات</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            امکانات این نوع اتاق را انتخاب کنید.
          </p>
        </div>
        {roomAmenities.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            امکانی برای انتخاب تعریف نشده است.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {roomAmenities.map((amenity) => (
              <label
                className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                key={amenity.id}
              >
                <input
                  checked={draft.amenityIds.includes(amenity.id)}
                  onChange={(event) =>
                    toggleAmenity(amenity.id, event.target.checked)
                  }
                  type="checkbox"
                />
                {amenity.name}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderBedsStep() {
    return (
      <div className="grid gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-black">تخت‌ها و چیدمان</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              نوع و تعداد تخت‌های این نوع اتاق را مشخص کنید.
            </p>
          </div>
          <KoochButton
            onClick={() =>
              patchDraft({
                bedConfigurations: [
                  ...draft.bedConfigurations,
                  { bedTypeId: bedTypes[0]?.id ?? 0, quantity: 1 },
                ],
              })
            }
            size="sm"
            variant="outline"
          >
            افزودن تخت
          </KoochButton>
        </div>
        {draft.bedConfigurations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            هنوز تختی اضافه نشده است.
          </p>
        ) : (
          <div className="grid gap-3">
            {draft.bedConfigurations.map((bed, index) => (
              <div
                className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]"
                key={`${bed.bedTypeId}-${index}`}
              >
                <KoochSelect
                  aria-label={`نوع تخت ${index + 1}`}
                  onChange={(event) =>
                    updateBed(index, { bedTypeId: Number(event.target.value) })
                  }
                  value={bed.bedTypeId}
                >
                  <option value="0">انتخاب نوع تخت</option>
                  {bedTypes.map((bedType) => (
                    <option key={bedType.id} value={bedType.id}>
                      {bedTypeLabel(bedType.slug, bedType.name)}
                    </option>
                  ))}
                </KoochSelect>
                <KoochInput
                  aria-label={`تعداد تخت ${index + 1}`}
                  min="1"
                  onChange={(event) =>
                    updateBed(index, { quantity: Number(event.target.value) })
                  }
                  type="number"
                  value={bed.quantity}
                />
                <KoochButton
                  onClick={() =>
                    patchDraft({
                      bedConfigurations: draft.bedConfigurations.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                  size="sm"
                  variant="ghost"
                >
                  حذف
                </KoochButton>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderImagesStep() {
    if (!draft.id) {
      return (
        <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          ابتدا اطلاعات نوع اتاق را ثبت کنید تا بخش تصاویر فعال شود.
        </p>
      );
    }
    return (
      <div className="grid gap-4">
        <div>
          <h3 className="font-black">تصاویر نوع اتاق</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            این تصاویر در صفحه عمومی همین نوع اتاق نمایش داده می‌شوند.
          </p>
        </div>
        <PropertyImageManager
          fixedRoomTypeId={draft.id}
          images={images}
          onImagesChange={setImages}
          propertyId={propertyId}
        />
      </div>
    );
  }

  const currentStep = [
    renderMainStep,
    renderFeaturesStep,
    renderAmenitiesStep,
    renderBedsStep,
    renderImagesStep,
  ][activeStep];

  return (
    <div className="grid w-full min-w-0 gap-5">
      <KoochCard variant="elevated">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-black text-foreground">
              مدیریت نوع‌های اتاق
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              هر نوع اتاق قابل فروش را با نام واقعی، طبقه‌بندی استاندارد و تعداد
              موجودی ثبت کنید.
            </p>
          </div>
          <KoochButton onClick={openCreateDialog}>افزودن نوع اتاق</KoochButton>
        </div>
      </KoochCard>

      {error && !dialogOpen && (
        <KoochAlert variant="destructive">{error}</KoochAlert>
      )}

      <KoochCard variant="elevated">
        <h2 className="text-xl font-black text-foreground">
          نوع‌های اتاق ثبت‌شده
        </h2>
        {loading ? (
          <p className="mt-5 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            در حال بارگذاری نوع‌های اتاق...
          </p>
        ) : (
          <div className="mt-5 min-w-0">
            <KoochTable>
              <KoochTableHeader>
                <KoochTableRow>
                  <KoochTableHead>تصویر</KoochTableHead>
                  <KoochTableHead>نام نوع اتاق</KoochTableHead>
                  <KoochTableHead>نوع استاندارد</KoochTableHead>
                  <KoochTableHead>موجودی فروش</KoochTableHead>
                  <KoochTableHead>ظرفیت</KoochTableHead>
                  <KoochTableHead>قیمت پایه</KoochTableHead>
                  <KoochTableHead>وضعیت</KoochTableHead>
                  <KoochTableHead>عملیات</KoochTableHead>
                </KoochTableRow>
              </KoochTableHeader>
              <KoochTableBody>
                {roomTypes.map((roomType) => {
                  const kind = roomKinds.find(
                    (item) => item.code === roomType.roomKindCode,
                  );
                  const image = images.find(
                    (item) => item.roomTypeId === roomType.id,
                  );
                  return (
                    <KoochTableRow key={roomType.id}>
                      <KoochTableCell>
                        {image ? (
                          <img
                            alt={
                              image.altText || image.caption || roomType.name
                            }
                            className="h-14 w-20 rounded-lg object-cover"
                            src={image.url}
                          />
                        ) : (
                          <div className="grid h-14 w-20 place-items-center rounded-lg border border-dashed border-border bg-muted text-xs text-muted-foreground">
                            بدون تصویر
                          </div>
                        )}
                      </KoochTableCell>
                      <KoochTableCell className="font-black">
                        <span className="break-words">{roomType.name}</span>
                      </KoochTableCell>
                      <KoochTableCell>
                        {kind?.titleFa ?? roomType.roomKindCode}
                      </KoochTableCell>
                      <KoochTableCell>
                        <div className="grid gap-1">
                          <span className="font-bold">
                            {roomType.totalInventory}
                          </span>
                          {roomType.totalInventory === 0 && (
                            <span className="text-xs font-bold text-warning-foreground">
                              موجودی فروش صفر است
                            </span>
                          )}
                        </div>
                      </KoochTableCell>
                      <KoochTableCell>
                        {roomType.maxAdults} بزرگسال
                        {roomType.maxChildren > 0
                          ? `، ${roomType.maxChildren} کودک`
                          : ""}
                      </KoochTableCell>
                      <KoochTableCell>
                        {formatPrice(roomType.basePrice, currencyLabel)}
                      </KoochTableCell>
                      <KoochTableCell>
                        <KoochBadge
                          variant={roomType.isActive ? "success" : "muted"}
                        >
                          {roomType.isActive ? "فعال" : "غیرفعال"}
                        </KoochBadge>
                      </KoochTableCell>
                      <KoochTableCell>
                        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                          <KoochButton
                            onClick={() => openEditDialog(roomType)}
                            size="sm"
                            variant="outline"
                          >
                            ویرایش
                          </KoochButton>
                          <KoochButton
                            disabled={saving}
                            onClick={() => void toggleRoomTypeStatus(roomType)}
                            size="sm"
                            variant="ghost"
                          >
                            {roomType.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                          </KoochButton>
                        </div>
                      </KoochTableCell>
                    </KoochTableRow>
                  );
                })}
                {roomTypes.length === 0 && (
                  <KoochTableEmpty colSpan={8}>
                    هنوز نوع اتاقی ثبت نشده است. برای شروع «افزودن نوع اتاق» را
                    انتخاب کنید.
                  </KoochTableEmpty>
                )}
              </KoochTableBody>
            </KoochTable>
          </div>
        )}
      </KoochCard>

      <KoochDialog
        closeButtonClassName="left-4"
        closeDisabled={saving}
        description="اطلاعات نوع اتاق قابل فروش را مرحله‌به‌مرحله تکمیل کنید."
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <KoochButton
              disabled={saving || activeStep === 0}
              onClick={() => setActiveStep((current) => current - 1)}
              variant="outline"
            >
              قبلی
            </KoochButton>
            <div className="flex flex-nowrap items-center gap-2">
              <KoochButton
                disabled={saving}
                onClick={closeDialog}
                variant="outline"
              >
                لغو
              </KoochButton>
              {activeStep < steps.length - 1 ? (
                <KoochButton loading={saving} onClick={goNext}>
                  {activeStep === 3 ? "ذخیره و ادامه به تصاویر" : "بعدی"}
                </KoochButton>
              ) : (
                <KoochButton onClick={finish}>پایان</KoochButton>
              )}
            </div>
          </div>
        }
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={dialogOpen}
        size="lg"
        title={draft.id ? "ویرایش نوع اتاق" : "افزودن نوع اتاق"}
      >
        <div className="mb-5 grid gap-2 border-b border-border pb-4 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, index) => (
            <KoochButton
              className="w-full justify-start whitespace-normal text-right"
              disabled={
                saving || index > activeStep || (index === 4 && !draft.id)
              }
              key={step}
              onClick={() => setActiveStep(index)}
              size="sm"
              variant={index === activeStep ? "primary" : "outline"}
            >
              {step}
            </KoochButton>
          ))}
        </div>
        {error && (
          <KoochAlert className="mb-4" variant="destructive">
            {error}
          </KoochAlert>
        )}
        {currentStep()}
      </KoochDialog>
    </div>
  );
}
