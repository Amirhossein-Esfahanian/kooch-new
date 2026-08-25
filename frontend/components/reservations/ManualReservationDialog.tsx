"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochSearchableSelect,
  KoochSelect,
  KoochTextarea,
  type KoochSearchableSelectOption,
} from "@/components/KoochFormControls";
import type { GuestResponse } from "@/components/guests/GuestManagement";
import {
  ApiRequestError,
  apiRequest,
  type PricingGuestType,
  type PropertyResponse,
} from "@/lib/owner-api";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { KoochDatePicker } from "../KoochDatePicker";
import type {
  ReservationTableItem,
  ReservationTableStatus,
} from "./ReservationTable";

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
  notes: string;
};

export type ReservationMutationPayload = {
  status: ReservationTableStatus;
  propertyId: number;
  roomTypeId: number;
  roomId: number;
  guestId: number;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  childAges: number[];
  roomCount: number;
  roomIds: number[];
  guestType: PricingGuestType;
  notes: string | null;
};

export function buildReservationMutationPayload(
  payload: ReservationMutationPayload,
): ReservationMutationPayload {
  return payload;
}

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

type EffectiveReservationRules = {
  propertyId: number;
  roomTypeId: number;
  baseCapacity: number;
  maxDeclaredChildren: number;
  extraGuestAllowed: boolean;
  maxExtraGuests: number;
  extraGuestPrice: number;
  freeChildMaxAge: number | null;
  halfPriceChildMinAge: number | null;
  halfPriceChildMaxAge: number | null;
  childPrice: number | null;
  childRate: number;
  ruleSource: "Property" | "SiteDefault";
};

type AvailableRoomResponse = {
  roomId: number;
  roomName: string;
  baseCapacity: number;
  roomTypeId: number;
  extraGuestAllowed: boolean;
  maxExtraGuests: number;
  bookingMode: "Instant" | "OnRequest";
  isTemporary?: boolean;
};

type AvailableRoomApiResponse = Partial<AvailableRoomResponse> & {
  id?: number;
  name?: string;
  capacity?: number;
  allowExtraGuest?: boolean;
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
  notes: "",
};

const statusLabels: Record<string, string> = {
  Pending: "در انتظار",
  Confirmed: "تایید شده",
  Rejected: "رد شده",
  Cancelled: "لغو شده",
  Paid: "پرداخت شده",
  Completed: "تکمیل شده",
  PendingApproval: "در انتظار تایید",
  ApprovedAwaitingPayment: "در انتظار پرداخت",
  PaymentExpired: "مهلت پرداخت گذشته",
  CapacityLost: "ظرفیت از دست رفته",
  Draft: "پیش‌نویس",
};

function statusVariant(status?: ReservationTableStatus) {
  if (status === "Confirmed" || status === "Paid" || status === "Completed") {
    return "success" as const;
  }

  if (
    status === "Pending" ||
    status === "PendingApproval" ||
    status === "ApprovedAwaitingPayment"
  ) {
    return "warning" as const;
  }

  if (
    status === "Cancelled" ||
    status === "Rejected" ||
    status === "PaymentExpired" ||
    status === "CapacityLost"
  ) {
    return "destructive" as const;
  }

  return "muted" as const;
}

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

function formatAge(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function buildChildRuleSummary(
  rules: EffectiveReservationRules,
  currencyLabel: string,
): ChildRuleSummary {
  return {
    source:
      rules.ruleSource === "Property" ? "تنظیمات اقامتگاه" : "پیش‌فرض سایت",
    freeChildText:
      rules.halfPriceChildMinAge !== null
        ? `از ۱ تا ${formatAge(Math.max(1, rules.halfPriceChildMinAge - 1))} سال رایگان است.`
        : "سن کودک رایگان ثبت نشده است.",
    childPricingText:
      rules.halfPriceChildMinAge !== null && rules.halfPriceChildMaxAge !== null
        ? `از ${formatAge(rules.halfPriceChildMinAge)} تا ${formatAge(rules.halfPriceChildMaxAge)} سال با ${rules.childPrice !== null ? formatCurrency(rules.childPrice, { currencyLabel }) : `${formatPercent(rules.childRate)}٪ نرخ پایه`} محاسبه می‌شود.`
        : "بازه کودک نیم‌بها در پیش‌فرض سایت کامل نیست.",
    adultText:
      rules.halfPriceChildMaxAge !== null
        ? `سن بالاتر از ${formatAge(rules.halfPriceChildMaxAge)} سال به ظرفیت بزرگسال اضافه می‌شود.`
        : "سن‌های خارج از بازه کودک به ظرفیت بزرگسال اضافه می‌شوند.",
    roomText: rules.extraGuestAllowed
      ? `حداکثر ${formatAge(rules.maxExtraGuests)} نفر اضافه با نرخ ${formatCurrency(rules.extraGuestPrice, { currencyLabel })} پذیرفته می‌شود.`
      : "این اتاق نفر اضافه نمی‌پذیرد.",
  };
}

type ChildAgeToggleOption = {
  adultEquivalent: boolean;
  label: string;
  maximumAge: number | null;
  minimumAge: number;
  value: number;
};

function childAgeToggleOptions(
  rules: EffectiveReservationRules,
): ChildAgeToggleOption[] {
  const options: ChildAgeToggleOption[] = [];
  const freeMaximumAge =
    rules.halfPriceChildMinAge !== null
      ? rules.halfPriceChildMinAge - 1
      : rules.freeChildMaxAge;

  if (freeMaximumAge !== null && freeMaximumAge >= 1) {
    options.push({
      adultEquivalent: false,
      label:
        freeMaximumAge === 1
          ? `${formatAge(1)} سال`
          : `${formatAge(1)}–${formatAge(freeMaximumAge)} سال`,
      maximumAge: freeMaximumAge,
      minimumAge: 1,
      value: freeMaximumAge,
    });
  }

  if (
    rules.halfPriceChildMinAge !== null &&
    rules.halfPriceChildMaxAge !== null &&
    rules.halfPriceChildMinAge <= rules.halfPriceChildMaxAge
  ) {
    options.push({
      adultEquivalent: false,
      label:
        rules.halfPriceChildMinAge === rules.halfPriceChildMaxAge
          ? `${formatAge(rules.halfPriceChildMinAge)} سال`
          : `${formatAge(rules.halfPriceChildMinAge)}–${formatAge(rules.halfPriceChildMaxAge)} سال`,
      maximumAge: rules.halfPriceChildMaxAge,
      minimumAge: rules.halfPriceChildMinAge,
      value: rules.halfPriceChildMinAge,
    });
  }

  if (rules.halfPriceChildMaxAge !== null) {
    const adultMinimumAge = rules.halfPriceChildMaxAge + 1;
    options.push({
      adultEquivalent: true,
      label: "بزرگسال",
      maximumAge: null,
      minimumAge: adultMinimumAge,
      value: adultMinimumAge,
    });
  }

  return options;
}

function isChildAgeToggleSelected(value: string, option: ChildAgeToggleOption) {
  const age = Number(value);
  return (
    Number.isFinite(age) &&
    age >= option.minimumAge &&
    (option.maximumAge === null || age <= option.maximumAge)
  );
}

function isAdultEquivalentChildAge(
  value: string | number,
  rules: EffectiveReservationRules,
) {
  const age = Number(value);
  return (
    Number.isFinite(age) &&
    rules.halfPriceChildMaxAge !== null &&
    age > rules.halfPriceChildMaxAge
  );
}

function todayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function guestName(guest: GuestResponse) {
  return (
    guest.fullName ||
    `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() ||
    "-"
  );
}

function roomOptionDescription(room: AvailableRoomResponse) {
  if (room.isTemporary) return "اتاق فعلی";
  return room.bookingMode === "OnRequest" ? "نیازمند تایید" : "رزرو فوری";
}

function normalizeAvailableRoom(
  room: AvailableRoomApiResponse,
): AvailableRoomResponse | null {
  const roomId = room.roomId ?? room.id;
  const roomName = room.roomName ?? room.name;
  const baseCapacity = room.baseCapacity ?? room.capacity;
  const extraGuestAllowed =
    room.extraGuestAllowed ?? room.allowExtraGuest ?? false;

  if (
    !roomId ||
    !roomName?.trim() ||
    baseCapacity === undefined ||
    !room.roomTypeId ||
    !room.bookingMode
  ) {
    return null;
  }

  return {
    roomId,
    roomName: roomName.trim(),
    roomTypeId: room.roomTypeId,
    baseCapacity,
    bookingMode: room.bookingMode,
    extraGuestAllowed,
    maxExtraGuests: room.maxExtraGuests ?? 0,
  };
}

function isCapacityConflict(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 409) return true;
  if (!(error instanceof Error)) return false;

  const message = error.message.toLocaleLowerCase("en-US");
  return (
    message.includes("availability changed") ||
    message.includes("not enough capacity") ||
    message.includes("capacity lost")
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
  mode = "create",
  onCreated,
  onOpenChange,
  open: controlledOpen,
  reservation,
}: ManualReservationDialogProps) {
  const currencyLabel = useSiteCurrencyLabel();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReservationDraft>({
    ...initialDraft,
    propertyId: fixedPropertyId?.toString() ?? "",
  });
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [rooms, setRooms] = useState<AvailableRoomResponse[]>([]);
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [guestDraft, setGuestDraft] = useState<GuestDraft>(emptyGuestDraft);
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);
  const [pricePreview, setPricePreview] =
    useState<ReservationPricePreviewResponse | null>(null);
  const [pricePreviewLoading, setPricePreviewLoading] = useState(false);
  const [pricePreviewError, setPricePreviewError] = useState("");
  const [effectiveRules, setEffectiveRules] =
    useState<EffectiveReservationRules | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [availabilityReloadKey, setAvailabilityReloadKey] = useState(0);
  const [selectedStatus, setSelectedStatus] =
    useState<ReservationTableStatus>("Pending");
  const [savingGuest, setSavingGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pricePreviewRequestId = useRef(0);
  const availabilityAbortRef = useRef<AbortController | null>(null);
  const rulesAbortRef = useRef<AbortController | null>(null);
  const pricePreviewAbortRef = useRef<AbortController | null>(null);
  const guestSearchAbortRef = useRef<AbortController | null>(null);
  const pendingRoomCapacityResetRef = useRef<string | null>(null);
  const submissionInFlightRef = useRef(false);
  const dialogInitializationKeyRef = useRef<string | null>(null);
  const reservationRef = useRef(reservation);
  reservationRef.current = reservation;
  const isEditMode = mode === "edit";
  const dialogOpen = isEditMode ? Boolean(controlledOpen) : open;
  const reservationIdentity =
    reservation?.reservationId ??
    reservation?.id ??
    reservation?.reservationNumber ??
    "new";
  const isTerminalReadOnly =
    isEditMode &&
    reservation?.status !== undefined &&
    [
      "Cancelled",
      "Rejected",
      "PaymentExpired",
      "CapacityLost",
      "Completed",
    ].includes(reservation.status);
  const isLockedEdit =
    isEditMode &&
    reservation?.status !== undefined &&
    (reservation.status === "Paid" || isTerminalReadOnly);

  function setDialogOpen(nextOpen: boolean) {
    if (isEditMode) {
      onOpenChange?.(nextOpen);
      return;
    }

    setOpen(nextOpen);
  }

  const selectedPropertyId = Number(draft.propertyId);
  const selectedGuest = guests.find(
    (guest) => guest.id.toString() === draft.guestId,
  );
  const selectableRooms = useMemo(() => {
    if (
      !isEditMode ||
      !reservation?.roomId ||
      !reservation.roomName?.trim() ||
      !reservation.roomTypeId ||
      rooms.some((room) => room.roomId === reservation.roomId)
    ) {
      return rooms;
    }

    const knownBaseCapacity =
      reservation.roomBaseCapacity ??
      reservation.baseCapacity ??
      (effectiveRules?.roomTypeId === reservation.roomTypeId
        ? effectiveRules.baseCapacity
        : 0);

    return [
      {
        roomId: reservation.roomId,
        roomName: reservation.roomName.trim(),
        roomTypeId: reservation.roomTypeId,
        baseCapacity: knownBaseCapacity,
        bookingMode: "Instant" as const,
        extraGuestAllowed: effectiveRules?.extraGuestAllowed ?? false,
        maxExtraGuests: effectiveRules?.maxExtraGuests ?? 0,
        isTemporary: true,
      },
      ...rooms,
    ];
  }, [effectiveRules, isEditMode, reservation, rooms]);
  const selectedRoomNames = draft.roomIds
    .map(
      (id) =>
        selectableRooms.find((room) => room.roomId.toString() === id)?.roomName,
    )
    .filter(Boolean);
  const confirmationRoomNames =
    selectedRoomNames.length > 0
      ? selectedRoomNames
      : reservation?.roomName
        ? [reservation.roomName]
        : [];
  const nightsCount = daysBetween(draft.checkInDate, draft.checkOutDate);
  const selectedRoomCount = draft.roomIds.length;
  const selectedRoomBaseAdults = effectiveRules
    ? effectiveRules.baseCapacity * selectedRoomCount
    : 1;
  const selectedRoomMaxAdults = effectiveRules?.extraGuestAllowed
    ? selectedRoomBaseAdults + effectiveRules.maxExtraGuests * selectedRoomCount
    : selectedRoomBaseAdults;
  const maxDeclaredChildren = effectiveRules
    ? effectiveRules.maxDeclaredChildren * selectedRoomCount
    : 0;
  const adultEquivalentChildren = effectiveRules
    ? normalizeChildAges(
        draft.childAges,
        toNonNegativeInt(draft.children),
      ).filter((age) => isAdultEquivalentChildAge(age, effectiveRules)).length
    : 0;
  const maximumSelectableAdults = Math.max(
    1,
    selectedRoomMaxAdults - adultEquivalentChildren,
  );
  const remainingAdultEquivalentChildCapacity = Math.max(
    0,
    selectedRoomMaxAdults -
      toPositiveInt(draft.adults, 1) -
      adultEquivalentChildren,
  );
  const selectedRoomIdsKey = draft.roomIds.join(",");
  const childAgesKey = draft.childAges.join(",");
  const hasValidDateRange = nightsCount > 0;
  const hasOnRequest = draft.roomIds.some(
    (id) =>
      selectableRooms.find((room) => room.roomId.toString() === id)
        ?.bookingMode === "OnRequest",
  );
  const defaultCreateStatus: ReservationTableStatus = hasOnRequest
    ? "PendingApproval"
    : "Pending";
  const createStatusOptions: ReservationTableStatus[] = hasOnRequest
    ? ["PendingApproval"]
    : ["Pending", "Confirmed"];
  const editStatusOptions =
    isEditMode && reservation
      ? [
          reservation.status,
          ...(reservation.allowedStatusTransitions ?? []).filter(
            (status) => status !== "Cancelled",
          ),
        ].filter(
          (status, index, statuses) => statuses.indexOf(status) === index,
        )
      : [];
  const statusSelectionOptions = isEditMode
    ? editStatusOptions
    : createStatusOptions;
  const displayedStatus = selectedStatus;
  const childRuleSummary = effectiveRules
    ? buildChildRuleSummary(effectiveRules, currencyLabel)
    : null;
  const availableChildAgeToggles = effectiveRules
    ? childAgeToggleOptions(effectiveRules)
    : [];
  const existingManualAdjustment = reservation?.manualAdjustment ?? 0;
  const confirmationTotal =
    pricePreview !== null
      ? pricePreview.finalAmount + existingManualAdjustment
      : (reservation?.finalAmount ?? reservation?.totalPrice ?? null);
  const editChangeSummary: Array<{
    label: string;
    before: string;
    after: string;
  }> = [];
  if (isEditMode && reservation) {
    const originalGuestName =
      reservation.guestName ?? reservation.guestFullName ?? "-";
    const updatedGuestName = selectedGuest
      ? guestName(selectedGuest)
      : draft.guestSearch || "-";
    const originalRoomName = reservation.roomName ?? "-";
    const updatedRoomName =
      confirmationRoomNames.length > 0 ? confirmationRoomNames.join("، ") : "-";
    const originalGuestCount = `${reservation.adults ?? 0} بزرگسال، ${reservation.children ?? 0} کودک`;
    const updatedGuestCount = `${toPositiveInt(draft.adults, 1)} بزرگسال، ${toNonNegativeInt(draft.children)} کودک`;
    const originalCalculatedPrice =
      reservation.calculatedPrice ?? reservation.totalPrice;
    const originalTotal =
      reservation.finalAmount ??
      (originalCalculatedPrice !== undefined && originalCalculatedPrice !== null
        ? originalCalculatedPrice + existingManualAdjustment
        : null);

    if (draft.guestId !== (reservation.guestId?.toString() ?? "")) {
      editChangeSummary.push({
        label: "مهمان",
        before: originalGuestName,
        after: updatedGuestName,
      });
    }
    if (
      draft.roomIds.join(",") !==
      (reservation.roomId ? reservation.roomId.toString() : "")
    ) {
      editChangeSummary.push({
        label: "اتاق",
        before: originalRoomName,
        after: updatedRoomName,
      });
    }
    if (draft.checkInDate !== reservation.checkInDate) {
      editChangeSummary.push({
        label: "تاریخ ورود",
        before: reservation.checkInDate,
        after: draft.checkInDate,
      });
    }
    if (draft.checkOutDate !== reservation.checkOutDate) {
      editChangeSummary.push({
        label: "تاریخ خروج",
        before: reservation.checkOutDate,
        after: draft.checkOutDate,
      });
    }
    if (
      toPositiveInt(draft.adults, 1) !== (reservation.adults ?? 0) ||
      toNonNegativeInt(draft.children) !== (reservation.children ?? 0)
    ) {
      editChangeSummary.push({
        label: "تعداد مهمان",
        before: originalGuestCount,
        after: updatedGuestCount,
      });
    }
    if (
      pricePreview &&
      originalTotal !== undefined &&
      originalTotal !== null &&
      pricePreview.finalAmount + existingManualAdjustment !== originalTotal
    ) {
      editChangeSummary.push({
        label: "مبلغ کل",
        before: formatCurrency(originalTotal, { currencyLabel }),
        after: formatCurrency(
          pricePreview.finalAmount + existingManualAdjustment,
          { currencyLabel },
        ),
      });
    }
    if (draft.notes.trim() !== (reservation.notes ?? "").trim()) {
      editChangeSummary.push({
        label: "یادداشت داخلی",
        before: reservation.notes?.trim() || "-",
        after: draft.notes.trim() || "-",
      });
    }
    if (selectedStatus !== reservation.status) {
      editChangeSummary.push({
        label: "وضعیت",
        before: statusLabels[reservation.status] ?? reservation.status,
        after: statusLabels[selectedStatus] ?? selectedStatus,
      });
    }
  }
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
      [...selectableRooms]
        .sort(
          (first, second) =>
            first.baseCapacity - second.baseCapacity ||
            first.roomName.localeCompare(second.roomName, "fa"),
        )
        .map((room) => ({
          value: room.roomId,
          label: room.roomName,
          group:
            room.baseCapacity > 0
              ? `ظرفیت ${new Intl.NumberFormat("fa-IR").format(room.baseCapacity)} نفر`
              : "ظرفیت ثبت‌نشده",
          description: (
            <span className="inline-flex w-fit rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-foreground ring-1 ring-inset ring-primary/30">
              {roomOptionDescription(room)}
            </span>
          ),
          searchText: `${room.roomName} ظرفیت ${room.baseCapacity} ${roomOptionDescription(room)}`,
        })),
    [selectableRooms],
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
  const guestBasePath = useMemo(() => {
    if (context === "admin") return "/admin/guests";
    return `/owner/properties/${fixedPropertyId}/guests`;
  }, [context, fixedPropertyId]);

  function updateDraft(field: keyof ReservationDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateChildren(value: string) {
    const childrenCount = Math.min(
      toNonNegativeInt(value),
      maxDeclaredChildren,
    );
    setDraft((current) => ({
      ...current,
      children: childrenCount.toString(),
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
    if (
      value.length === draft.roomIds.length &&
      value.every((roomId, index) => roomId === draft.roomIds[index])
    ) {
      return;
    }

    rulesAbortRef.current?.abort();
    pricePreviewAbortRef.current?.abort();
    const selectedRooms = value
      .map((id) =>
        selectableRooms.find((room) => room.roomId.toString() === id),
      )
      .filter((room): room is AvailableRoomResponse => Boolean(room));
    const roomTypeId = selectedRooms[0]?.roomTypeId?.toString() ?? "";
    const roomIds = roomTypeId
      ? selectedRooms
          .filter((room) => room.roomTypeId.toString() === roomTypeId)
          .map((room) => room.roomId.toString())
      : [];
    const roomBaseCapacity = selectedRooms
      .filter((room) => room.roomTypeId.toString() === roomTypeId)
      .reduce((total, room) => total + room.baseCapacity, 0);
    pendingRoomCapacityResetRef.current = roomTypeId || null;
    setEffectiveRules(null);
    setRulesError("");
    setPricePreview(null);
    setPricePreviewLoading(roomIds.length > 0);
    pricePreviewRequestId.current += 1;
    setDraft((current) => ({
      ...current,
      roomTypeId,
      roomIds,
      adults:
        roomIds.length > 0
          ? Math.max(1, roomBaseCapacity).toString()
          : initialDraft.adults,
      children: initialDraft.children,
      childAges: [],
    }));
  }

  function updateGuestDraft(field: keyof GuestDraft, value: string) {
    setGuestDraft((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    if (!dialogOpen) {
      dialogInitializationKeyRef.current = null;
      return;
    }

    const initializationKey = [
      context,
      fixedPropertyId ?? "all",
      isEditMode ? "edit" : "create",
      reservationIdentity,
    ].join(":");
    if (dialogInitializationKeyRef.current === initializationKey) return;
    dialogInitializationKeyRef.current = initializationKey;

    setDraft(
      reservationDraft(
        isEditMode ? reservationRef.current : null,
        fixedPropertyId,
      ),
    );
    setGuestDraft(emptyGuestDraft);
    setGuestDialogOpen(false);
    setConfirmCreateOpen(false);
    setPricePreview(null);
    setPricePreviewLoading(false);
    setPricePreviewError("");
    setEffectiveRules(null);
    setRulesLoading(false);
    setRulesError("");
    setSelectedStatus(
      isEditMode ? (reservationRef.current?.status ?? "Draft") : "Pending",
    );
    pendingRoomCapacityResetRef.current = null;
    submissionInFlightRef.current = false;

    if (context === "admin") {
      apiRequest<PropertyResponse[]>("/admin/properties")
        .then(setProperties)
        .catch(() => setProperties([]));
    } else if (fixedPropertyId) {
      apiRequest<PropertyResponse>(`/owner/properties/${fixedPropertyId}`)
        .then((property) => setProperties([property]))
        .catch(() => setProperties([]));
    }
  }, [context, dialogOpen, fixedPropertyId, isEditMode, reservationIdentity]);

  useEffect(() => {
    if (!dialogOpen || isEditMode) return;

    setSelectedStatus((current) => {
      const isAllowed = hasOnRequest
        ? current === "PendingApproval"
        : current === "Pending" || current === "Confirmed";
      return isAllowed ? current : defaultCreateStatus;
    });
  }, [defaultCreateStatus, dialogOpen, hasOnRequest, isEditMode]);

  useEffect(() => {
    rulesAbortRef.current?.abort();
    if (
      !dialogOpen ||
      isLockedEdit ||
      context !== "admin" ||
      !selectedPropertyId ||
      !draft.roomTypeId ||
      selectedRoomCount <= 0
    ) {
      setEffectiveRules(null);
      setRulesLoading(false);
      setRulesError("");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    rulesAbortRef.current = controller;
    const query = new URLSearchParams({
      propertyId: selectedPropertyId.toString(),
      roomTypeId: draft.roomTypeId,
    });
    setRulesLoading(true);
    setRulesError("");
    apiRequest<EffectiveReservationRules>(
      `/admin/reservations/effective-rules?${query.toString()}`,
      { signal: controller.signal },
    )
      .then((rules) => {
        if (cancelled) return;
        const shouldResetAdults =
          pendingRoomCapacityResetRef.current === draft.roomTypeId;
        pendingRoomCapacityResetRef.current = null;
        setEffectiveRules(rules);
        setDraft((current) => {
          const roomCount = current.roomIds.length;
          const maximumAdults =
            rules.baseCapacity * roomCount +
            (rules.extraGuestAllowed ? rules.maxExtraGuests * roomCount : 0);
          const children = Math.min(
            toNonNegativeInt(current.children),
            rules.maxDeclaredChildren * roomCount,
          );

          return {
            ...current,
            adults: shouldResetAdults
              ? Math.max(1, rules.baseCapacity * roomCount).toString()
              : Math.min(
                  Math.max(1, toPositiveInt(current.adults, 1)),
                  maximumAdults,
                ).toString(),
            children: children.toString(),
            childAges: normalizeChildAges(current.childAges, children),
          };
        });
      })
      .catch((caught: Error) => {
        if (cancelled) return;
        if (caught.name === "AbortError") return;
        setEffectiveRules(null);
        setRulesError(caught.message || "قوانین رزرو اتاق بارگذاری نشد.");
      })
      .finally(() => {
        if (!cancelled) setRulesLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    context,
    dialogOpen,
    draft.roomTypeId,
    isLockedEdit,
    selectedPropertyId,
    selectedRoomCount,
  ]);

  useEffect(() => {
    availabilityAbortRef.current?.abort();
    if (isLockedEdit) {
      setLoadingRooms(false);
      return;
    }
    if (
      !dialogOpen ||
      !selectedPropertyId ||
      !hasValidDateRange ||
      context !== "admin"
    ) {
      setRooms([]);
      setLoadingRooms(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    availabilityAbortRef.current = controller;
    const params = new URLSearchParams({
      propertyId: selectedPropertyId.toString(),
      checkInDate: draft.checkInDate,
      checkOutDate: draft.checkOutDate,
    });
    const reservationId = reservation?.reservationId ?? reservation?.id;
    if (isEditMode && reservationId) {
      params.set("excludeReservationId", reservationId.toString());
    }

    setLoadingRooms(true);
    apiRequest<AvailableRoomApiResponse[]>(
      `/admin/reservations/available-rooms?${params.toString()}`,
      { signal: controller.signal },
    )
      .then((items) => {
        if (!cancelled) {
          const availableRooms = items
            .map(normalizeAvailableRoom)
            .filter((room): room is AvailableRoomResponse => room !== null);
          setRooms(availableRooms);
        }
      })
      .catch((caught: Error) => {
        if (!cancelled) {
          if (caught.name === "AbortError") return;
          setRooms([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRooms(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    draft.checkInDate,
    draft.checkOutDate,
    hasValidDateRange,
    context,
    dialogOpen,
    isLockedEdit,
    isEditMode,
    reservation?.id,
    reservation?.reservationId,
    selectedPropertyId,
    availabilityReloadKey,
  ]);

  useEffect(() => {
    guestSearchAbortRef.current?.abort();
    if (!dialogOpen || !guestBasePath || draft.guestSearch.trim().length < 2) {
      setGuests([]);
      return;
    }

    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      guestSearchAbortRef.current = controller;
      const query = new URLSearchParams({ query: draft.guestSearch.trim() });
      apiRequest<GuestResponse[]>(`${guestBasePath}?${query.toString()}`, {
        signal: controller.signal,
      })
        .then(setGuests)
        .catch((caught: Error) => {
          if (caught.name !== "AbortError") setGuests([]);
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      guestSearchAbortRef.current?.abort();
    };
  }, [dialogOpen, draft.guestSearch, guestBasePath]);

  useEffect(() => {
    pricePreviewAbortRef.current?.abort();
    const requestId = pricePreviewRequestId.current + 1;
    pricePreviewRequestId.current = requestId;

    if (!dialogOpen || context !== "admin" || isLockedEdit) {
      setPricePreview(null);
      setPricePreviewLoading(false);
      setPricePreviewError("");
      return;
    }

    const hasIncompleteChildAges = normalizeChildAges(
      draft.childAges,
      toNonNegativeInt(draft.children),
    ).some((age) => age.trim() === "");
    const hasCompletePricingInputs = Boolean(
      selectedPropertyId &&
      draft.roomTypeId &&
      hasValidDateRange &&
      selectedRoomCount > 0 &&
      !hasIncompleteChildAges,
    );

    if (!hasCompletePricingInputs) {
      setPricePreview(null);
      setPricePreviewLoading(false);
      setPricePreviewError("");
      return;
    }

    if (rulesError) {
      setPricePreview(null);
      setPricePreviewLoading(false);
      setPricePreviewError("");
      return;
    }

    if (loadingRooms || rulesLoading || !effectiveRules) {
      setPricePreviewLoading(true);
      setPricePreviewError("");
      return;
    }

    if (!selectedPropertyId || !draft.roomTypeId) {
      setPricePreviewLoading(false);
      return;
    }

    setPricePreviewError("");
    setPricePreviewLoading(true);
    const controller = new AbortController();
    pricePreviewAbortRef.current = controller;

    apiRequest<ReservationPricePreviewResponse>(
      "/admin/reservations/price-preview",
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          status: selectedStatus,
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
          setPricePreviewError("");
        }
      })
      .catch((caught: Error) => {
        if (pricePreviewRequestId.current === requestId) {
          if (caught.name === "AbortError") return;
          setPricePreview(null);
          setPricePreviewError(
            caught.message || "ترکیب مهمانان با ظرفیت اتاق سازگار نیست.",
          );
        }
      })
      .finally(() => {
        if (pricePreviewRequestId.current === requestId) {
          setPricePreviewLoading(false);
        }
      });

    return () => controller.abort();
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
    effectiveRules,
    hasValidDateRange,
    isLockedEdit,
    loadingRooms,
    selectedPropertyId,
    selectedRoomCount,
    selectedRoomIdsKey,
    rulesError,
    rulesLoading,
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

    if (submitting || submissionInFlightRef.current) return;

    if (isTerminalReadOnly) {
      toast.error("رزرو نهایی‌شده قابل ویرایش نیست.");
      return;
    }

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
      toast.error(pricePreviewError || "پیش‌نمایش قیمت آماده نیست.");
      return;
    }

    setConfirmCreateOpen(true);
  }

  async function createReservation() {
    if (submissionInFlightRef.current || submitting || pricePreviewLoading)
      return;
    submissionInFlightRef.current = true;
    setSubmitting(true);
    try {
      if (!isEditMode && context !== "admin") {
        throw new Error("ایجاد دستی رزرو فقط برای مدیر مجاز است.");
      }
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
        body: JSON.stringify(
          buildReservationMutationPayload({
            status: selectedStatus,
            propertyId: selectedPropertyId,
            roomTypeId: Number(draft.roomTypeId),
            roomId: Number(draft.roomIds[0]),
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
            notes: draft.notes.trim() || null,
          }),
        ),
      });

      toast.success(isEditMode ? "رزرو به‌روز شد." : "رزرو اضافه شد.");
      setConfirmCreateOpen(false);
      setDialogOpen(false);
      await onCreated();
    } catch (caught) {
      if (isCapacityConflict(caught)) {
        availabilityAbortRef.current?.abort();
        rulesAbortRef.current?.abort();
        pricePreviewAbortRef.current?.abort();
        setConfirmCreateOpen(false);
        setRooms([]);
        setEffectiveRules(null);
        setRulesError("");
        setPricePreview(null);
        setPricePreviewLoading(false);
        pricePreviewRequestId.current += 1;
        setDraft((current) => ({
          ...current,
          roomTypeId: "",
          roomIds: [],
        }));
        setAvailabilityReloadKey((current) => current + 1);
        toast.error(
          caught instanceof Error
            ? caught.message
            : "ظرفیت اتاق تغییر کرده است. لطفاً دوباره اتاق را انتخاب کنید.",
        );
        return;
      }

      toast.error(
        caught instanceof Error ? caught.message : "ذخیره رزرو انجام نشد.",
      );
      throw caught;
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      {!isEditMode && context === "admin" && (
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
              {isTerminalReadOnly ? "بستن" : "انصراف"}
            </KoochButton>
            {!isTerminalReadOnly && (
              <KoochButton
                form="manual-reservation-form"
                disabled={
                  submitting ||
                  pricePreviewLoading ||
                  rulesLoading ||
                  loadingRooms
                }
                loading={submitting}
                type="submit"
              >
                {isEditMode ? "ذخیره تغییرات" : "ثبت رزرو"}
              </KoochButton>
            )}
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
          <KoochCard className="grid gap-3" padding="sm" variant="muted">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-muted-foreground">
                  وضعیت رزرو
                </p>
                <div className="mt-2">
                  <KoochBadge variant={statusVariant(displayedStatus)}>
                    {statusLabels[displayedStatus] ?? displayedStatus}
                  </KoochBadge>
                </div>
              </div>
              <p className="max-w-md text-xs font-semibold leading-6 text-muted-foreground">
                {isEditMode
                  ? "فقط وضعیت‌های مجاز بازگشتی از گردش‌کار قابل انتخاب هستند. تغییر انتخاب‌شده همراه ذخیره اعمال می‌شود."
                  : "وضعیت پیش‌فرض از نوع رزرو اتاق تعیین می‌شود. فقط وضعیت‌های مجاز ثبت دستی قابل انتخاب هستند."}
              </p>
            </div>
            {!isTerminalReadOnly && statusSelectionOptions.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                {statusSelectionOptions.map((status) => (
                  <KoochButton
                    aria-pressed={selectedStatus === status}
                    key={status}
                    onClick={() => setSelectedStatus(status)}
                    size="sm"
                    type="button"
                    variant={selectedStatus === status ? "primary" : "outline"}
                  >
                    {statusLabels[status] ?? status}
                  </KoochButton>
                ))}
              </div>
            )}
          </KoochCard>

          {isLockedEdit ? (
            <KoochAlert
              title={isTerminalReadOnly ? "رزرو نهایی‌شده" : "رزرو پرداخت‌شده"}
              variant={isTerminalReadOnly ? "destructive" : "warning"}
            >
              {isTerminalReadOnly
                ? "این رزرو فقط قابل مشاهده است و امکان ویرایش آن وجود ندارد."
                : "اتاق، تاریخ، تعداد مهمان و قیمت این رزرو قابل تغییر نیست. فقط یادداشت داخلی را می‌توانید ویرایش کنید."}
            </KoochAlert>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {rulesLoading ? (
                  <KoochCard className="md:col-span-2" padding="sm">
                    <p className="text-sm font-semibold text-muted-foreground">
                      در حال بارگذاری قوانین اتاق...
                    </p>
                  </KoochCard>
                ) : rulesError ? (
                  <KoochAlert
                    className="md:col-span-2"
                    title="خطا در قوانین اتاق"
                    variant="destructive"
                  >
                    {rulesError}
                  </KoochAlert>
                ) : childRuleSummary ? (
                  <div className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold">قانون اعمال‌شده کودک</p>
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
                ) : (
                  <KoochCard className="md:col-span-2" padding="sm">
                    <p className="text-sm font-semibold text-muted-foreground">
                      برای نمایش قوانین رزرو، ابتدا اتاق را انتخاب کنید.
                    </p>
                  </KoochCard>
                )}

                {context === "admin" && (
                  <KoochField label="اقامتگاه" required>
                    <KoochSearchableSelect
                      disabled={isLockedEdit}
                      emptyText="اقامتگاهی پیدا نشد."
                      onChange={(value) => {
                        if (value === draft.propertyId) return;
                        availabilityAbortRef.current?.abort();
                        rulesAbortRef.current?.abort();
                        pricePreviewAbortRef.current?.abort();
                        guestSearchAbortRef.current?.abort();
                        setRooms([]);
                        setGuests([]);
                        setEffectiveRules(null);
                        setRulesError("");
                        setPricePreview(null);
                        setPricePreviewLoading(false);
                        pricePreviewRequestId.current += 1;
                        setDraft((current) => ({
                          ...current,
                          propertyId: value,
                          guestId: "",
                          guestSearch: "",
                          checkInDate: "",
                          checkOutDate: "",
                          roomTypeId: "",
                          roomIds: [],
                          adults: initialDraft.adults,
                          children: initialDraft.children,
                          childAges: [],
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
                      onSearchChange={(query) =>
                        updateDraft("guestSearch", query)
                      }
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

                <KoochField
                  className="md:col-span-2"
                  label="بازه اقامت"
                  required
                >
                  <KoochDatePicker
                    labels={{ start: "ورود", end: "خروج" }}
                    mode="range"
                    minDate={isEditMode ? undefined : todayIsoDate()}
                    openOnDialog
                    dialogContentClassName="!h-auto !max-h-[calc(100vh-2rem)] !grid-rows-[auto_minmax(0,auto)_auto]"
                    dialogBodyClassName="!overflow-visible !py-4"
                    dialogFooterClassName="!py-3 "
                    onChange={(value) => {
                      if (isLockedEdit) return;
                      const nextCheckInDate = value.startDate ?? "";
                      const nextCheckOutDate = value.endDate ?? "";
                      if (
                        nextCheckInDate === draft.checkInDate &&
                        nextCheckOutDate === draft.checkOutDate
                      ) {
                        return;
                      }
                      availabilityAbortRef.current?.abort();
                      rulesAbortRef.current?.abort();
                      pricePreviewAbortRef.current?.abort();
                      setRooms([]);
                      setEffectiveRules(null);
                      setRulesError("");
                      setPricePreview(null);
                      setPricePreviewLoading(false);
                      pricePreviewRequestId.current += 1;
                      setDraft((current) => ({
                        ...current,
                        checkInDate: nextCheckInDate,
                        checkOutDate: nextCheckOutDate,
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
                      تعداد شب:{" "}
                      {new Intl.NumberFormat("fa-IR").format(nightsCount)}
                    </p>
                  )}
                </KoochField>

                <KoochField className="md:col-span-2" label="اتاق" required>
                  <KoochSearchableSelect
                    disabled={
                      isLockedEdit ||
                      !selectedPropertyId ||
                      loadingRooms ||
                      nightsCount <= 0
                    }
                    emptyText="برای بازه انتخاب‌شده اتاقی موجود نیست."
                    onChange={(value) =>
                      updateSelectedRooms(value ? [value] : [])
                    }
                    options={roomOptions}
                    placeholder={
                      loadingRooms && hasValidDateRange
                        ? "در حال بارگذاری..."
                        : nightsCount <= 0
                          ? "ابتدا بازه اقامت را انتخاب کنید"
                          : "انتخاب اتاق‌ها"
                    }
                    searchPlaceholder="جستجوی اتاق..."
                    value={draft.roomIds[0] ?? ""}
                  />
                </KoochField>

                <KoochField
                  helperText={
                    effectiveRules?.extraGuestAllowed
                      ? `ظرفیت پایه: ${new Intl.NumberFormat("fa-IR").format(selectedRoomBaseAdults)}؛ حداکثر با نفر اضافه: ${new Intl.NumberFormat("fa-IR").format(selectedRoomMaxAdults)}`
                      : effectiveRules
                        ? "این اتاق نفر اضافه نمی‌پذیرد."
                        : "ابتدا اتاق را انتخاب کنید."
                  }
                  label="بزرگسالان"
                >
                  <KoochInput
                    disabled={
                      isLockedEdit ||
                      rulesLoading ||
                      Boolean(rulesError) ||
                      !effectiveRules
                    }
                    max={maximumSelectableAdults}
                    min={1}
                    onChange={(event) => {
                      const nextAdults = Math.max(
                        1,
                        Math.min(
                          toPositiveInt(event.target.value, 1),
                          maximumSelectableAdults,
                        ),
                      );
                      updateDraft("adults", nextAdults.toString());
                    }}
                    type="number"
                    value={draft.adults}
                  />
                </KoochField>

                <KoochField
                  helperText={
                    effectiveRules
                      ? `حداکثر ${formatAge(maxDeclaredChildren)} کودک؛ کودک رایگان و نیم‌بها از ظرفیت بزرگسال کم نمی‌کند.`
                      : "پس از بارگذاری قوانین اتاق، شرایط کودک نمایش داده می‌شود."
                  }
                  label="کودکان"
                >
                  <div className="grid gap-3">
                    <KoochInput
                      max={maxDeclaredChildren}
                      min={0}
                      disabled={
                        isLockedEdit ||
                        rulesLoading ||
                        !effectiveRules ||
                        Boolean(rulesError)
                      }
                      onChange={(event) => updateChildren(event.target.value)}
                      type="number"
                      value={draft.children}
                    />
                    {toNonNegativeInt(draft.children) > 0 && (
                      <div className="grid gap-2 rounded-lg border border-border bg-muted p-3">
                        <p className="text-xs font-bold text-muted-foreground">
                          سن کودکان
                        </p>
                        <div className="grid gap-3">
                          {normalizeChildAges(
                            draft.childAges,
                            toNonNegativeInt(draft.children),
                          ).map((age, index) => (
                            <div className="grid gap-2" key={index}>
                              <p className="text-xs font-semibold text-foreground">
                                {`کودک ${new Intl.NumberFormat("fa-IR").format(index + 1)}`}
                              </p>
                              <div
                                aria-label={`رده سنی کودک ${index + 1}`}
                                className="flex flex-wrap gap-2"
                                role="group"
                              >
                                {availableChildAgeToggles.map((option) => {
                                  const currentAgeIsAdultEquivalent =
                                    effectiveRules
                                      ? isAdultEquivalentChildAge(
                                          age,
                                          effectiveRules,
                                        )
                                      : false;
                                  const selected = isChildAgeToggleSelected(
                                    age,
                                    option,
                                  );

                                  return (
                                    <KoochButton
                                      aria-pressed={selected}
                                      className="grow"
                                      disabled={
                                        isLockedEdit ||
                                        rulesLoading ||
                                        !effectiveRules ||
                                        Boolean(rulesError) ||
                                        (option.adultEquivalent &&
                                          !currentAgeIsAdultEquivalent &&
                                          remainingAdultEquivalentChildCapacity ===
                                            0)
                                      }
                                      key={option.value}
                                      onClick={() =>
                                        updateChildAge(
                                          index,
                                          option.value.toString(),
                                        )
                                      }
                                      size="sm"
                                      type="button"
                                      variant={selected ? "primary" : "outline"}
                                    >
                                      {option.label}
                                    </KoochButton>
                                  );
                                })}
                              </div>
                            </div>
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
              </div>

              {hasOnRequest && (
                <KoochAlert title="نیازمند تایید" variant="warning">
                  این رزرو نیازمند تایید است و فعلاً پرداخت یا کاهش موجودی انجام
                  نمی‌شود.
                </KoochAlert>
              )}

              {pricePreviewError && (
                <KoochAlert
                  title="ظرفیت مهمانان نامعتبر است"
                  variant="destructive"
                >
                  {pricePreviewError}
                </KoochAlert>
              )}

              <KoochCard className="grid gap-3" padding="sm" variant="elevated">
                <h3 className="text-sm font-bold text-foreground">
                  خلاصه قیمت
                </h3>
                {pricePreviewLoading ? (
                  <p className="text-sm font-semibold text-muted-foreground">
                    در حال آماده‌سازی و محاسبه قیمت...
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
                      {formatCurrency(pricePreview.baseAmount, {
                        currencyLabel,
                      })}
                    </span>
                    <span>
                      هزینه کودک:{" "}
                      {formatCurrency(pricePreview.childAmount, {
                        currencyLabel,
                      })}
                    </span>
                    <span>
                      هزینه نفر اضافه:{" "}
                      {formatCurrency(pricePreview.extraGuestAmount, {
                        currencyLabel,
                      })}
                    </span>
                    <span>
                      تخفیف پروموشن:{" "}
                      {formatCurrency(pricePreview.discountAmount, {
                        currencyLabel,
                      })}
                    </span>
                    <span className="font-bold">
                      مبلغ کل:{" "}
                      {formatCurrency(pricePreview.finalAmount, {
                        currencyLabel,
                      })}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-muted-foreground">
                    برای محاسبه قیمت، تاریخ و اتاق را انتخاب کنید.
                  </p>
                )}
              </KoochCard>
            </>
          )}

          <KoochField label="یادداشت داخلی">
            <KoochTextarea
              disabled={isTerminalReadOnly}
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
        description="اطلاعات زیر را بررسی کنید. با تایید، رزرو ذخیره می‌شود."
        variant="question"
      >
        <div className="grid gap-4 text-right" dir="rtl">
          {isEditMode && editChangeSummary.length > 0 && (
            <section className="grid gap-2 border-b border-border pb-4">
              <h3 className="text-sm font-bold text-foreground">تغییرات</h3>
              {editChangeSummary.map((change) => (
                <div
                  className="grid gap-1 rounded-md bg-muted px-3 py-2 text-xs"
                  key={change.label}
                >
                  <span className="font-bold text-foreground">
                    {change.label}
                  </span>
                  <span className="text-muted-foreground">
                    قبل: {change.before}
                  </span>
                  <span className="text-foreground">بعد: {change.after}</span>
                </div>
              ))}
            </section>
          )}

          <section className="grid gap-2 text-sm">
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
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">وضعیت پس از ذخیره</span>
              <KoochBadge variant={statusVariant(selectedStatus)}>
                {statusLabels[selectedStatus] ?? selectedStatus}
              </KoochBadge>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
              <span className="text-muted-foreground">مبلغ کل</span>
              <span className="font-bold text-foreground">
                {formatCurrency(confirmationTotal, { currencyLabel })}
              </span>
            </div>
          </section>
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
