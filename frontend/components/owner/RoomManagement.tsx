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
  InventoryMode,
  OwnerRoomResponse,
  PropertyImageResponse,
  RoomKindCatalogResponse,
} from "@/lib/owner-api";

type RoomDraft = {
  roomId?: number;
  roomTypeId?: number;
  name: string;
  englishName: string;
  description: string;
  roomKindCode: string;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  inventoryMode: InventoryMode;
  basePrice: number;
  floorNumber: string;
  stairCount: string;
  hasWindow: boolean | null;
  hasPrivateBathroom: boolean | null;
  notes: string;
  bedConfigurations: { bedTypeId: number; quantity: number }[];
  amenityIds: number[];
};

const emptyRoom: RoomDraft = {
  name: "",
  englishName: "",
  description: "",
  roomKindCode: "",
  maxAdults: 2,
  maxChildren: 0,
  allowExtraGuest: false,
  maxExtraGuests: 0,
  inventoryMode: "NamedRooms",
  basePrice: 0,
  floorNumber: "",
  stairCount: "",
  hasWindow: null,
  hasPrivateBathroom: null,
  notes: "",
  bedConfigurations: [],
  amenityIds: [],
};

const steps = [
  "اطلاعات اصلی",
  "ویژگی‌ها",
  "امکانات",
  "تخت‌ها و چیدمان",
  "تصاویر",
] as const;

function nullableNumber(value: string) {
  return value === "" ? null : Number(value);
}

function formatPrice(value: number | null) {
  if (value == null || value <= 0) return "قیمت پایه ثبت نشده";
  return `${value.toLocaleString("fa-IR")} تومان`;
}

export function RoomManagement({ propertyId }: { propertyId: number }) {
  const [rooms, setRooms] = useState<OwnerRoomResponse[]>([]);
  const [images, setImages] = useState<PropertyImageResponse[]>([]);
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [roomKinds, setRoomKinds] = useState<RoomKindCatalogResponse[]>([]);
  const [draft, setDraft] = useState<RoomDraft>(emptyRoom);
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
      loadRooms(),
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

  async function loadRooms() {
    const result = await apiRequest<OwnerRoomResponse[]>(
      `/owner/properties/${propertyId}/rooms`,
    );
    setRooms(result);
    return result;
  }

  async function loadImages() {
    const result = await apiRequest<PropertyImageResponse[]>(
      `/owner/properties/${propertyId}/images`,
    );
    setImages(result);
    return result;
  }

  function patchDraft(patch: Partial<RoomDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  }

  function openCreateDialog() {
    setDraft(emptyRoom);
    setActiveStep(0);
    setError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setDraft(emptyRoom);
    setActiveStep(0);
    setError("");
  }

  function validateStep(step: number) {
    if (step === 0) {
      if (!draft.name.trim()) return "نام اتاق الزامی است.";
      if (!roomKinds.some((item) => item.code === draft.roomKindCode)) {
        return "نوع اتاق را انتخاب کنید.";
      }
      if (draft.maxAdults < 1) return "ظرفیت بزرگسال باید حداقل یک نفر باشد.";
      if (draft.maxChildren < 0) return "ظرفیت کودک معتبر نیست.";
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

  async function createRoom() {
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
      const room = await apiRequest<OwnerRoomResponse>(
        `/owner/properties/${propertyId}/rooms`,
        {
          method: "POST",
          body: JSON.stringify({
            name: draft.name.trim(),
            englishName: draft.englishName.trim() || null,
            description: draft.description.trim() || null,
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
            inventoryMode: draft.inventoryMode,
            basePrice: draft.basePrice,
            bedConfigurations: draft.bedConfigurations.filter(
              (bed) => bed.bedTypeId > 0 && bed.quantity > 0,
            ),
            amenityIds: [...new Set(draft.amenityIds)],
          }),
        },
      );
      setDraft((current) => ({
        ...current,
        roomId: room.id,
        roomTypeId: room.roomTypeId,
      }));
      await Promise.all([loadRooms(), loadImages()]);
      toast.success("اتاق ثبت شد؛ اکنون می‌توانید تصاویر آن را اضافه کنید.");
      return room;
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "";
      const message = /already exists|duplicate/i.test(raw)
        ? "اتاقی با این نام قبلاً در این اقامتگاه ثبت شده است."
        : raw || "ثبت اتاق انجام نشد.";
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
    if (activeStep === 3 && !draft.roomId) {
      const room = await createRoom();
      if (!room) return;
    }
    setActiveStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function finish() {
    toast.success("اتاق با موفقیت افزوده شد.");
    closeDialog();
  }

  function renderMainStep() {
    return (
      <div className="grid gap-5">
        <div>
          <h3 className="font-black">اطلاعات اصلی</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            نام واحد فیزیکی و نوع استاندارد آن را مشخص کنید.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-bold">
            نام اتاق <span className="text-destructive">*</span>
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
            نوع اتاق <span className="text-destructive">*</span>
            <KoochSelect
              onChange={(event) =>
                patchDraft({ roomKindCode: event.target.value })
              }
              value={draft.roomKindCode}
            >
              <option value="">انتخاب نوع اتاق</option>
              {roomKinds.map((kind) => (
                <option key={kind.code} value={kind.code}>
                  {kind.titleFa}
                </option>
              ))}
            </KoochSelect>
          </label>
          <label className="grid gap-1 text-sm font-bold">
            شیوه مدیریت موجودی <span className="text-destructive">*</span>
            <KoochSelect
              onChange={(event) =>
                patchDraft({ inventoryMode: event.target.value as InventoryMode })
              }
              value={draft.inventoryMode}
            >
              <option value="NamedRooms">اتاق نام‌دار</option>
              <option value="TypeBasedInventory">موجودی تعدادی</option>
            </KoochSelect>
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
            قیمت پایه (تومان)
            <KoochInput
              min="0"
              onChange={(event) =>
                patchDraft({ basePrice: Number(event.target.value) })
              }
              type="number"
              value={draft.basePrice}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold md:col-span-2">
            توضیحات اتاق
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
          <h3 className="font-black">ویژگی‌های اتاق</h3>
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
            امکانات مشترک این الگوی اتاق را انتخاب کنید.
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
              نوع و تعداد تخت‌های این اتاق را مشخص کنید.
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
    if (!draft.roomTypeId) {
      return (
        <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          ابتدا اطلاعات اتاق را ثبت کنید تا بخش تصاویر فعال شود.
        </p>
      );
    }
    return (
      <div className="grid gap-4">
        <div>
          <h3 className="font-black">تصاویر اتاق</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            این تصاویر برای اتاق‌های دارای مشخصات مشترک استفاده می‌شوند.
          </p>
        </div>
        <PropertyImageManager
          fixedRoomTypeId={draft.roomTypeId}
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
            <h2 className="text-xl font-black text-foreground">مدیریت اتاق‌ها</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              هر واحد قابل رزرو را با نام، نوع، ظرفیت و امکانات خودش ثبت کنید.
            </p>
          </div>
          <KoochButton onClick={openCreateDialog}>افزودن اتاق</KoochButton>
        </div>
      </KoochCard>

      {error && !dialogOpen && (
        <KoochAlert variant="destructive">{error}</KoochAlert>
      )}

      <KoochCard variant="elevated">
        <h2 className="text-xl font-black text-foreground">اتاق‌های ثبت‌شده</h2>
        {loading ? (
          <p className="mt-5 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            در حال بارگذاری اتاق‌ها...
          </p>
        ) : (
          <div className="mt-5 min-w-0">
            <KoochTable>
              <KoochTableHeader>
                <KoochTableRow>
                  <KoochTableHead>تصویر</KoochTableHead>
                  <KoochTableHead>نام اتاق</KoochTableHead>
                  <KoochTableHead>نوع اتاق</KoochTableHead>
                  <KoochTableHead>ظرفیت</KoochTableHead>
                  <KoochTableHead>قیمت پایه</KoochTableHead>
                  <KoochTableHead>وضعیت</KoochTableHead>
                </KoochTableRow>
              </KoochTableHeader>
              <KoochTableBody>
                {rooms.map((room) => {
                  const kind = roomKinds.find(
                    (item) => item.code === room.roomKindCode,
                  );
                  const image = images.find(
                    (item) => item.roomTypeId === room.roomTypeId,
                  );
                  return (
                    <KoochTableRow key={room.id}>
                      <KoochTableCell>
                        {image ? (
                          <img
                            alt={image.altText || image.caption || room.name}
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
                        {room.name}
                      </KoochTableCell>
                      <KoochTableCell>
                        {kind?.titleFa ?? room.roomKindCode}
                      </KoochTableCell>
                      <KoochTableCell>
                        {room.maxAdults} بزرگسال
                        {room.maxChildren > 0
                          ? `، ${room.maxChildren} کودک`
                          : ""}
                      </KoochTableCell>
                      <KoochTableCell>{formatPrice(room.basePrice)}</KoochTableCell>
                      <KoochTableCell>
                        <KoochBadge variant={room.isActive ? "success" : "muted"}>
                          {room.isActive ? "فعال" : "غیرفعال"}
                        </KoochBadge>
                      </KoochTableCell>
                    </KoochTableRow>
                  );
                })}
                {rooms.length === 0 && (
                  <KoochTableEmpty colSpan={6}>
                    هنوز اتاقی ثبت نشده است. برای شروع «افزودن اتاق» را انتخاب
                    کنید.
                  </KoochTableEmpty>
                )}
              </KoochTableBody>
            </KoochTable>
          </div>
        )}
      </KoochCard>

      <KoochDialog
        closeDisabled={saving}
        description="اطلاعات واحد فیزیکی قابل رزرو را مرحله‌به‌مرحله تکمیل کنید."
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
              <KoochButton disabled={saving} onClick={closeDialog} variant="outline">
                لغو
              </KoochButton>
              {activeStep < steps.length - 1 ? (
                <KoochButton loading={saving} onClick={goNext}>
                  {activeStep === 3 ? "ثبت و ادامه به تصاویر" : "بعدی"}
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
        title="افزودن اتاق"
      >
        <div className="mb-5 grid gap-2 border-b border-border pb-4 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, index) => (
            <KoochButton
              className="w-full justify-start whitespace-normal text-right"
              disabled={saving || index > activeStep || (index === 4 && !draft.roomId)}
              key={step}
              onClick={() => setActiveStep(index)}
              size="sm"
              variant={index === activeStep ? "primary" : "outline"}
            >
              {index + 1}. {step}
            </KoochButton>
          ))}
        </div>
        {error && <KoochAlert className="mb-4" variant="destructive">{error}</KoochAlert>}
        {currentStep()}
      </KoochDialog>
    </div>
  );
}
