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
  type AvailabilityResponse,
  type PricingGuestType,
  type PropertyResponse,
  type RoomResponse,
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
    guestSearch:
      reservation.guestName ?? reservation.guestFullName ?? "",
    checkInDate: reservation.checkInDate ?? "",
    checkOutDate: reservation.checkOutDate ?? "",
    adults: Math.max(1, reservation.adults ?? 1).toString(),
    children: Math.max(0, reservation.children ?? 0).toString(),
    childAges: normalizeChildAges([], Math.max(0, reservation.children ?? 0)),
    guestType:
      reservation.guestType === "Foreign" ? "Foreign" : "Iranian",
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
  return Array.from({ length: Math.max(0, childrenCount) }, (_, index) =>
    childAges[index] ?? "",
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
    return `Ú©ÙˆØ¯Ú©: ØªØ§ ${formatAge(property.freeChildAgeLimit)} Ø³Ø§Ù„ Ø·Ø¨Ù‚ Ù‚ÙˆØ§Ù†ÛŒÙ† Ø§Ø®ØªØµØ§ØµÛŒ Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ø¨Ø±Ø±Ø³ÛŒ Ù…ÛŒâ€ŒØ´ÙˆØ¯.`;
  }

  if (
    globalSettings?.freeChildMaxAge !== null &&
    globalSettings?.freeChildMaxAge !== undefined
  ) {
    return `Ú©ÙˆØ¯Ú©: ØªØ§ ${formatAge(globalSettings.freeChildMaxAge)} Ø³Ø§Ù„ Ø·Ø¨Ù‚ Ù¾ÛŒØ´â€ŒÙØ±Ø¶ Ø³Ø§ÛŒØª Ø¨Ø±Ø±Ø³ÛŒ Ù…ÛŒâ€ŒØ´ÙˆØ¯.`;
  }

  return "Ù‚ÙˆØ§Ù†ÛŒÙ† Ø³Ù†ÛŒ Ú©ÙˆØ¯Ú© Ø¨Ø±Ø§ÛŒ Ø§ÛŒÙ† Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.";
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
      ? "Ù†Ø±Ø® Ú©ÙˆØ¯Ú© Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡"
      : "Ø¯Ø±ØµØ¯ Ù¾ÛŒØ´â€ŒÙØ±Ø¶ Ø³Ø§ÛŒØª";

  return {
    source: usesPropertyRule ? "ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡" : "Ù¾ÛŒØ´â€ŒÙØ±Ø¶ Ø³Ø§ÛŒØª",
    freeChildText:
      freeChildMaxAge !== null && freeChildMaxAge !== undefined
        ? `Ú©ÙˆØ¯Ú© ØªØ§ ${formatAge(freeChildMaxAge)} Ø³Ø§Ù„ Ø±Ø§ÛŒÚ¯Ø§Ù† Ø§Ø³Øª.`
        : "Ø³Ù† Ú©ÙˆØ¯Ú© Ø±Ø§ÛŒÚ¯Ø§Ù† Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.",
    childPricingText:
      halfPriceMinAge !== null &&
      halfPriceMinAge !== undefined &&
      halfPriceMaxAge !== null &&
      halfPriceMaxAge !== undefined
        ? `Ø§Ø² ${formatAge(halfPriceMinAge)} ØªØ§ ${formatAge(halfPriceMaxAge)} Ø³Ø§Ù„ Ø¨Ø§ ${childPriceSource} Ù…Ø­Ø§Ø³Ø¨Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯ (${formatPercent(globalSettings?.halfPriceChildRate ?? 50)}Ùª).`
        : "Ø¨Ø§Ø²Ù‡ Ú©ÙˆØ¯Ú© Ù†ÛŒÙ…â€ŒØ¨Ù‡Ø§ Ø¯Ø± Ù¾ÛŒØ´â€ŒÙØ±Ø¶ Ø³Ø§ÛŒØª Ú©Ø§Ù…Ù„ Ù†ÛŒØ³Øª.",
    adultText:
      halfPriceMaxAge !== null && halfPriceMaxAge !== undefined
        ? `Ø³Ù† Ø¨Ø§Ù„Ø§ØªØ± Ø§Ø² ${formatAge(halfPriceMaxAge)} Ø³Ø§Ù„ Ø¨Ù‡ Ø¸Ø±ÙÛŒØª Ø¨Ø²Ø±Ú¯Ø³Ø§Ù„ Ø§Ø¶Ø§ÙÙ‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.`
        : "Ø³Ù†â€ŒÙ‡Ø§ÛŒ Ø®Ø§Ø±Ø¬ Ø§Ø² Ø¨Ø§Ø²Ù‡ Ú©ÙˆØ¯Ú© Ø¨Ù‡ Ø¸Ø±ÙÛŒØª Ø¨Ø²Ø±Ú¯Ø³Ø§Ù„ Ø§Ø¶Ø§ÙÙ‡ Ù…ÛŒâ€ŒØ´ÙˆÙ†Ø¯.",
    roomText:
      childCapacity !== null
        ? `Ø¸Ø±ÙÛŒØª Ú©ÙˆØ¯Ú© Ø§ØªØ§Ù‚ Ø§Ù†ØªØ®Ø§Ø¨â€ŒØ´Ø¯Ù‡: ${formatAge(childCapacity)}`
        : "Ù¾Ø³ Ø§Ø² Ø§Ù†ØªØ®Ø§Ø¨ Ø§ØªØ§Ù‚ØŒ Ø¸Ø±ÙÛŒØª Ú©ÙˆØ¯Ú© Ù†Ù…Ø§ÛŒØ´ Ø¯Ø§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.",
  };
}

function guestName(guest: GuestResponse) {
  return (
    guest.fullName ||
    `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() ||
    "-"
  );
}

function roomOptionDescription(room: RoomResponse, onRequestRoomTypeIds: number[]) {
  const details = room.floorNumber
    ? `Ã˜Â·Ã˜Â¨Ã™â€šÃ™â€¡ ${new Intl.NumberFormat("fa-IR").format(room.floorNumber)}`
    : room.englishName;

  return [
    onRequestRoomTypeIds.includes(room.roomTypeId) ? "Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ ØªØ§ÛŒÛŒØ¯" : null,
    details,
  ]
    .filter(Boolean)
    .join(" Â· ");
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
  const [rooms, setRooms] = useState<RoomResponse[]>([]);
  const [onRequestRoomTypeIds, setOnRequestRoomTypeIds] = useState<number[]>([]);
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [availability, setAvailability] = useState<AvailabilityResponse[]>([]);
  const [guestDraft, setGuestDraft] = useState<GuestDraft>(emptyGuestDraft);
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);
  const [pricePreview, setPricePreview] =
    useState<ReservationPricePreviewResponse | null>(null);
  const [pricePreviewLoading, setPricePreviewLoading] = useState(false);
  const [reservationSettings, setReservationSettings] =
    useState<ReservationSettingsResponse | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
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
    ? selectedRoomBaseAdults + selectedRoomType.maxExtraGuests * selectedRoomCount
    : selectedRoomBaseAdults;
  const selectedRoomIdsKey = draft.roomIds.join(",");
  const childAgesKey = draft.childAges.join(",");
  const hasValidDateRange = nightsCount > 0;
  const hasOnRequest = availability.some((day) => day.status === "OnRequest");
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
        .filter((room) => room.isActive)
        .filter(
          (room) =>
            !draft.roomTypeId ||
            room.roomTypeId.toString() === draft.roomTypeId,
        )
        .map((room) => ({
          value: room.id,
          label: room.name,
          description: roomOptionDescription(room, onRequestRoomTypeIds),
          searchText: [
            room.name,
            room.englishName,
            room.description,
            room.notes,
          ]
            .filter(Boolean)
            .join(" "),
        })),
    [draft.roomTypeId, onRequestRoomTypeIds, rooms],
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
    { value: "Pending", label: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø±" },
    { value: "PendingApproval", label: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± ØªØ§ÛŒÛŒØ¯" },
    { value: "ApprovedAwaitingPayment", label: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± Ù¾Ø±Ø¯Ø§Ø®Øª" },
    { value: "Confirmed", label: "ØªØ§ÛŒÛŒØ¯ Ø´Ø¯Ù‡" },
    { value: "Paid", label: "Ù¾Ø±Ø¯Ø§Ø®Øª Ø´Ø¯Ù‡" },
    { value: "Cancelled", label: "Ù„ØºÙˆ Ø´Ø¯Ù‡" },
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
      .filter((room): room is RoomResponse => Boolean(room));
    const roomTypeId = selectedRooms[0]?.roomTypeId?.toString() ?? "";
    const roomIds = roomTypeId
      ? selectedRooms
          .filter((room) => room.roomTypeId.toString() === roomTypeId)
          .map((room) => room.id.toString())
      : [];
    const roomType = roomTypes.find((item) => item.id.toString() === roomTypeId);
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

    setDraft(reservationDraft(isEditMode ? reservation : null, fixedPropertyId));
    setGuestDraft(emptyGuestDraft);
    setGuestDialogOpen(false);
    setConfirmCreateOpen(false);
    setAvailability([]);
    setPricePreview(null);
    setPricePreviewLoading(false);
    setOnRequestRoomTypeIds([]);

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
      setOnRequestRoomTypeIds([]);
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
        setOnRequestRoomTypeIds([]);
      })
      .catch(() => {
        setRoomTypes([]);
        setRooms([]);
        setOnRequestRoomTypeIds([]);
      })
      .finally(() => setLoadingMeta(false));
  }, [dialogOpen, selectedPropertyId]);

  useEffect(() => {
    if (
      !dialogOpen ||
      !selectedPropertyId ||
      !hasValidDateRange ||
      roomTypes.length === 0
    ) {
      setRooms([]);
      setOnRequestRoomTypeIds([]);
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
      from: draft.checkInDate,
      to: previousDate(draft.checkOutDate),
    });

    setLoadingMeta(true);
    Promise.all(
      roomTypes.map(async (roomType) => {
        const days = await apiRequest<AvailabilityResponse[]>(
          `/owner/room-types/${roomType.id}/availability?${params.toString()}`,
        ).catch(() => []);
        const hasCompleteRange = days.length === nightsCount;
        const rangeCounts = days.map((day) => {
          if (day.status === "OnRequest") return roomType.totalInventory;
          if (day.status === "Available" && day.availableCount > 0) {
            return day.availableCount;
          }

          return 0;
        });
        const availableRoomCount =
          roomType.totalInventory > 0 && hasCompleteRange
            ? Math.min(roomType.totalInventory, ...rangeCounts)
            : 0;
        const hasOnRequestNight = days.some(
          (day) => day.status === "OnRequest",
        );

        if (availableRoomCount <= 0) {
          return { rooms: [], onRequestRoomTypeId: null };
        }

        return apiRequest<RoomResponse[]>(
          `/owner/room-types/${roomType.id}/rooms`,
        )
          .then((items) => {
            const activeRooms = items.filter((room) => room.isActive);
            return {
              rooms: activeRooms.slice(0, availableRoomCount),
              onRequestRoomTypeId: hasOnRequestNight ? roomType.id : null,
            };
          })
          .catch(() => ({ rooms: [], onRequestRoomTypeId: null }));
      }),
    )
      .then((roomGroups) => {
        if (!cancelled) {
          setRooms(roomGroups.flatMap((group) => group.rooms));
          setOnRequestRoomTypeIds(
            roomGroups
              .map((group) => group.onRequestRoomTypeId)
              .filter((id): id is number => id !== null),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRooms([]);
          setOnRequestRoomTypeIds([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    draft.checkInDate,
    draft.checkOutDate,
    hasValidDateRange,
    nightsCount,
    dialogOpen,
    roomTypes,
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
    if (!dialogOpen || !draft.roomTypeId || nightsCount <= 0) {
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
    dialogOpen,
    nightsCount,
  ]);

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
      toast.error("Ù†Ø§Ù… ÛŒØ§ Ù†Ø§Ù… Ø®Ø§Ù†ÙˆØ§Ø¯Ú¯ÛŒ Ù…Ù‡Ù…Ø§Ù† Ø±Ø§ ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯.");
      return;
    }

    if (!guestDraft.mobile.trim() && !guestDraft.email.trim()) {
      toast.error("Ø´Ù…Ø§Ø±Ù‡ Ù…ÙˆØ¨Ø§ÛŒÙ„ ÛŒØ§ Ø§ÛŒÙ…ÛŒÙ„ Ù…Ù‡Ù…Ø§Ù† Ø±Ø§ ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯.");
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
      toast.success("Ù…Ù‡Ù…Ø§Ù† Ø§Ø¶Ø§ÙÙ‡ Ø´Ø¯.");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Ù…Ù‡Ù…Ø§Ù† Ø§Ø¶Ø§ÙÙ‡ Ù†Ø´Ø¯.",
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
      toast.error("Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ùˆ Ù…Ù‡Ù…Ø§Ù† Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯.");
      return;
    }

    if (draft.roomIds.length === 0 || !draft.roomTypeId) {
      toast.error("Ø­Ø¯Ø§Ù‚Ù„ ÛŒÚ© Ø§ØªØ§Ù‚ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯.");
      return;
    }

    if (nightsCount <= 0) {
      toast.error("ØªØ§Ø±ÛŒØ® Ø®Ø±ÙˆØ¬ Ø¨Ø§ÛŒØ¯ Ø¨Ø¹Ø¯ Ø§Ø² ØªØ§Ø±ÛŒØ® ÙˆØ±ÙˆØ¯ Ø¨Ø§Ø´Ø¯.");
      return;
    }

    if (
      normalizeChildAges(draft.childAges, toNonNegativeInt(draft.children)).some(
        (age) => age.trim() === "",
      )
    ) {
      toast.error("Ø³Ù† Ù‡Ù…Ù‡ Ú©ÙˆØ¯Ú©Ø§Ù† Ø±Ø§ ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯.");
      return;
    }

    if (pricePreviewLoading) {
      toast.error("Ù„Ø·ÙØ§ ØªØ§ Ù¾Ø§ÛŒØ§Ù† Ù…Ø­Ø§Ø³Ø¨Ù‡ Ù‚ÛŒÙ…Øª ØµØ¨Ø± Ú©Ù†ÛŒØ¯.");
      return;
    }

    if (!pricePreview) {
      toast.error("Ù¾ÛŒØ´â€ŒÙ†Ù…Ø§ÛŒØ´ Ù‚ÛŒÙ…Øª Ø¢Ù…Ø§Ø¯Ù‡ Ù†ÛŒØ³Øª.");
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

      toast.success(isEditMode ? "Ø±Ø²Ø±Ùˆ Ø¨Ù‡â€ŒØ±ÙˆØ² Ø´Ø¯." : "Ø±Ø²Ø±Ùˆ Ø§Ø¶Ø§ÙÙ‡ Ø´Ø¯.");
      setConfirmCreateOpen(false);
      setDialogOpen(false);
      await onCreated();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Ø°Ø®ÛŒØ±Ù‡ Ø±Ø²Ø±Ùˆ Ø§Ù†Ø¬Ø§Ù… Ù†Ø´Ø¯.");
      throw caught;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {!isEditMode && (
        <KoochButton onClick={() => setDialogOpen(true)}>
          Ø§ÙØ²ÙˆØ¯Ù† Ø±Ø²Ø±Ùˆ
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
              Ø§Ù†ØµØ±Ø§Ù
            </KoochButton>
            <KoochButton
              form="manual-reservation-form"
              loading={submitting}
              type="submit"
            >
              {isEditMode ? "Ø°Ø®ÛŒØ±Ù‡ ØªØºÛŒÛŒØ±Ø§Øª" : "Ø«Ø¨Øª Ø±Ø²Ø±Ùˆ"}
            </KoochButton>
          </>
        }
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        size="lg"
        title={isEditMode ? "ÙˆÛŒØ±Ø§ÛŒØ´ Ø±Ø²Ø±Ùˆ" : "Ø§ÙØ²ÙˆØ¯Ù† Ø±Ø²Ø±Ùˆ"}
      >
        <form
          className="grid gap-4"
          id="manual-reservation-form"
          onSubmit={submitReservation}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black">Ù‚Ø§Ù†ÙˆÙ† Ø§Ø¹Ù…Ø§Ù„â€ŒØ´Ø¯Ù‡ Ú©ÙˆØ¯Ú©</p>
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
              <KoochField label="Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡" required>
                <KoochSearchableSelect
                  disabled={isLockedEdit}
                  emptyText="Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ÛŒ Ù¾ÛŒØ¯Ø§ Ù†Ø´Ø¯."
                  onChange={(value) => {
                    setAvailability([]);
                    setOnRequestRoomTypeIds([]);
                    setDraft((current) => ({
                      ...current,
                      propertyId: value,
                      roomTypeId: "",
                      roomIds: [],
                      adults: initialDraft.adults,
                    }));
                  }}
                  options={propertyOptions}
                  placeholder="Ø§Ù†ØªØ®Ø§Ø¨ Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡"
                  searchPlaceholder="Ø¬Ø³ØªØ¬ÙˆÛŒ Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡..."
                  value={draft.propertyId}
                />
              </KoochField>
            )}

            <KoochField className="md:col-span-2" label="Ù…Ù‡Ù…Ø§Ù†" required>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <KoochSearchableSelect
                  disabled={isLockedEdit}
                  emptyText={
                    draft.guestSearch.trim().length < 2
                      ? "Ø¨Ø±Ø§ÛŒ Ø¬Ø³ØªØ¬ÙˆÛŒ Ù…Ù‡Ù…Ø§Ù† Ø­Ø¯Ø§Ù‚Ù„ Ø¯Ùˆ Ø­Ø±Ù ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯."
                      : "Ù…Ù‡Ù…Ø§Ù†ÛŒ Ù¾ÛŒØ¯Ø§ Ù†Ø´Ø¯."
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
                  placeholder="Ø§Ù†ØªØ®Ø§Ø¨ Ù…Ù‡Ù…Ø§Ù†"
                  searchPlaceholder="Ù†Ø§Ù…ØŒ Ù…ÙˆØ¨Ø§ÛŒÙ„ ÛŒØ§ Ø§ÛŒÙ…ÛŒÙ„"
                  value={draft.guestId}
                />
                {context === "admin" && !isLockedEdit && (
                  <KoochButton
                    onClick={() => setGuestDialogOpen(true)}
                    type="button"
                    variant="outline"
                  >
                    Ø§ÙØ²ÙˆØ¯Ù† Ù…Ù‡Ù…Ø§Ù†
                  </KoochButton>
                )}
              </div>
            </KoochField>

            <KoochField className="md:col-span-2" label="Ø¨Ø§Ø²Ù‡ Ø§Ù‚Ø§Ù…Øª" required>
              <KoochDatePicker
                labels={{ start: "ÙˆØ±ÙˆØ¯", end: "Ø®Ø±ÙˆØ¬" }}
                mode="range"
                minDate={isEditMode ? undefined : new Date().toDateString()}
                openOnDialog
                dialogContentClassName="!h-auto !max-h-[calc(100vh-2rem)] !grid-rows-[auto_minmax(0,auto)_auto]"
                dialogBodyClassName="!overflow-visible !py-4"
                dialogFooterClassName="!py-3 "
                onChange={(value) => {
                  if (isLockedEdit) return;
                  setAvailability([]);
                  setOnRequestRoomTypeIds([]);
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
                  ØªØ¹Ø¯Ø§Ø¯ Ø´Ø¨: {new Intl.NumberFormat("fa-IR").format(nightsCount)}
                </p>
              )}
            </KoochField>

            <KoochField className="md:col-span-2" label="Ø§ØªØ§Ù‚â€ŒÙ‡Ø§" required>
              <KoochMultiSelect
                disabled={
                  isLockedEdit ||
                  !selectedPropertyId || loadingMeta || nightsCount <= 0
                }
                emptyText="Ø§ØªØ§Ù‚ ÙØ¹Ø§Ù„ÛŒ Ø¨Ø±Ø§ÛŒ Ø§ÛŒÙ† Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ù¾ÛŒØ¯Ø§ Ù†Ø´Ø¯."
                onChange={(value) => updateSelectedRooms(value.map(String))}
                options={roomOptions}
                placeholder={
                  loadingMeta && hasValidDateRange
                    ? "Ø¯Ø± Ø­Ø§Ù„ Ø¨Ø§Ø±Ú¯Ø°Ø§Ø±ÛŒ..."
                    : nightsCount <= 0
                      ? "Ø§Ø¨ØªØ¯Ø§ Ø¨Ø§Ø²Ù‡ Ø§Ù‚Ø§Ù…Øª Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯"
                      : "Ø§Ù†ØªØ®Ø§Ø¨ Ø§ØªØ§Ù‚â€ŒÙ‡Ø§"
                }
                searchPlaceholder="Ø¬Ø³ØªØ¬ÙˆÛŒ Ø§ØªØ§Ù‚..."
                value={draft.roomIds}
              />
            </KoochField>

            <KoochField
              helperText={
                selectedRoomType?.allowExtraGuest
                  ? `Ø¸Ø±ÙÛŒØª Ù¾Ø§ÛŒÙ‡: ${new Intl.NumberFormat("fa-IR").format(selectedRoomBaseAdults)}`
                  : selectedRoomType
                    ? "This room does not accept extra guests."
                    : "Ø§Ø¨ØªØ¯Ø§ Ø§ØªØ§Ù‚ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯."
              }
              label="Ø¨Ø²Ø±Ú¯Ø³Ø§Ù„"
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
              helperText={buildChildHelper(selectedProperty, reservationSettings)}
              label="Ú©ÙˆØ¯Ú©"
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
                      Ø³Ù† Ú©ÙˆØ¯Ú©Ø§Ù†
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {normalizeChildAges(
                        draft.childAges,
                        toNonNegativeInt(draft.children),
                      ).map((age, index) => (
                        <KoochInput
                          aria-label={`Ø³Ù† Ú©ÙˆØ¯Ú© ${index + 1}`}
                          key={index}
                          max={120}
                          min={0}
                          disabled={isLockedEdit}
                          onChange={(event) =>
                            updateChildAge(index, event.target.value)
                          }
                          placeholder={`Ú©ÙˆØ¯Ú© ${new Intl.NumberFormat("fa-IR").format(index + 1)}`}
                          type="number"
                          value={age}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </KoochField>

            <KoochField label="Ù†ÙˆØ¹ Ù…Ù‡Ù…Ø§Ù†">
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
                <option value="Iranian">Ø§ÛŒØ±Ø§Ù†ÛŒ</option>
                <option value="Foreign">Ø®Ø§Ø±Ø¬ÛŒ</option>
              </KoochSelect>
            </KoochField>

            {context === "admin" && !isEditMode && (
              <KoochField label="ÙˆØ¶Ø¹ÛŒØª Ø±Ø²Ø±Ùˆ">
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
            <KoochAlert title="Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ ØªØ§ÛŒÛŒØ¯" variant="warning">
              Ø§ÛŒÙ† Ø±Ø²Ø±Ùˆ Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ ØªØ§ÛŒÛŒØ¯ Ø§Ø³Øª Ùˆ ÙØ¹Ù„Ø§Ù‹ Ù¾Ø±Ø¯Ø§Ø®Øª ÛŒØ§ Ú©Ø§Ù‡Ø´ Ù…ÙˆØ¬ÙˆØ¯ÛŒ Ø§Ù†Ø¬Ø§Ù…
              Ù†Ù…ÛŒâ€ŒØ´ÙˆØ¯.
            </KoochAlert>
          )}

          <KoochCard className="grid gap-3" padding="sm" variant="elevated">
            <h3 className="text-sm font-black text-foreground">Ø®Ù„Ø§ØµÙ‡ Ù‚ÛŒÙ…Øª</h3>
            {pricePreviewLoading ? (
              <p className="text-sm font-semibold text-muted-foreground">
                Ø¯Ø± Ø­Ø§Ù„ Ù…Ø­Ø§Ø³Ø¨Ù‡ Ù‚ÛŒÙ…Øª...
              </p>
            ) : pricePreview ? (
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <span>
                  ØªØ¹Ø¯Ø§Ø¯ Ø´Ø¨:{" "}
                  {new Intl.NumberFormat("fa-IR").format(
                    pricePreview.nightsCount,
                  )}
                </span>
                <span>
                  ØªØ¹Ø¯Ø§Ø¯ Ø§ØªØ§Ù‚:{" "}
                  {new Intl.NumberFormat("fa-IR").format(
                    pricePreview.roomCount,
                  )}
                </span>
                <span>
                  Ù‚ÛŒÙ…Øª Ù¾Ø§ÛŒÙ‡:{" "}
                  {formatMoney(pricePreview.baseAmount, pricePreview.currency)}
                </span>
                <span>
                  Ù‡Ø²ÛŒÙ†Ù‡ Ú©ÙˆØ¯Ú©:{" "}
                  {formatMoney(pricePreview.childAmount, pricePreview.currency)}
                </span>
                <span>
                  Ù‡Ø²ÛŒÙ†Ù‡ Ù†ÙØ± Ø§Ø¶Ø§ÙÙ‡:{" "}
                  {formatMoney(
                    pricePreview.extraGuestAmount,
                    pricePreview.currency,
                  )}
                </span>
                <span>
                  ØªØ®ÙÛŒÙ Ù¾Ø±ÙˆÙ…ÙˆØ´Ù†:{" "}
                  {formatMoney(
                    pricePreview.discountAmount,
                    pricePreview.currency,
                  )}
                </span>
                <span className="font-black">
                  Ù…Ø¨Ù„Øº Ú©Ù„:{" "}
                  {formatMoney(pricePreview.finalAmount, pricePreview.currency)}
                </span>
              </div>
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">
                Ø¨Ø±Ø§ÛŒ Ù…Ø­Ø§Ø³Ø¨Ù‡ Ù‚ÛŒÙ…ØªØŒ ØªØ§Ø±ÛŒØ® Ùˆ Ø§ØªØ§Ù‚ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯.
              </p>
            )}
          </KoochCard>

          <KoochField label="ÛŒØ§Ø¯Ø¯Ø§Ø´Øª">
            <KoochTextarea
              onChange={(event) => updateDraft("notes", event.target.value)}
              rows={3}
              value={draft.notes}
            />
          </KoochField>
        </form>
      </KoochDialog>

      <KoochConfirmDialog
        cancelText="ÙˆÛŒØ±Ø§ÛŒØ´"
        confirmText={isEditMode ? "ØªØ§ÛŒÛŒØ¯ Ùˆ Ø°Ø®ÛŒØ±Ù‡" : "ØªØ§ÛŒÛŒØ¯ Ùˆ Ø§ÛŒØ¬Ø§Ø¯ Ø±Ø²Ø±Ùˆ"}
        loading={submitting}
        onConfirm={createReservation}
        onOpenChange={setConfirmCreateOpen}
        open={confirmCreateOpen}
        title={isEditMode ? "ØªØ§ÛŒÛŒØ¯ ÙˆÛŒØ±Ø§ÛŒØ´ Ø±Ø²Ø±Ùˆ" : "ØªØ§ÛŒÛŒØ¯ Ø§ÛŒØ¬Ø§Ø¯ Ø±Ø²Ø±Ùˆ"}
        variant="question"
      >
        <div className="grid gap-2 text-right text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Ù…Ù‡Ù…Ø§Ù†</span>
            <span className="font-bold text-foreground">
              {selectedGuest
                ? guestName(selectedGuest)
                : draft.guestSearch || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Ø§ØªØ§Ù‚</span>
            <span className="font-bold text-foreground">
              {confirmationRoomNames.length > 0
                ? confirmationRoomNames.join("ØŒ ")
                : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">ÙˆØ±ÙˆØ¯</span>
            <span className="font-bold text-foreground">
              {draft.checkInDate || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Ø®Ø±ÙˆØ¬</span>
            <span className="font-bold text-foreground">
              {draft.checkOutDate || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-2">
            <span className="text-muted-foreground">Ù…Ø¨Ù„Øº Ú©Ù„</span>
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
              Ø§Ù†ØµØ±Ø§Ù
            </KoochButton>
            <KoochButton loading={savingGuest} onClick={addGuest} type="button">
              Ø°Ø®ÛŒØ±Ù‡ Ù…Ù‡Ù…Ø§Ù†
            </KoochButton>
          </>
        }
        onOpenChange={setGuestDialogOpen}
        open={guestDialogOpen}
        title="Ø§ÙØ²ÙˆØ¯Ù† Ù…Ù‡Ù…Ø§Ù†"
        size="md"
      >
        <div className="grid gap-4" dir="rtl">
          <div className="grid gap-4 md:grid-cols-2">
            <KoochField label="Ù†Ø§Ù…">
              <KoochInput
                onChange={(event) =>
                  updateGuestDraft("firstName", event.target.value)
                }
                value={guestDraft.firstName}
              />
            </KoochField>
            <KoochField label="Ù†Ø§Ù… Ø®Ø§Ù†ÙˆØ§Ø¯Ú¯ÛŒ">
              <KoochInput
                onChange={(event) =>
                  updateGuestDraft("lastName", event.target.value)
                }
                value={guestDraft.lastName}
              />
            </KoochField>
            <KoochField label="Ù…ÙˆØ¨Ø§ÛŒÙ„">
              <KoochInput
                inputMode="tel"
                onChange={(event) =>
                  updateGuestDraft("mobile", event.target.value)
                }
                value={guestDraft.mobile}
              />
            </KoochField>
            <KoochField label="Ø§ÛŒÙ…ÛŒÙ„">
              <KoochInput
                dir="ltr"
                onChange={(event) =>
                  updateGuestDraft("email", event.target.value)
                }
                type="email"
                value={guestDraft.email}
              />
            </KoochField>
            <KoochField label="Ú©Ø¯ Ù…Ù„ÛŒ">
              <KoochInput
                onChange={(event) =>
                  updateGuestDraft("nationalCode", event.target.value)
                }
                value={guestDraft.nationalCode}
              />
            </KoochField>
            <KoochField label="Ø´Ù…Ø§Ø±Ù‡ Ù¾Ø§Ø³Ù¾ÙˆØ±Øª">
              <KoochInput
                dir="ltr"
                onChange={(event) =>
                  updateGuestDraft("passportNumber", event.target.value)
                }
                value={guestDraft.passportNumber}
              />
            </KoochField>
            <KoochField label="Ù…Ù„ÛŒØª">
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

