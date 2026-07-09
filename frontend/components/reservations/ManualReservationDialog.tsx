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
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import type { GuestResponse } from "@/components/guests/GuestManagement";
import {
  apiRequest,
  type AvailabilityResponse,
  type PricingGuestType,
  type PropertyResponse,
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
  guestId: string;
  guestSearch: string;
  checkInDate: string;
  checkOutDate: string;
  adults: string;
  children: string;
  infants: string;
  roomCount: string;
  guestType: PricingGuestType;
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
  guestId: "",
  guestSearch: "",
  checkInDate: "",
  checkOutDate: "",
  adults: "1",
  children: "0",
  infants: "0",
  roomCount: "1",
  guestType: "Iranian",
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
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [availability, setAvailability] = useState<AvailabilityResponse[]>([]);
  const [guestDraft, setGuestDraft] = useState<GuestDraft>(emptyGuestDraft);
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [savingGuest, setSavingGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedPropertyId = Number(draft.propertyId);
  const selectedRoomType = roomTypes.find(
    (roomType) => roomType.id.toString() === draft.roomTypeId,
  );
  const nightsCount = daysBetween(draft.checkInDate, draft.checkOutDate);
  const roomCount = toPositiveInt(draft.roomCount, 1);
  const hasOnRequest = availability.some((day) => day.status === "OnRequest");
  const basePrice =
    availability.length > 0
      ? availability.reduce((sum, day) => sum + (day.price || 0), 0) * roomCount
      : nightsCount * roomCount * (selectedRoomType?.basePrice ?? 0);
  const totalPrice = basePrice;

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
    setShowGuestForm(false);
    setAvailability([]);

    if (context === "admin") {
      apiRequest<PropertyResponse[]>("/admin/properties")
        .then(setProperties)
        .catch(() => setProperties([]));
    }
  }, [context, fixedPropertyId, open]);

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
      setShowGuestForm(false);
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
      toast.error("اقامتگاه، اتاق و مهمان را انتخاب کنید.");
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
          roomCount,
          guestType: draft.guestType,
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
                <KoochSelect
                  onChange={(event) => {
                    updateDraft("propertyId", event.target.value);
                    updateDraft("roomTypeId", "");
                  }}
                  value={draft.propertyId}
                >
                  <option value="">انتخاب اقامتگاه</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>
            )}

            <KoochField label="اتاق" required>
              <KoochSelect
                disabled={!selectedPropertyId || loadingMeta}
                onChange={(event) =>
                  updateDraft("roomTypeId", event.target.value)
                }
                value={draft.roomTypeId}
              >
                <option value="">انتخاب اتاق</option>
                {roomTypes.map((roomType) => (
                  <option key={roomType.id} value={roomType.id}>
                    {roomType.name}
                  </option>
                ))}
              </KoochSelect>
            </KoochField>

            <KoochField label="جستجوی مهمان" required>
              <KoochInput
                onChange={(event) => {
                  updateDraft("guestSearch", event.target.value);
                  updateDraft("guestId", "");
                }}
                placeholder="نام، موبایل یا ایمیل"
                value={draft.guestSearch}
              />
            </KoochField>

            <KoochField label="مهمان">
              <KoochSelect
                onChange={(event) => {
                  if (event.target.value === "new") {
                    setShowGuestForm(true);
                    updateDraft("guestId", "");
                    return;
                  }

                  updateDraft("guestId", event.target.value);
                  const guest = guests.find(
                    (item) => item.id.toString() === event.target.value,
                  );
                  if (guest) updateDraft("guestSearch", guestName(guest));
                }}
                value={draft.guestId}
              >
                <option value="">انتخاب مهمان</option>
                {guests.map((guest) => (
                  <option key={guest.id} value={guest.id}>
                    {guestName(guest)} - {guest.mobile ?? guest.email ?? "-"}
                  </option>
                ))}
                <option value="new">افزودن مهمان جدید</option>
              </KoochSelect>
            </KoochField>

            <KoochField label="تاریخ ورود" required>
              <KoochInput
                onChange={(event) =>
                  updateDraft("checkInDate", event.target.value)
                }
                type="date"
                value={draft.checkInDate}
              />
            </KoochField>

            <KoochField label="تاریخ خروج" required>
              <KoochInput
                onChange={(event) =>
                  updateDraft("checkOutDate", event.target.value)
                }
                type="date"
                value={draft.checkOutDate}
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

            <KoochField label="کودک">
              <KoochInput
                min={0}
                onChange={(event) =>
                  updateDraft("children", event.target.value)
                }
                type="number"
                value={draft.children}
              />
            </KoochField>

            <KoochField label="نوزاد">
              <KoochInput
                min={0}
                onChange={(event) => updateDraft("infants", event.target.value)}
                type="number"
                value={draft.infants}
              />
            </KoochField>

            <KoochField label="تعداد اتاق">
              <KoochInput
                min={1}
                onChange={(event) =>
                  updateDraft("roomCount", event.target.value)
                }
                type="number"
                value={draft.roomCount}
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
          </div>

          {showGuestForm && (
            <KoochCard className="grid gap-4" padding="sm" variant="elevated">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-black text-foreground">
                  افزودن مهمان جدید
                </h3>
                <KoochButton
                  onClick={() => setShowGuestForm(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  بستن
                </KoochButton>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
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
              <div>
                <KoochButton
                  loading={savingGuest}
                  onClick={addGuest}
                  type="button"
                >
                  ذخیره مهمان
                </KoochButton>
              </div>
            </KoochCard>
          )}

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
    </>
  );
}
