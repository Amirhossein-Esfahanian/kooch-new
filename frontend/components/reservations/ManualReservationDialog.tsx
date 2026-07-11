"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
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
  type PricingGuestType,
  type PropertyResponse,
  type RoomTypeResponse,
} from "@/lib/owner-api";
import { KoochDatePicker } from "../KoochDatePicker";
import type { ReservationTableItem } from "./ReservationTable";

type ReservationContext = "admin" | "owner";

interface ManualReservationDialogProps {
  context: ReservationContext;
  fixedPropertyId?: number;
  mode?: "create" | "edit";
  onCreated: () => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  reservation?: ReservationTableItem | null;
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
  childAges: string[];
  guestType: PricingGuestType;
  status: string;
  notes: string;
};

type ReservationPricePreviewResponse = {
  nightsCount: number;
  roomCount: number;
  baseAmount: number;
  childAmount: number;
  extraGuestAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: string;
};

type ReservationSettingsResponse = {
  freeChildMaxAge: number | null;
  halfPriceChildMinAge: number | null;
  halfPriceChildMaxAge: number | null;
  halfPriceChildRate: number;
};

type AvailableRoomResponse = {
  id: number;
  roomTypeId: number;
  name: string;
  capacity: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  bookingMode: "Instant" | "OnRequest";
};

type ChildRuleSummary = {
  source: string;
  freeChildText: string;
  childPricingText: string;
  adultText: string;
  roomText: string;
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
  childAges: [],
  guestType: "Iranian",
  status: "Pending",
  notes: "",
};

function reservationDraft(
  reservation: ReservationTableItem | null | undefined,
  fixedPropertyId?: number,
): ReservationDraft {
  if (!reservation) {
    return {
      ...initialDraft,
      propertyId: fixedPropertyId?.toString() ?? "",
    };
  }

  return {
    propertyId:
      fixedPropertyId?.toString() ?? reservation.propertyId?.toString() ?? "",
    roomTypeId: reservation.roomTypeId?.toString() ?? "",
    roomIds: reservation.roomId ? [reservation.roomId.toString()] : [],
    guestId: reservation.guestId?.toString() ?? "",
    guestSearch: reservation.guestName ?? reservation.guestFullName ?? "",
    checkInDate: reservation.checkInDate ?? "",
    checkOutDate: reservation.checkOutDate ?? "",
    adults: Math.max(1, reservation.adults ?? 1).toString(),
    children: Math.max(0, reservation.children ?? 0).toString(),
    childAges: normalizeChildAges([], Math.max(0, reservation.children ?? 0)),
    guestType: reservation.guestType === "Foreign" ? "Foreign" : "Iranian",
    status: reservation.status || initialDraft.status,
    notes: reservation.notes ?? "",
  };
}

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toNonNegativeInt(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function normalizeChildAges(childAges: string[], childrenCount: number) {
  return Array.from(
    { length: Math.max(0, childrenCount) },
    (_, index) => childAges[index] ?? "",
  );
}

function childAgesPayload(childAges: string[], childrenCount: number) {
  return normalizeChildAges(childAges, childrenCount).map((value) =>
    toNonNegativeInt(value),
  );
}

function daysBetween(checkInDate: string, checkOutDate: string) {
  if (!checkInDate || !checkOutDate) return 0;
  const checkIn = new Date(`${checkInDate}T00:00:00`);
  const checkOut = new Date(`${checkOutDate}T00:00:00`);
  const diff = checkOut.getTime() - checkIn.getTime();
  return diff > 0 ? Math.round(diff / 86_400_000) : 0;
}

function formatMoney(value: number | null | undefined, currency = "IRR") {
  if (value === null || value === undefined) return "-";
  return `${new Intl.NumberFormat("fa-IR").format(value)} ${currency}`;
}

function formatAge(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function optionalNumber(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reservationSettingsFromPublic(
  settings: Record<string, string>,
): ReservationSettingsResponse {
  return {
    freeChildMaxAge: optionalNumber(settings["reservation.freeChildMaxAge"]),
    halfPriceChildMinAge: optionalNumber(
      settings["reservation.halfPriceChildMinAge"],
    ),
    halfPriceChildMaxAge: optionalNumber(
      settings["reservation.halfPriceChildMaxAge"],
    ),
    halfPriceChildRate:
      optionalNumber(settings["reservation.halfPriceChildRate"]) ?? 50,
  };
}

function buildChildHelper(
  property: PropertyResponse | undefined,
  globalSettings: ReservationSettingsResponse | null,
) {
  if (
    property?.freeChildAgeLimit !== null &&
    property?.freeChildAgeLimit !== undefined
  ) {
    return `کودک: تا ${formatAge(property.freeChildAgeLimit)} سال طبق قوانین اختصاصی اقامتگاه بررسی می‌شود.`;
  }

  if (
    globalSettings?.freeChildMaxAge !== null &&
    globalSettings?.freeChildMaxAge !== undefined
  ) {
    return `کودک: تا ${formatAge(globalSettings.freeChildMaxAge)} سال طبق پیش‌فرض سایت بررسی می‌شود.`;
  }

  return "قوانین سنی کودک برای این اقامتگاه ثبت نشده است.";
}

function buildChildRuleSummary(
  property: PropertyResponse | undefined,
  globalSettings: ReservationSettingsResponse | null,
  roomType: RoomTypeResponse | undefined,
  roomCount: number,
): ChildRuleSummary {
  const usesPropertyRule =
    property?.freeChildAgeLimit !== null &&
    property?.freeChildAgeLimit !== undefined;
  const freeChildMaxAge = usesPropertyRule
    ? property.freeChildAgeLimit
    : globalSettings?.freeChildMaxAge;
  const halfPriceMinAge = globalSettings?.halfPriceChildMinAge;
  const halfPriceMaxAge = globalSettings?.halfPriceChildMaxAge;
  const childCapacity = roomType ? roomType.maxChildren * roomCount : null;
  const childPriceSource =
    property?.childPrice !== null && property?.childPrice !== undefined
      ? "نرخ کودک اقامتگاه"
      : "درصد پیش‌فرض سایت";

  return {
    source: usesPropertyRule ? "تنظیمات اقامتگاه" : "پیش‌فرض سایت",
    freeChildText:
      freeChildMaxAge !== null && freeChildMaxAge !== undefined
        ? `کودک تا ${formatAge(freeChildMaxAge)} سال رایگان است.`
        : "سن کودک رایگان ثبت نشده است.",
    childPricingText:
      halfPriceMinAge !== null &&
      halfPriceMinAge !== undefined &&
      halfPriceMaxAge !== null &&
      halfPriceMaxAge !== undefined
        ? `از ${formatAge(halfPriceMinAge)} تا ${formatAge(halfPriceMaxAge)} سال با ${childPriceSource} محاسبه می‌شود (${formatPercent(globalSettings?.halfPriceChildRate ?? 50)}٪).`
        : "بازه کودک نیم‌بها در پیش‌فرض سایت کامل نیست.",
    adultText:
      halfPriceMaxAge !== null && halfPriceMaxAge !== undefined
        ? `سن بالاتر از ${formatAge(halfPriceMaxAge)} سال به ظرفیت بزرگسال اضافه می‌شود.`
        : "سن‌های خارج از بازه کودک به ظرفیت بزرگسال اضافه می‌شوند.",
    roomText:
      childCapacity !== null
        ? `ظرفیت کودک اتاق انتخاب‌شده: ${formatAge(childCapacity)}`
        : "پس از انتخاب اتاق، ظرفیت کودک نمایش داده می‌شود.",
  };
}

function guestName(guest: GuestResponse) {
  return (
    guest.fullName ||
    `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() ||
    "-"
  );
}

function roomOptionDescription(
  room: AvailableRoomResponse,
) {
  return room.bookingMode === "OnRequest" ? "نیازمند تایید" : "رزرو فوری";
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
  mode = "create",
  onCreated,
  onOpenChange,
  open: controlledOpen,
  reservation,
}: ManualReservationDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReservationDraft>({
    ...initialDraft,
    propertyId: fixedPropertyId?.toString() ?? "",
  });
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [rooms, setRooms] = useState<AvailableRoomResponse[]>([]);
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [guestDraft, setGuestDraft] = useState<GuestDraft>(emptyGuestDraft);
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);
  const [pricePreview, setPricePreview] =
    useState<ReservationPricePreviewResponse | null>(null);
  const [pricePreviewLoading, setPricePreviewLoading] = useState(false);
  const [reservationSettings, setReservationSettings] =
    useState<ReservationSettingsResponse | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [savingGuest, setSavingGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pricePreviewRequestId = useRef(0);
  const isEditMode = mode === "edit";
  const dialogOpen = isEditMode ? Boolean(controlledOpen) : open;
  const isLockedEdit =
    isEditMode &&
    reservation?.status !== undefined &&
    ["Confirmed", "Paid", "Completed"].includes(reservation.status);

  function setDialogOpen(nextOpen: boolean) {
    if (isEditMode) {
      onOpenChange?.(nextOpen);
      return;
    }

    setOpen(nextOpen);
  }

  const selectedPropertyId = Number(draft.propertyId);
  const selectedProperty = properties.find(
    (property) => property.id === selectedPropertyId,
  );
  const selectedGuest = guests.find(
    (guest) => guest.id.toString() === draft.guestId,
  );
  const selectedRoomNames = draft.roomIds
    .map((id) => rooms.find((room) => room.id.toString() === id)?.name)
    .filter(Boolean);
  const confirmationRoomNames =
    selectedRoomNames.length > 0
      ? selectedRoomNames
      : reservation?.roomName
        ? [reservation.roomName]
        : [];
  const selectedRoomType = roomTypes.find(
    (roomType) => roomType.id.toString() === draft.roomTypeId,
  );
  const nightsCount = daysBetween(draft.checkInDate, draft.checkOutDate);
  const selectedRoomCount = draft.roomIds.length;
  const selectedRoomBaseAdults = selectedRoomType
    ? selectedRoomType.maxAdults * selectedRoomCount
    : 1;
  const selectedRoomMaxAdults = selectedRoomType?.allowExtraGuest
    ? selectedRoomBaseAdults +
      selectedRoomType.maxExtraGuests * selectedRoomCount
    : selectedRoomBaseAdults;
  const selectedRoomIdsKey = draft.roomIds.join(",");
  const childAgesKey = draft.childAges.join(",");
  const hasValidDateRange = nightsCount > 0;
  const hasOnRequest = draft.roomIds.some(
    (id) =>
      rooms.find((room) => room.id.toString() === id)?.bookingMode ===
      "OnRequest",
  );
  const childRuleSummary = buildChildRuleSummary(
    selectedProperty,
    reservationSettings,
    selectedRoomType,
    selectedRoomCount,
  );
  const confirmationTotal =
    pricePreview?.finalAmount ??
    reservation?.totalPrice ??
    reservation?.finalAmount ??
    null;
  const confirmationCurrency =
    pricePreview?.currency ?? reservation?.currency ?? "IRR";
  const propertyOptions = useMemo(
    () =>
      properties.map((property) => ({
        value: property.id,
        label: property.name,
        searchText: property.name,
      })),
    [properties],
  );
  const roomOptions = useMemo(
    () =>
      rooms
        .filter(
          (room) =>
            !draft.roomTypeId ||
            room.roomTypeId.toString() === draft.roomTypeId,
        )
        .map((room) => ({
          value: room.id,
          label: room.name,
          description: roomOptionDescription(room),
          searchText: room.name,
        })),
    [draft.roomTypeId, rooms],
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

  function updateChildren(value: string) {
    const childrenCount = toNonNegativeInt(value);
    setDraft((current) => ({
      ...current,
      children: value,
      childAges: normalizeChildAges(current.childAges, childrenCount),
    }));
  }

  function updateChildAge(index: number, value: string) {
    setDraft((current) => {
      const childAges = normalizeChildAges(
        current.childAges,
        toNonNegativeInt(current.children),
      );
      childAges[index] = value;

      return {
        ...current,
        childAges,
      };
    });
  }

  function updateSelectedRooms(value: string[]) {
    const selectedRooms = value
      .map((id) => rooms.find((room) => room.id.toString() === id))
      .filter((room): room is AvailableRoomResponse => Boolean(room));
    const roomTypeId = selectedRooms[0]?.roomTypeId?.toString() ?? "";
    const roomIds = roomTypeId
      ? selectedRooms
          .filter((room) => room.roomTypeId.toString() === roomTypeId)
          .map((room) => room.id.toString())
      : [];
    const roomType = roomTypes.find(
      (item) => item.id.toString() === roomTypeId,
    );
    const adults = roomType
      ? Math.max(1, roomType.maxAdults * roomIds.length).toString()
      : initialDraft.adults;

    setDraft((current) => ({
      ...current,
      roomTypeId,
      roomIds,
      adults,
    }));
  }

  function updateGuestDraft(field: keyof GuestDraft, value: string) {
    setGuestDraft((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    if (!dialogOpen) return;

    setDraft(
      reservationDraft(isEditMode ? reservation : null, fixedPropertyId),
    );
    setGuestDraft(emptyGuestDraft);
    setGuestDialogOpen(false);
    setConfirmCreateOpen(false);
    setPricePreview(null);
    setPricePreviewLoading(false);

    if (context === "admin") {
      apiRequest<PropertyResponse[]>("/admin/properties")
        .then(setProperties)
        .catch(() => setProperties([]));
      apiRequest<ReservationSettingsResponse>("/admin/reservation-settings")
        .then(setReservationSettings)
        .catch(() => setReservationSettings(null));
    } else if (fixedPropertyId) {
      apiRequest<PropertyResponse>(`/owner/properties/${fixedPropertyId}`)
        .then((property) => setProperties([property]))
        .catch(() => setProperties([]));
      apiRequest<Record<string, string>>("/site-settings/public")
        .then((settings) =>
          setReservationSettings(reservationSettingsFromPublic(settings)),
        )
        .catch(() => setReservationSettings(null));
    }
  }, [context, dialogOpen, fixedPropertyId, isEditMode, reservation]);

  useEffect(() => {
    if (!dialogOpen || !selectedPropertyId) {
      setRoomTypes([]);
      setRooms([]);
      return;
    }

    setLoadingMeta(true);
    apiRequest<RoomTypeResponse[]>(
      `/owner/properties/${selectedPropertyId}/room-types`,
    )
      .then(async (items) => {
        const activeRoomTypes = items.filter((roomType) => roomType.isActive);
        setRoomTypes(activeRoomTypes);
        setRooms([]);
      })
      .catch(() => {
        setRoomTypes([]);
        setRooms([]);
      })
      .finally(() => setLoadingMeta(false));
  }, [dialogOpen, selectedPropertyId]);

  useEffect(() => {
    if (
      !dialogOpen ||
      !selectedPropertyId ||
      !hasValidDateRange ||
      context !== "admin"
    ) {
      setRooms([]);
      setLoadingRooms(false);
      setDraft((current) =>
        current.roomIds.length > 0 || current.roomTypeId
          ? {
              ...current,
              roomTypeId: "",
              roomIds: [],
              adults: initialDraft.adults,
            }
          : current,
      );
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      propertyId: selectedPropertyId.toString(),
      checkInDate: draft.checkInDate,
      checkOutDate: draft.checkOutDate,
    });

    setRooms([]);
    setPricePreview(null);
    setPricePreviewLoading(false);
    pricePreviewRequestId.current += 1;
    setDraft((current) => ({
      ...current,
      roomTypeId: "",
      roomIds: [],
      adults: initialDraft.adults,
    }));
    setLoadingRooms(true);
    apiRequest<AvailableRoomResponse[]>(
      `/admin/reservations/available-rooms?${params.toString()}`,
    )
      .then((items) => {
        if (!cancelled) {
          setRooms(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRooms([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRooms(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    draft.checkInDate,
    draft.checkOutDate,
    hasValidDateRange,
    context,
    dialogOpen,
    selectedPropertyId,
  ]);

  useEffect(() => {
    if (!dialogOpen || !guestBasePath || draft.guestSearch.trim().length < 2) {
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
  }, [dialogOpen, draft.guestSearch, guestBasePath]);

  useEffect(() => {
    const requestId = pricePreviewRequestId.current + 1;
    pricePreviewRequestId.current = requestId;

    if (
      !dialogOpen ||
      context !== "admin" ||
      isLockedEdit ||
      !selectedPropertyId ||
      !draft.roomTypeId ||
      !hasValidDateRange ||
      selectedRoomCount <= 0 ||
      normalizeChildAges(
        draft.childAges,
        toNonNegativeInt(draft.children),
      ).some((age) => age.trim() === "")
    ) {
      setPricePreview(null);
      setPricePreviewLoading(false);
      return;
    }

    setPricePreview(null);
    setPricePreviewLoading(true);

    apiRequest<ReservationPricePreviewResponse>(
      "/admin/reservations/price-preview",
      {
        method: "POST",
        body: JSON.stringify({
          propertyId: selectedPropertyId,
          roomTypeId: Number(draft.roomTypeId),
          checkInDate: draft.checkInDate,
          checkOutDate: draft.checkOutDate,
          adults: toPositiveInt(draft.adults, 1),
          children: toNonNegativeInt(draft.children),
          childAges: childAgesPayload(
            draft.childAges,
            toNonNegativeInt(draft.children),
          ),
          roomCount: selectedRoomCount,
          guestType: draft.guestType,
        }),
      },
    )
      .then((preview) => {
        if (pricePreviewRequestId.current === requestId) {
          setPricePreview(preview);
        }
      })
      .catch(() => {
        if (pricePreviewRequestId.current === requestId) {
          setPricePreview(null);
        }
      })
      .finally(() => {
        if (pricePreviewRequestId.current === requestId) {
          setPricePreviewLoading(false);
        }
      });
  }, [
    context,
    dialogOpen,
    draft.adults,
    childAgesKey,
    draft.checkInDate,
    draft.checkOutDate,
    draft.children,
    draft.guestType,
    draft.roomTypeId,
    hasValidDateRange,
    isLockedEdit,
    selectedPropertyId,
    selectedRoomCount,
    selectedRoomIdsKey,
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

  function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLockedEdit) {
      setConfirmCreateOpen(true);
      return;
    }

    if (!selectedPropertyId || !draft.guestId) {
      toast.error("اقامتگاه و مهمان را انتخاب کنید.");
      return;
    }

    if (draft.roomIds.length === 0 || !draft.roomTypeId) {
      toast.error("حداقل یک اتاق را انتخاب کنید.");
      return;
    }

    if (nightsCount <= 0) {
      toast.error("تاریخ خروج باید بعد از تاریخ ورود باشد.");
      return;
    }

    if (
      normalizeChildAges(
        draft.childAges,
        toNonNegativeInt(draft.children),
      ).some((age) => age.trim() === "")
    ) {
      toast.error("سن همه کودکان را وارد کنید.");
      return;
    }

    if (pricePreviewLoading) {
      toast.error("لطفا تا پایان محاسبه قیمت صبر کنید.");
      return;
    }

    if (!pricePreview) {
      toast.error("پیش‌نمایش قیمت آماده نیست.");
      return;
    }

    setConfirmCreateOpen(true);
  }

  async function createReservation() {
    setSubmitting(true);
    try {
      const reservationId = reservation?.reservationId ?? reservation?.id;
      const endpoint = isEditMode
        ? `/admin/reservations/${reservationId}`
        : context === "admin"
          ? "/admin/reservations"
          : `/owner/properties/${fixedPropertyId}/reservations`;

      if (isEditMode && !reservationId) {
        throw new Error("Reservation id is missing.");
      }

      await apiRequest(endpoint, {
        method: isEditMode ? "PUT" : "POST",
        body: JSON.stringify({
          propertyId: selectedPropertyId,
          roomTypeId: Number(draft.roomTypeId),
          guestId: Number(draft.guestId),
          checkInDate: draft.checkInDate,
          checkOutDate: draft.checkOutDate,
          adults: toPositiveInt(draft.adults, 1),
          children: toNonNegativeInt(draft.children),
          childAges: childAgesPayload(
            draft.childAges,
            toNonNegativeInt(draft.children),
          ),
          roomCount: draft.roomIds.length,
          roomIds: draft.roomIds.map((id) => Number(id)),
          guestType: draft.guestType,
          status: context === "admin" ? draft.status : undefined,
          notes: draft.notes.trim() || null,
        }),
      });

      toast.success(isEditMode ? "رزرو به‌روز شد." : "رزرو اضافه شد.");
      setConfirmCreateOpen(false);
      setDialogOpen(false);
      await onCreated();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "ذخیره رزرو انجام نشد.",
      );
      throw caught;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {!isEditMode && (
        <KoochButton onClick={() => setDialogOpen(true)}>
          افزودن رزرو
        </KoochButton>
      )}
      <KoochDialog
        footer={
          <>
            <KoochButton
              disabled={submitting}
              onClick={() => setDialogOpen(false)}
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
              {isEditMode ? "ذخیره تغییرات" : "ثبت رزرو"}
            </KoochButton>
          </>
        }
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        size="lg"
        title={isEditMode ? "ویرایش رزرو" : "افزودن رزرو"}
      >
        <form
          className="grid gap-4"
          id="manual-reservation-form"
          onSubmit={submitReservation}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black">قانون اعمال‌شده کودک</p>
                <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-bold text-muted-foreground">
                  {childRuleSummary.source}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs font-semibold leading-6 text-muted-foreground md:grid-cols-2">
                <p>{childRuleSummary.freeChildText}</p>
                <p>{childRuleSummary.childPricingText}</p>
                <p>{childRuleSummary.adultText}</p>
                <p>{childRuleSummary.roomText}</p>
              </div>
            </div>

            {context === "admin" && (
              <KoochField label="اقامتگاه" required>
                <KoochSearchableSelect
                  disabled={isLockedEdit}
                  emptyText="اقامتگاهی پیدا نشد."
                  onChange={(value) => {
                    setRooms([]);
                    setPricePreview(null);
                    setPricePreviewLoading(false);
                    pricePreviewRequestId.current += 1;
                    setDraft((current) => ({
                      ...current,
                      propertyId: value,
                      roomTypeId: "",
                      roomIds: [],
                      adults: initialDraft.adults,
                    }));
                  }}
                  options={propertyOptions}
                  placeholder="انتخاب اقامتگاه"
                  searchPlaceholder="جستجوی اقامتگاه..."
                  value={draft.propertyId}
                />
              </KoochField>
            )}

            <KoochField className="md:col-span-2" label="مهمان" required>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <KoochSearchableSelect
                  disabled={isLockedEdit}
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
                {context === "admin" && !isLockedEdit && (
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
                minDate={isEditMode ? undefined : new Date().toDateString()}
                openOnDialog
                dialogContentClassName="!h-auto !max-h-[calc(100vh-2rem)] !grid-rows-[auto_minmax(0,auto)_auto]"
                dialogBodyClassName="!overflow-visible !py-4"
                dialogFooterClassName="!py-3 "
                onChange={(value) => {
                  if (isLockedEdit) return;
                  setRooms([]);
                  setPricePreview(null);
                  setPricePreviewLoading(false);
                  pricePreviewRequestId.current += 1;
                  setDraft((current) => ({
                    ...current,
                    checkInDate: value.startDate ?? "",
                    checkOutDate: value.endDate ?? "",
                    roomTypeId: "",
                    roomIds: [],
                    adults: initialDraft.adults,
                  }));
                }}
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
                disabled={
                  isLockedEdit ||
                  !selectedPropertyId ||
                  loadingMeta ||
                  loadingRooms ||
                  nightsCount <= 0
                }
                emptyText="برای بازه انتخاب‌شده اتاقی موجود نیست."
                onChange={(value) => updateSelectedRooms(value.map(String))}
                options={roomOptions}
                placeholder={
                  (loadingMeta || loadingRooms) && hasValidDateRange
                    ? "در حال بارگذاری..."
                    : nightsCount <= 0
                      ? "ابتدا بازه اقامت را انتخاب کنید"
                      : "انتخاب اتاق‌ها"
                }
                searchPlaceholder="جستجوی اتاق..."
                value={draft.roomIds}
              />
            </KoochField>

            <KoochField
              helperText={
                selectedRoomType?.allowExtraGuest
                  ? `ظرفیت پایه: ${new Intl.NumberFormat("fa-IR").format(selectedRoomBaseAdults)}`
                  : selectedRoomType
                    ? "This room does not accept extra guests."
                    : "ابتدا اتاق را انتخاب کنید."
              }
              label="بزرگسال"
            >
              <KoochInput
                disabled={isLockedEdit || !selectedRoomType?.allowExtraGuest}
                max={selectedRoomMaxAdults}
                min={selectedRoomBaseAdults}
                onChange={(event) => {
                  const nextAdults = Math.max(
                    selectedRoomBaseAdults,
                    Math.min(
                      toPositiveInt(event.target.value, selectedRoomBaseAdults),
                      selectedRoomMaxAdults,
                    ),
                  );
                  updateDraft("adults", nextAdults.toString());
                }}
                type="number"
                value={draft.adults}
              />
            </KoochField>

            <KoochField
              helperText={buildChildHelper(
                selectedProperty,
                reservationSettings,
              )}
              label="کودک"
            >
              <div className="grid gap-3">
                <KoochInput
                  min={0}
                  disabled={isLockedEdit}
                  onChange={(event) => updateChildren(event.target.value)}
                  type="number"
                  value={draft.children}
                />
                {toNonNegativeInt(draft.children) > 0 && (
                  <div className="grid gap-2 rounded-lg border border-border bg-muted p-3">
                    <p className="text-xs font-bold text-muted-foreground">
                      سن کودکان
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {normalizeChildAges(
                        draft.childAges,
                        toNonNegativeInt(draft.children),
                      ).map((age, index) => (
                        <KoochInput
                          aria-label={`سن کودک ${index + 1}`}
                          key={index}
                          max={120}
                          min={0}
                          disabled={isLockedEdit}
                          onChange={(event) =>
                            updateChildAge(index, event.target.value)
                          }
                          placeholder={`کودک ${new Intl.NumberFormat("fa-IR").format(index + 1)}`}
                          type="number"
                          value={age}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </KoochField>

            <KoochField label="نوع مهمان">
              <KoochSelect
                disabled={isLockedEdit}
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

            {context === "admin" && !isEditMode && (
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
            {pricePreviewLoading ? (
              <p className="text-sm font-semibold text-muted-foreground">
                در حال محاسبه قیمت...
              </p>
            ) : pricePreview ? (
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <span>
                  تعداد شب:{" "}
                  {new Intl.NumberFormat("fa-IR").format(
                    pricePreview.nightsCount,
                  )}
                </span>
                <span>
                  تعداد اتاق:{" "}
                  {new Intl.NumberFormat("fa-IR").format(
                    pricePreview.roomCount,
                  )}
                </span>
                <span>
                  قیمت پایه:{" "}
                  {formatMoney(pricePreview.baseAmount, pricePreview.currency)}
                </span>
                <span>
                  هزینه کودک:{" "}
                  {formatMoney(pricePreview.childAmount, pricePreview.currency)}
                </span>
                <span>
                  هزینه نفر اضافه:{" "}
                  {formatMoney(
                    pricePreview.extraGuestAmount,
                    pricePreview.currency,
                  )}
                </span>
                <span>
                  تخفیف پروموشن:{" "}
                  {formatMoney(
                    pricePreview.discountAmount,
                    pricePreview.currency,
                  )}
                </span>
                <span className="font-black">
                  مبلغ کل:{" "}
                  {formatMoney(pricePreview.finalAmount, pricePreview.currency)}
                </span>
              </div>
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">
                برای محاسبه قیمت، تاریخ و اتاق را انتخاب کنید.
              </p>
            )}
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

      <KoochConfirmDialog
        cancelText="ویرایش"
        confirmText={isEditMode ? "تایید و ذخیره" : "تایید و ایجاد رزرو"}
        loading={submitting}
        onConfirm={createReservation}
        onOpenChange={setConfirmCreateOpen}
        open={confirmCreateOpen}
        title={isEditMode ? "تایید ویرایش رزرو" : "تایید ایجاد رزرو"}
        variant="question"
      >
        <div className="grid gap-2 text-right text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">مهمان</span>
            <span className="font-bold text-foreground">
              {selectedGuest
                ? guestName(selectedGuest)
                : draft.guestSearch || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">اتاق</span>
            <span className="font-bold text-foreground">
              {confirmationRoomNames.length > 0
                ? confirmationRoomNames.join("، ")
                : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">ورود</span>
            <span className="font-bold text-foreground">
              {draft.checkInDate || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">خروج</span>
            <span className="font-bold text-foreground">
              {draft.checkOutDate || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-2">
            <span className="text-muted-foreground">مبلغ کل</span>
            <span className="font-black text-foreground">
              {formatMoney(confirmationTotal, confirmationCurrency)}
            </span>
          </div>
        </div>
      </KoochConfirmDialog>

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
