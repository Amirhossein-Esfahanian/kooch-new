"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochMultiSelect,
  KoochSearchableSelect,
  KoochSelect,
  KoochTextarea,
  type KoochSearchableSelectOption,
} from "@/components/KoochFormControls";
import type { GuestResponse } from "@/components/guests/GuestManagement";
import {
  apiRequest,
  type AvailabilityResponse,
  type PricingGuestType,
  type PropertyResponse,
  type RoomResponse,
  type RoomTypeResponse,
} from "@/lib/owner-api";
import { KoochDatePicker } from "../KoochDatePicker";

type ReservationContext = "admin" | "owner";

interface ManualReservationDialogProps {
  context: ReservationContext;
  fixedPropertyId?: number;
  onCreated: () => void | Promise<void>;
}

type GuestDraft = {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  nationalCode: string;
  passportNumber: string;
  nationality: string;
};

type ReservationDraft = {
  propertyId: string;
  roomTypeId: string;
  roomIds: string[];
  guestId: string;
  guestSearch: string;
  checkInDate: string;
  checkOutDate: string;
  adults: string;
  children: string;
  infants: string;
  guestType: PricingGuestType;
  status: string;
  notes: string;
};

const emptyGuestDraft: GuestDraft = {
  firstName: "",
  lastName: "",
  mobile: "",
  email: "",
  nationalCode: "",
  passportNumber: "",
  nationality: "",
};

const initialDraft: ReservationDraft = {
  propertyId: "",
  roomTypeId: "",
  roomIds: [],
  guestId: "",
  guestSearch: "",
  checkInDate: "",
  checkOutDate: "",
  adults: "1",
  children: "0",
  infants: "0",
  guestType: "Iranian",
  status: "Pending",
  notes: "",
};

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toNonNegativeInt(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function daysBetween(checkInDate: string, checkOutDate: string) {
  if (!checkInDate || !checkOutDate) return 0;
  const checkIn = new Date(`${checkInDate}T00:00:00`);
  const checkOut = new Date(`${checkOutDate}T00:00:00`);
  const diff = checkOut.getTime() - checkIn.getTime();
  return diff > 0 ? Math.round(diff / 86_400_000) : 0;
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function formatMoney(value: number | null | undefined, currency = "IRR") {
  if (value === null || value === undefined) return "-";
  return `${new Intl.NumberFormat("fa-IR").format(value)} ${currency}`;
}

function formatAge(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function buildChildHelper(property: PropertyResponse | undefined) {
  if (
    property?.freeChildAgeLimit === null ||
    property?.freeChildAgeLimit === undefined
  ) {
    return "قوانین سنی کودک برای این اقامتگاه ثبت نشده است.";
  }

  return `کودک: از ${formatAge(property.freeChildAgeLimit)} سال به بالا طبق قوانین اقامتگاه محاسبه می‌شود.`;
}

function buildInfantHelper(property: PropertyResponse | undefined) {
  if (
    property?.freeChildAgeLimit === null ||
    property?.freeChildAgeLimit === undefined
  ) {
    return "قوانین سنی نوزاد برای این اقامتگاه ثبت نشده است.";
  }

  return `نوزاد: زیر ${formatAge(property.freeChildAgeLimit)} سال.`;
}

function guestName(guest: GuestResponse) {
  return (
    guest.fullName ||
    `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() ||
    "-"
  );
}

function buildGuestPayload(guest: GuestDraft) {
  return {
    firstName: guest.firstName.trim() || null,
    lastName: guest.lastName.trim() || null,
    mobile: guest.mobile.trim() || null,
    email: guest.email.trim() || null,
    nationalCode: guest.nationalCode.trim() || null,
    passportNumber: guest.passportNumber.trim() || null,
    nationality: guest.nationality.trim() || null,
  };
}

export function ManualReservationDialog({
  context,
  fixedPropertyId,
  onCreated,
}: ManualReservationDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReservationDraft>({
    ...initialDraft,
    propertyId: fixedPropertyId?.toString() ?? "",
  });
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [rooms, setRooms] = useState<RoomResponse[]>([]);
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [availability, setAvailability] = useState<AvailabilityResponse[]>([]);
  const [guestDraft, setGuestDraft] = useState<GuestDraft>(emptyGuestDraft);
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [savingGuest, setSavingGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedPropertyId = Number(draft.propertyId);
  const selectedProperty = properties.find(
    (property) => property.id === selectedPropertyId,
  );
  const selectedRoomType = roomTypes.find(
    (roomType) => roomType.id.toString() === draft.roomTypeId,
  );
  const nightsCount = daysBetween(draft.checkInDate, draft.checkOutDate);
  const selectedRoomCount = draft.roomIds.length;
  const hasOnRequest = availability.some((day) => day.status === "OnRequest");
  const basePrice =
    availability.length > 0
      ? availability.reduce((sum, day) => sum + (day.price || 0), 0) *
        selectedRoomCount
      : nightsCount * selectedRoomCount * (selectedRoomType?.basePrice ?? 0);
  const totalPrice = basePrice;
  const propertyOptions = useMemo(
    () =>
      properties.map((property) => ({
        value: property.id,
        label: property.name,
        searchText: property.name,
      })),
    [properties],
  );
  const roomTypeOptions = useMemo(
    () =>
      roomTypes.map((roomType) => ({
        value: roomType.id,
        label: roomType.name,
        description: formatMoney(roomType.basePrice),
        searchText: `${roomType.name} ${roomType.basePrice ?? ""}`,
      })),
    [roomTypes],
  );
  const roomOptions = useMemo(
    () =>
      rooms
        .filter((room) => room.isActive)
        .map((room) => ({
          value: room.id,
          label: room.name,
          description: room.floorNumber
            ? `طبقه ${new Intl.NumberFormat("fa-IR").format(room.floorNumber)}`
            : room.englishName,
          searchText: [
            room.name,
            room.englishName,
            room.description,
            room.notes,
          ]
            .filter(Boolean)
            .join(" "),
        })),
    [rooms],
  );
  const guestOptions = useMemo(() => {
    const options: KoochSearchableSelectOption[] = guests.map((guest) => {
      const name = guestName(guest);
      const description = guest.mobile ?? guest.email ?? "-";

      return {
        value: guest.id,
        label: name,
        description,
        searchText: [
          name,
          guest.mobile,
          guest.email,
          guest.nationalCode,
          guest.passportNumber,
        ]
          .filter(Boolean)
          .join(" "),
      };
    });

    if (
      draft.guestId &&
      !options.some((option) => option.value.toString() === draft.guestId)
    ) {
      options.unshift({
        value: draft.guestId,
        label: draft.guestSearch || `#${draft.guestId}`,
        description: "",
        searchText: draft.guestSearch,
      });
    }

    return options;
  }, [draft.guestId, draft.guestSearch, guests]);
  const reservationStatusOptions = [
    { value: "Pending", label: "در انتظار" },
    { value: "PendingApproval", label: "در انتظار تایید" },
    { value: "ApprovedAwaitingPayment", label: "در انتظار پرداخت" },
    { value: "Confirmed", label: "تایید شده" },
    { value: "Paid", label: "پرداخت شده" },
    { value: "Cancelled", label: "لغو شده" },
  ];

  const guestBasePath = useMemo(() => {
    if (context === "admin") return "/admin/guests";
    return `/owner/properties/${fixedPropertyId}/guests`;
  }, [context, fixedPropertyId]);

  function updateDraft(field: keyof ReservationDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateGuestDraft(field: keyof GuestDraft, value: string) {
    setGuestDraft((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    if (!open) return;

    setDraft((current) => ({
      ...initialDraft,
      propertyId: fixedPropertyId?.toString() ?? current.propertyId,
    }));
    setGuestDraft(emptyGuestDraft);
    setGuestDialogOpen(false);
    setAvailability([]);

    if (context === "admin") {
      apiRequest<PropertyResponse[]>("/admin/properties")
        .then(setProperties)
        .catch(() => setProperties([]));
    } else if (fixedPropertyId) {
      apiRequest<PropertyResponse>(`/owner/properties/${fixedPropertyId}`)
        .then((property) => setProperties([property]))
        .catch(() => setProperties([]));
    }
  }, [context, fixedPropertyId, open]);

  useEffect(() => {
    setDraft((current) => ({ ...current, roomIds: [] }));
  }, [draft.roomTypeId, draft.checkInDate, draft.checkOutDate]);

  useEffect(() => {
    if (!open || !selectedPropertyId) {
      setRoomTypes([]);
      return;
    }

    setLoadingMeta(true);
    apiRequest<RoomTypeResponse[]>(
      `/owner/properties/${selectedPropertyId}/room-types`,
    )
      .then((items) =>
        setRoomTypes(items.filter((roomType) => roomType.isActive)),
      )
      .catch(() => setRoomTypes([]))
      .finally(() => setLoadingMeta(false));
  }, [open, selectedPropertyId]);

  useEffect(() => {
    if (!open || !draft.roomTypeId) {
      setRooms([]);
      return;
    }

    apiRequest<RoomResponse[]>(`/owner/room-types/${draft.roomTypeId}/rooms`)
      .then((items) => setRooms(items.filter((room) => room.isActive)))
      .catch(() => setRooms([]));
  }, [draft.roomTypeId, open]);

  useEffect(() => {
    if (!open || !guestBasePath || draft.guestSearch.trim().length < 2) {
      setGuests([]);
      return;
    }

    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ query: draft.guestSearch.trim() });
      apiRequest<GuestResponse[]>(`${guestBasePath}?${query.toString()}`)
        .then(setGuests)
        .catch(() => setGuests([]));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [draft.guestSearch, guestBasePath, open]);

  useEffect(() => {
    if (!open || !draft.roomTypeId || nightsCount <= 0) {
      setAvailability([]);
      return;
    }

    const params = new URLSearchParams({
      from: draft.checkInDate,
      to: previousDate(draft.checkOutDate),
    });

    apiRequest<AvailabilityResponse[]>(
      `/owner/room-types/${draft.roomTypeId}/availability?${params.toString()}`,
    )
      .then(setAvailability)
      .catch(() => setAvailability([]));
  }, [
    draft.checkInDate,
    draft.checkOutDate,
    draft.roomTypeId,
    nightsCount,
    open,
  ]);

  async function addGuest() {
    if (!guestDraft.firstName.trim() && !guestDraft.lastName.trim()) {
      toast.error("نام یا نام خانوادگی مهمان را وارد کنید.");
      return;
    }

    if (!guestDraft.mobile.trim() && !guestDraft.email.trim()) {
      toast.error("شماره موبایل یا ایمیل مهمان را وارد کنید.");
      return;
    }

    setSavingGuest(true);
    try {
      const guest = await apiRequest<GuestResponse>(guestBasePath, {
        method: "POST",
        body: JSON.stringify(buildGuestPayload(guestDraft)),
      });
      setGuests((current) => [guest, ...current]);
      setDraft((current) => ({
        ...current,
        guestId: guest.id.toString(),
        guestSearch: guestName(guest),
      }));
      setGuestDraft(emptyGuestDraft);
      setGuestDialogOpen(false);
      toast.success("مهمان اضافه شد.");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "مهمان اضافه نشد.",
      );
    } finally {
      setSavingGuest(false);
    }
  }

  async function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedPropertyId || !draft.roomTypeId || !draft.guestId) {
      toast.error("اقامتگاه، نوع اتاق و مهمان را انتخاب کنید.");
      return;
    }

    if (draft.roomIds.length === 0) {
      toast.error("حداقل یک اتاق را انتخاب کنید.");
      return;
    }

    if (nightsCount <= 0) {
      toast.error("تاریخ خروج باید بعد از تاریخ ورود باشد.");
      return;
    }

    setSubmitting(true);
    try {
      const endpoint =
        context === "admin"
          ? "/admin/reservations"
          : `/owner/properties/${fixedPropertyId}/reservations`;

      await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({
          propertyId: selectedPropertyId,
          roomTypeId: Number(draft.roomTypeId),
          guestId: Number(draft.guestId),
          checkInDate: draft.checkInDate,
          checkOutDate: draft.checkOutDate,
          adults: toPositiveInt(draft.adults, 1),
          children: toNonNegativeInt(draft.children),
          infants: toNonNegativeInt(draft.infants),
          roomCount: draft.roomIds.length,
          roomIds: draft.roomIds.map((id) => Number(id)),
          guestType: draft.guestType,
          status: context === "admin" ? draft.status : undefined,
          notes: draft.notes.trim() || null,
        }),
      });

      toast.success("رزرو اضافه شد.");
      setOpen(false);
      await onCreated();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "رزرو اضافه نشد.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <KoochButton onClick={() => setOpen(true)}>افزودن رزرو</KoochButton>
      <KoochDialog
        footer={
          <>
            <KoochButton
              disabled={submitting}
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              انصراف
            </KoochButton>
            <KoochButton
              form="manual-reservation-form"
              loading={submitting}
              type="submit"
            >
              ثبت رزرو
            </KoochButton>
          </>
        }
        onOpenChange={setOpen}
        open={open}
        size="lg"
        title="افزودن رزرو"
      >
        <form
          className="grid gap-4"
          id="manual-reservation-form"
          onSubmit={submitReservation}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {context === "admin" && (
              <KoochField label="اقامتگاه" required>
                <KoochSearchableSelect
                  emptyText="اقامتگاهی پیدا نشد."
                  onChange={(value) => {
                    updateDraft("propertyId", value);
                    updateDraft("roomTypeId", "");
                    setDraft((current) => ({ ...current, roomIds: [] }));
                  }}
                  options={propertyOptions}
                  placeholder="انتخاب اقامتگاه"
                  searchPlaceholder="جستجوی اقامتگاه..."
                  value={draft.propertyId}
                />
              </KoochField>
            )}

            <KoochField label="نوع اتاق" required>
              <KoochSearchableSelect
                disabled={!selectedPropertyId || loadingMeta}
                emptyText="نوع اتاقی پیدا نشد."
                onChange={(value) => updateDraft("roomTypeId", value)}
                options={roomTypeOptions}
                placeholder={
                  loadingMeta ? "در حال بارگذاری..." : "انتخاب نوع اتاق"
                }
                searchPlaceholder="جستجوی نوع اتاق..."
                value={draft.roomTypeId}
              />
            </KoochField>

            <KoochField className="md:col-span-2" label="مهمان" required>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <KoochSearchableSelect
                  emptyText={
                    draft.guestSearch.trim().length < 2
                      ? "برای جستجوی مهمان حداقل دو حرف وارد کنید."
                      : "مهمانی پیدا نشد."
                  }
                  onChange={(value) => {
                    updateDraft("guestId", value);
                    const guest = guests.find(
                      (item) => item.id.toString() === value,
                    );
                    if (guest) updateDraft("guestSearch", guestName(guest));
                  }}
                  onSearchChange={(query) => updateDraft("guestSearch", query)}
                  options={guestOptions}
                  placeholder="انتخاب مهمان"
                  searchPlaceholder="نام، موبایل یا ایمیل"
                  value={draft.guestId}
                />
                {context === "admin" && (
                  <KoochButton
                    onClick={() => setGuestDialogOpen(true)}
                    type="button"
                    variant="outline"
                  >
                    افزودن مهمان
                  </KoochButton>
                )}
              </div>
            </KoochField>

            <KoochField className="md:col-span-2" label="بازه اقامت" required>
              <KoochDatePicker
                labels={{ start: "ورود", end: "خروج" }}
                mode="range"
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    checkInDate: value.startDate ?? "",
                    checkOutDate: value.endDate ?? "",
                    roomIds: [],
                  }))
                }
                placeholderEnd=""
                placeholderStart=""
                showFieldLabels
                value={{
                  startDate: draft.checkInDate || null,
                  endDate: draft.checkOutDate || null,
                }}
              />
              {nightsCount > 0 && (
                <p className="text-xs font-bold text-muted-foreground">
                  تعداد شب: {new Intl.NumberFormat("fa-IR").format(nightsCount)}
                </p>
              )}
            </KoochField>

            <KoochField className="md:col-span-2" label="اتاق‌ها" required>
              <KoochMultiSelect
                disabled={!draft.roomTypeId || nightsCount <= 0}
                emptyText="اتاق فعالی برای این نوع اتاق پیدا نشد."
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    roomIds: value.map(String),
                  }))
                }
                options={roomOptions}
                placeholder={
                  nightsCount <= 0
                    ? "ابتدا بازه اقامت را انتخاب کنید"
                    : "انتخاب اتاق‌ها"
                }
                searchPlaceholder="جستجوی اتاق..."
                value={draft.roomIds}
              />
            </KoochField>

            <KoochField label="بزرگسال">
              <KoochInput
                min={1}
                onChange={(event) => updateDraft("adults", event.target.value)}
                type="number"
                value={draft.adults}
              />
            </KoochField>

            <KoochField
              helperText={buildChildHelper(selectedProperty)}
              label="کودک"
            >
              <KoochInput
                min={0}
                onChange={(event) =>
                  updateDraft("children", event.target.value)
                }
                type="number"
                value={draft.children}
              />
            </KoochField>

            <KoochField
              helperText={buildInfantHelper(selectedProperty)}
              label="نوزاد"
            >
              <KoochInput
                min={0}
                onChange={(event) => updateDraft("infants", event.target.value)}
                type="number"
                value={draft.infants}
              />
            </KoochField>

            <KoochField label="نوع مهمان">
              <KoochSelect
                onChange={(event) =>
                  updateDraft(
                    "guestType",
                    event.target.value as PricingGuestType,
                  )
                }
                value={draft.guestType}
              >
                <option value="Iranian">ایرانی</option>
                <option value="Foreign">خارجی</option>
              </KoochSelect>
            </KoochField>

            {context === "admin" && (
              <KoochField label="وضعیت رزرو">
                <KoochSelect
                  onChange={(event) =>
                    updateDraft("status", event.target.value)
                  }
                  value={draft.status}
                >
                  {reservationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>
            )}
          </div>

          {hasOnRequest && (
            <KoochAlert title="نیازمند تایید" variant="warning">
              این رزرو نیازمند تایید است و فعلاً پرداخت یا کاهش موجودی انجام
              نمی‌شود.
            </KoochAlert>
          )}

          <KoochCard className="grid gap-3" padding="sm" variant="elevated">
            <h3 className="text-sm font-black text-foreground">خلاصه قیمت</h3>
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <span>
                تعداد شب: {new Intl.NumberFormat("fa-IR").format(nightsCount)}
              </span>
              <span>
                تعداد اتاق:{" "}
                {new Intl.NumberFormat("fa-IR").format(selectedRoomCount)}
              </span>
              <span>قیمت پایه: {formatMoney(basePrice)}</span>
              <span>هزینه کودک: {formatMoney(0)}</span>
              <span>هزینه نفر اضافه: {formatMoney(0)}</span>
              <span>تخفیف پروموشن: {formatMoney(0)}</span>
              <span className="font-black">
                مبلغ کل: {formatMoney(totalPrice)}
              </span>
            </div>
          </KoochCard>

          <KoochField label="یادداشت">
            <KoochTextarea
              onChange={(event) => updateDraft("notes", event.target.value)}
              rows={3}
              value={draft.notes}
            />
          </KoochField>
        </form>
      </KoochDialog>

      <KoochDialog
        footer={
          <>
            <KoochButton
              disabled={savingGuest}
              onClick={() => setGuestDialogOpen(false)}
              type="button"
              variant="outline"
            >
              انصراف
            </KoochButton>
            <KoochButton loading={savingGuest} onClick={addGuest} type="button">
              ذخیره مهمان
            </KoochButton>
          </>
        }
        onOpenChange={setGuestDialogOpen}
        open={guestDialogOpen}
        title="افزودن مهمان"
        size="md"
      >
        <div className="grid gap-4" dir="rtl">
          <div className="grid gap-4 md:grid-cols-2">
            <KoochField label="نام">
              <KoochInput
                onChange={(event) =>
                  updateGuestDraft("firstName", event.target.value)
                }
                value={guestDraft.firstName}
              />
            </KoochField>
            <KoochField label="نام خانوادگی">
              <KoochInput
                onChange={(event) =>
                  updateGuestDraft("lastName", event.target.value)
                }
                value={guestDraft.lastName}
              />
            </KoochField>
            <KoochField label="موبایل">
              <KoochInput
                inputMode="tel"
                onChange={(event) =>
                  updateGuestDraft("mobile", event.target.value)
                }
                value={guestDraft.mobile}
              />
            </KoochField>
            <KoochField label="ایمیل">
              <KoochInput
                dir="ltr"
                onChange={(event) =>
                  updateGuestDraft("email", event.target.value)
                }
                type="email"
                value={guestDraft.email}
              />
            </KoochField>
            <KoochField label="کد ملی">
              <KoochInput
                onChange={(event) =>
                  updateGuestDraft("nationalCode", event.target.value)
                }
                value={guestDraft.nationalCode}
              />
            </KoochField>
            <KoochField label="شماره پاسپورت">
              <KoochInput
                dir="ltr"
                onChange={(event) =>
                  updateGuestDraft("passportNumber", event.target.value)
                }
                value={guestDraft.passportNumber}
              />
            </KoochField>
            <KoochField label="ملیت">
              <KoochInput
                onChange={(event) =>
                  updateGuestDraft("nationality", event.target.value)
                }
                value={guestDraft.nationality}
              />
            </KoochField>
          </div>
        </div>
      </KoochDialog>
    </>
  );
}
