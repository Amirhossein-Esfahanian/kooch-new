"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { NumberedSteps } from "@/components/NumberedSteps";
import { GuestSelector, type GuestSelectorValue } from "@/components/GuestSelector";
import styles from "./ManualReservationDialog.module.css";
import { ManualReceiptFields } from "./ManualReceiptFields";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochIcon } from "@/components/KoochIcon";
import { KoochInfoHint } from "@/components/KoochInfoHint";
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
  ApiRequestError,
  apiRequest,
  type PricingGuestType,
  type PropertyResponse,
} from "@/lib/owner-api";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { toPersianDigits } from "@/lib/persian-digits";
import { KoochDatePicker } from "../KoochDatePicker";
import { displayDateParts } from "../SharedDateRangePicker";
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
  onReviewCreatedReservation?: (reservationId: number) => void;
  canReviewCreatedReservation?: (propertyId: number) => boolean;
  canRecordReceivedPayment?: (propertyId: number) => boolean;
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
  typeQuantities: Record<string, string>;
  requestedRooms: string;
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
  receivedPayment?: {
    idempotencyKey: string; confirmedAmount: number; currency: string;
    method: string; referenceNumber: string | null; paymentDate: string;
  };
  reviewedRoomAmounts?: number[];
  status?: ReservationTableStatus;
  propertyId: number;
  roomTypeId: number;
  roomId: number;
  guestId: number | null;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  childAges: number[];
  roomCount: number;
  roomIds: number[];
  roomTypeSelections?: Array<{ roomTypeId: number; quantity: number }>;
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
  roomPrices?: Array<{ adults: number; children: number; finalAmount: number; currency: string }>;
};

type ManualBookingCreateResponse = {
  bookingSessionId: number;
  sessionCode: string;
  totalAmount: number;
  currency: string;
  reservations: Array<{
    id: number;
    reservationNumber: string;
    roomName: string | null;
    roomTypeName: string;
    finalAmount: number;
    status?: ReservationTableStatus;
    allowedStatusTransitions?: ReservationTableStatus[];
    propertyId?: number;
  }>;
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

type ManualRoomTypeOption = {
  roomTypeId: number;
  name: string;
  inventoryMode: "NamedRooms" | "TypeBasedInventory";
  availableCount: number;
  baseCapacity?: number | null;
  maxExtraGuests?: number | null;
  bookingMode: "Instant" | "OnRequest";
  rooms: AvailableRoomApiResponse[];
};
type ManualAvailability = {
  options: ManualRoomTypeOption[];
  excluded: Array<{ roomTypeId: number; name: string;
    reason: "NoAvailability" | "MissingNightlyPricing" | "NoEligibleNamedRooms" | "GuestCapacityExceeded"; missingDates: string[] }>;
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
  typeQuantities: {},
  requestedRooms: "1",
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
    typeQuantities: {},
    requestedRooms: "1",
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
  return toPersianDigits(new Intl.NumberFormat("fa-IR").format(value));
}

function formatPercent(value: number) {
  return toPersianDigits(new Intl.NumberFormat("fa-IR").format(value));
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
  onReviewCreatedReservation,
  canReviewCreatedReservation,
  canRecordReceivedPayment,
}: ManualReservationDialogProps) {
  const currencyLabel = useSiteCurrencyLabel();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReservationDraft>({
    ...initialDraft,
    propertyId: fixedPropertyId?.toString() ?? "",
  });
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [rooms, setRooms] = useState<AvailableRoomResponse[]>([]);
  const [manualOptions, setManualOptions] = useState<ManualRoomTypeOption[]>([]);
  const [excludedOptions, setExcludedOptions] = useState<ManualAvailability["excluded"]>([]);
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [guestDraft, setGuestDraft] = useState<GuestDraft>(emptyGuestDraft);
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<ManualBookingCreateResponse | null>(null);
  const [recordReceived, setRecordReceived] = useState(false);
  const [receiptMethod, setReceiptMethod] = useState("BankTransfer");
  const [receiptReference, setReceiptReference] = useState("");
  const receivedSubmission = useRef<{ fingerprint: string; key: string; date: string } | null>(null);
  const [priceReviewVersion, setPriceReviewVersion] = useState(0);
  const canReviewCreated = (item: ManualBookingCreateResponse["reservations"][number]) => Boolean(
    onReviewCreatedReservation && item.propertyId && canReviewCreatedReservation?.(item.propertyId) &&
    item.status === "PendingApproval" && item.allowedStatusTransitions?.includes("ApprovedAwaitingPayment"));
  const [pricePreview, setPricePreview] =
    useState<ReservationPricePreviewResponse | null>(null);
  const [pricePreviewLoading, setPricePreviewLoading] = useState(false);
  const [pricePreviewError, setPricePreviewError] = useState("");
  const [effectiveRules, setEffectiveRules] =
    useState<EffectiveReservationRules | null>(null);
  const [wizardRules, setWizardRules] = useState<EffectiveReservationRules[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [submissionError, setSubmissionError] = useState("");
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const [availabilityReloadKey, setAvailabilityReloadKey] = useState(0);
  const [selectedStatus, setSelectedStatus] =
    useState<ReservationTableStatus>("Pending");
  const [savingGuest, setSavingGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pricePreviewRequestId = useRef(0);
  const availabilityAbortRef = useRef<AbortController | null>(null);
  const availabilityRequestId = useRef(0);
  const rulesAbortRef = useRef<AbortController | null>(null);
  const pricePreviewAbortRef = useRef<AbortController | null>(null);
  const guestSearchAbortRef = useRef<AbortController | null>(null);
  const pendingRoomCapacityResetRef = useRef<string | null>(null);
  const submissionInFlightRef = useRef(false);
  const dialogInitializationKeyRef = useRef<string | null>(null);
  const reservationRef = useRef(reservation);
  reservationRef.current = reservation;
  const isEditMode = mode === "edit";
  const isWizard = !isEditMode && context === "admin";
  const wizardAvailabilityReady = !isWizard || availabilityLoaded;
  const showStay = !isWizard || wizardStep === 1;
  const showRooms = !isWizard || wizardStep === 2;
  const showReview = !isWizard || wizardStep === 3;
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
    if (!nextOpen && isWizard) invalidateWizardAvailability();
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
  const selectedTypeOptions = isWizard ? manualOptions.filter(option =>
    option.inventoryMode === "TypeBasedInventory" && toNonNegativeInt(draft.typeQuantities[option.roomTypeId] ?? "0") > 0) : [];
  const typeSelections = selectedTypeOptions.map(option => ({ roomTypeId: option.roomTypeId,
    quantity: toNonNegativeInt(draft.typeQuantities[option.roomTypeId]) }));
  const typeSelectionsKey = JSON.stringify(typeSelections);
  const selectedRoomNames = draft.roomIds
    .map(
      (id) =>
        selectableRooms.find((room) => room.roomId.toString() === id)?.roomName,
    )
    .filter(Boolean).concat(selectedTypeOptions.flatMap(option =>
      Array.from({ length: Math.min(100, toNonNegativeInt(draft.typeQuantities[option.roomTypeId])) },
        (_, index) => `${option.name} — واحد ${toPersianDigits(index + 1)}`)));
  const confirmationRoomNames =
    selectedRoomNames.length > 0
      ? selectedRoomNames
      : reservation?.roomName
        ? [reservation.roomName]
        : [];
  const nightsCount = daysBetween(draft.checkInDate, draft.checkOutDate);
  const selectedRoomCount = draft.roomIds.length + typeSelections.reduce((sum, selection) => sum + selection.quantity, 0);
  const selectedRoomSummary = manualOptions.map(option => ({
    roomTypeId: option.roomTypeId, name: option.name,
    quantity: option.inventoryMode === "TypeBasedInventory"
      ? toNonNegativeInt(draft.typeQuantities[option.roomTypeId] ?? "0")
      : draft.roomIds.filter(id => rooms.find(room => String(room.roomId) === id)?.roomTypeId === option.roomTypeId).length,
  })).filter(option => option.quantity > 0);
  const requestedRoomCount = toPositiveInt(draft.requestedRooms, 1);
  const selectedTypeIdsKey = [...new Set([
    ...draft.roomIds.map(id => selectableRooms.find(room => String(room.roomId) === id)?.roomTypeId),
    ...typeSelections.map(selection => selection.roomTypeId),
  ].filter((id): id is number => id !== undefined))].join(",");
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
  const hasOnRequest = selectedTypeOptions.some(option => option.bookingMode === "OnRequest") || draft.roomIds.some(
    (id) =>
      selectableRooms.find((room) => room.roomId.toString() === id)
        ?.bookingMode === "OnRequest",
  );
  const hasInstant = selectedTypeOptions.some(option => option.bookingMode === "Instant") || draft.roomIds.some(
    id => selectableRooms.find(room => String(room.roomId) === id)?.bookingMode === "Instant");
  const defaultCreateStatus: ReservationTableStatus = hasOnRequest
    ? "PendingApproval"
    : "Pending";
  const createStatusOptions: ReservationTableStatus[] = hasOnRequest
    ? ["PendingApproval"]
    : ["Pending"];
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
  const previewCurrencyLabel = isWizard
    ? pricePreview?.currency === "IRR" || !pricePreview ? "ریال" : pricePreview.currency
    : currencyLabel;
  const childRuleSummary = effectiveRules
    ? buildChildRuleSummary(effectiveRules, previewCurrencyLabel)
    : null;
  const availableChildAgeToggles = effectiveRules
    ? childAgeToggleOptions(effectiveRules)
    : [];
  const existingManualAdjustment = reservation?.manualAdjustment ?? 0;
  const confirmationTotal =
    pricePreview !== null
      ? pricePreview.finalAmount + existingManualAdjustment
      : (reservation?.finalAmount ?? reservation?.totalPrice ?? null);
  const stayInputChecks = [
    { valid: Boolean(selectedPropertyId), hint: "اقامتگاه را انتخاب کنید." },
    { valid: Boolean(draft.guestId), hint: "مهمان را انتخاب کنید." },
    { valid: hasValidDateRange, hint: "تاریخ ورود و خروج را انتخاب کنید." },
    { valid: /^\d+$/.test(draft.requestedRooms) && Number(draft.requestedRooms) >= 1 && requestedRoomCount <= 100, hint: "تعداد اتاق‌ها را مشخص کنید." },
    { valid: /^\d+$/.test(draft.adults) && Number(draft.adults) >= 1 && Number(draft.adults) <= 100, hint: "تعداد بزرگسالان را مشخص کنید." },
    { valid: /^\d+$/.test(draft.children) && Number(draft.children) <= 100, hint: "تعداد کودکان را مشخص کنید." },
    { valid: draft.childAges.length === Number(draft.children) && draft.childAges.every(age => /^\d+$/.test(age) && Number(age) <= 17), hint: "سن هر کودک را در انتخابگر مهمانان وارد کنید." },
  ];
  const stayInputHint = stayInputChecks.find(check => !check.valid)?.hint;
  const stayInputsValid = !stayInputHint;
  const roomPrices = pricePreview
    ? selectedRoomCount === 1 ? [pricePreview] : pricePreview.roomPrices ?? []
    : [];
  const selectionsValid = draft.roomIds.every(id => rooms.some(room => String(room.roomId) === id)) &&
    Object.entries(draft.typeQuantities).every(([id, quantity]) => /^\d+$/.test(quantity) &&
      (Number(quantity) === 0 || selectedTypeOptions.some(option => String(option.roomTypeId) === id && Number(quantity) <= option.availableCount)));
  const roomsReady = Boolean(availabilityLoaded && !loadingRooms && !availabilityError &&
    selectedRoomCount === requestedRoomCount && selectionsValid &&
    effectiveRules && !rulesLoading && !rulesError && pricePreview && !pricePreviewLoading && !pricePreviewError &&
    roomPrices.length === selectedRoomCount && roomPrices.every(price => price.currency === pricePreview.currency) &&
    Math.abs(roomPrices.reduce((sum, price) => sum + price.finalAmount, 0) - pricePreview.finalAmount) < 0.01);
  const canReceiveFull = Boolean(isWizard && roomsReady && !hasOnRequest &&
    canRecordReceivedPayment?.(selectedPropertyId) && roomPrices.every(price => price.finalAmount > 0));
  const willRecordReceived = recordReceived && canReceiveFull;

  useEffect(() => { if (!canReceiveFull) setRecordReceived(false); }, [canReceiveFull]);

  function goToStep(step: 1 | 2 | 3) {
    setWizardStep(step);
    setSubmissionError("");
  }

  function invalidateWizardAvailability() {
    availabilityRequestId.current += 1;
    availabilityAbortRef.current?.abort();
    rulesAbortRef.current?.abort();
    pricePreviewAbortRef.current?.abort();
    pricePreviewRequestId.current += 1;
    setRooms([]);
    setManualOptions([]);
    setExcludedOptions([]);
    setLoadingRooms(false);
    setAvailabilityLoaded(false);
    setAvailabilityError("");
    setEffectiveRules(null);
    setRulesLoading(false);
    setRulesError("");
    setPricePreview(null);
    setPricePreviewLoading(false);
    setPricePreviewError("");
  }

  async function checkWizardAvailability() {
    if (!isWizard || !dialogOpen || !stayInputsValid || loadingRooms) return;
    invalidateWizardAvailability();
    const requestId = availabilityRequestId.current;
    const controller = new AbortController();
    availabilityAbortRef.current = controller;
    const params = new URLSearchParams({
      propertyId: draft.propertyId,
      checkInDate: draft.checkInDate,
      checkOutDate: draft.checkOutDate,
      forCreation: "true",
      guestType: draft.guestType,
    });
    setLoadingRooms(true);
    try {
      const response = await apiRequest<ManualAvailability>(
        `/admin/reservations/available-rooms?${params.toString()}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || availabilityRequestId.current !== requestId) return;
      if (!Array.isArray(response.options) || !Array.isArray(response.excluded))
        throw new Error("پاسخ فهرست اتاق‌ها معتبر نیست؛ دوباره تلاش کنید.");
      const items = response.options.flatMap(option => option.rooms);
      const availableRooms = items.map(normalizeAvailableRoom)
        .filter((room): room is AvailableRoomResponse => room !== null);
      if (availableRooms.length !== items.length)
        throw new Error("پاسخ فهرست اتاق‌ها معتبر نیست؛ دوباره تلاش کنید.");
      setRooms(availableRooms);
      setManualOptions(response.options);
      setExcludedOptions(response.excluded);
      setAvailabilityLoaded(true);
      setDraft(current => {
        const roomIds = current.roomIds.filter(id => availableRooms.some(room => String(room.roomId) === id));
        const typeQuantities = Object.fromEntries(response.options.filter(option => option.inventoryMode === "TypeBasedInventory")
          .map(option => [option.roomTypeId, String(Math.min(toNonNegativeInt(current.typeQuantities[option.roomTypeId] ?? "0"), option.availableCount))]));
        const roomTypeId = availableRooms.find(room => String(room.roomId) === roomIds[0])?.roomTypeId.toString()
          ?? Object.keys(typeQuantities).find(id => Number(typeQuantities[id]) > 0) ?? "";
        return { ...current, roomIds, roomTypeId, typeQuantities };
      });
      if (response.options.length > 0) goToStep(2);
    } catch (caught) {
      if (controller.signal.aborted || availabilityRequestId.current !== requestId) return;
      setAvailabilityError(caught instanceof Error ? caught.message : "دریافت اتاق‌ها انجام نشد.");
    } finally {
      if (availabilityRequestId.current === requestId) setLoadingRooms(false);
    }
  }

  useEffect(() => () => {
    availabilityRequestId.current += 1;
    availabilityAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (isWizard && dialogOpen) stepHeadingRef.current?.focus();
  }, [wizardStep, isWizard, dialogOpen, createdOrder]);
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
    const originalRoomName = toPersianDigits(reservation.roomName ?? "-");
    const updatedRoomName =
      confirmationRoomNames.length > 0
        ? toPersianDigits(confirmationRoomNames.join("، "))
        : "-";
    const originalGuestCount = `${toPersianDigits(reservation.adults ?? 0)} بزرگسال، ${toPersianDigits(reservation.children ?? 0)} کودک`;
    const updatedGuestCount = `${toPersianDigits(toPositiveInt(draft.adults, 1))} بزرگسال، ${toPersianDigits(toNonNegativeInt(draft.children))} کودک`;
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
        before: toPersianDigits(reservation.checkInDate),
        after: toPersianDigits(draft.checkInDate),
      });
    }
    if (draft.checkOutDate !== reservation.checkOutDate) {
      editChangeSummary.push({
        label: "تاریخ خروج",
        before: toPersianDigits(reservation.checkOutDate),
        after: toPersianDigits(draft.checkOutDate),
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
          label: toPersianDigits(room.roomName),
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
      const description = guest.mobile
        ? toPersianDigits(guest.mobile)
        : (guest.email ?? "-");

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
      isWizard ? 100 : maxDeclaredChildren,
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

  function updateWizardGuests(value: GuestSelectorValue<string>) {
    const roomsChanged = String(value.rooms) !== draft.requestedRooms;
    if (roomsChanged) invalidateWizardAvailability();
    setDraft(current => ({ ...current, requestedRooms: String(value.rooms), adults: String(value.adults),
      children: String(value.children), childAges: value.childAges,
      ...(roomsChanged ? { roomIds: [], roomTypeId: "", typeQuantities: {} } : {}) }));
  }

  function updateSelectedRooms(value: string[]) {
    if (isWizard) {
      if (value.length + typeSelections.reduce((sum, selection) => sum + selection.quantity, 0) > requestedRoomCount) {
        toast.error("تعداد اتاق‌های انتخابی نباید از تعداد درخواستی بیشتر باشد.");
        return;
      }
      pricePreviewAbortRef.current?.abort();
      pricePreviewRequestId.current += 1;
      setPricePreview(null);
      setDraft(current => ({ ...current, roomIds: value,
        roomTypeId: rooms.find(room => String(room.roomId) === value[0])?.roomTypeId.toString()
          ?? String(typeSelections[0]?.roomTypeId ?? "") }));
      return;
    }
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
    pendingRoomCapacityResetRef.current = isWizard ? null : roomTypeId || null;
    setEffectiveRules(null);
    setRulesError("");
    setPricePreview(null);
    setPricePreviewLoading(roomIds.length > 0);
    pricePreviewRequestId.current += 1;
    setDraft((current) => ({
      ...current,
      roomTypeId,
      roomIds,
      typeQuantities: {},
      adults:
        isWizard ? current.adults : roomIds.length > 0
          ? Math.max(1, roomBaseCapacity).toString()
          : initialDraft.adults,
      children: isWizard ? current.children : initialDraft.children,
      childAges: isWizard ? current.childAges : [],
    }));
  }

  function updateTypeSelection(roomTypeId: string, quantity: string) {
    rulesAbortRef.current?.abort();
    pricePreviewAbortRef.current?.abort();
    pricePreviewRequestId.current += 1;
    setEffectiveRules(null);
    setPricePreview(null);
    setPricePreviewError("");
    setDraft(current => {
      const typeQuantities = { ...current.typeQuantities, [roomTypeId]: quantity };
      return { ...current, typeQuantities,
        roomTypeId: rooms.find(room => String(room.roomId) === current.roomIds[0])?.roomTypeId.toString()
          ?? Object.keys(typeQuantities).find(id => Number(typeQuantities[id]) > 0) ?? "" };
    });
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
    setWizardStep(1);
    setCreatedOrder(null);
    setRecordReceived(false);
    setReceiptMethod("BankTransfer");
    setReceiptReference("");
    receivedSubmission.current = null;
    setSubmissionError("");
    setAvailabilityError("");
    setAvailabilityLoaded(false);
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
        : current === "Pending";
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
      !wizardAvailabilityReady ||
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
    const typeIds = isWizard ? selectedTypeIdsKey.split(",") : [draft.roomTypeId];
    setRulesLoading(true);
    setRulesError("");
    Promise.all(typeIds.map(roomTypeId => apiRequest<EffectiveReservationRules>(
      `/admin/reservations/effective-rules?${new URLSearchParams({ propertyId: selectedPropertyId.toString(), roomTypeId })}`,
      { signal: controller.signal },
    )))
      .then((allRules) => {
        if (cancelled || controller.signal.aborted) return;
        const rules = allRules[0];
        const shouldResetAdults =
          pendingRoomCapacityResetRef.current === draft.roomTypeId;
        pendingRoomCapacityResetRef.current = null;
        setEffectiveRules(rules);
        setWizardRules(allRules);
        if (isWizard) return;
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
        if (cancelled || controller.signal.aborted) return;
        if (caught.name === "AbortError") return;
        setEffectiveRules(null);
        setRulesError(caught.message || "قوانین رزرو اتاق بارگذاری نشد.");
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setRulesLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    context,
    dialogOpen,
    draft.roomTypeId,
    selectedTypeIdsKey,
    isLockedEdit,
    selectedPropertyId,
    selectedRoomCount,
    isWizard,
    wizardAvailabilityReady,
    priceReviewVersion,
  ]);

  useEffect(() => {
    if (isWizard) return;
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
      setAvailabilityLoaded(false);
      setAvailabilityError("");
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
    setAvailabilityError("");
    setAvailabilityLoaded(false);
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
          setAvailabilityLoaded(true);
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
    isWizard,
  ]);

  useEffect(() => {
    guestSearchAbortRef.current?.abort();
    if (isEditMode || !dialogOpen || !guestBasePath || draft.guestSearch.trim().length < 2) {
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
  }, [dialogOpen, draft.guestSearch, guestBasePath, isEditMode]);

  useEffect(() => {
    pricePreviewAbortRef.current?.abort();
    const requestId = pricePreviewRequestId.current + 1;
    pricePreviewRequestId.current = requestId;

    if (!dialogOpen || context !== "admin" || isLockedEdit || !wizardAvailabilityReady) {
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
      (!isWizard || selectionsValid && selectedRoomCount === requestedRoomCount) &&
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
          ...(isWizard ? { forManualCreation: true, roomIds: draft.roomIds.map(Number), roomTypeSelections: typeSelections } : {}),
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
    draft.guestId,
    draft.roomTypeId,
    effectiveRules,
    hasValidDateRange,
    isLockedEdit,
    loadingRooms,
    selectedPropertyId,
    selectedRoomCount,
    selectedRoomIdsKey,
    typeSelectionsKey,
    selectionsValid,
    requestedRoomCount,
    rulesError,
    rulesLoading,
    isWizard,
    wizardAvailabilityReady,
  ]);

  async function addGuest() {
    if (isEditMode) return;
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
    if (isWizard) return; // Step navigation and Enter must never create an order.

    if (submitting || submissionInFlightRef.current) return;

    if (isTerminalReadOnly) {
      toast.error("رزرو نهایی‌شده قابل ویرایش نیست.");
      return;
    }

    if (isLockedEdit) {
      setConfirmCreateOpen(true);
      return;
    }

    if (!selectedPropertyId || (!isEditMode && !draft.guestId)) {
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
    if (isWizard && (wizardStep !== 3 || !stayInputsValid || !roomsReady)) return;
    if (createdOrder || submissionInFlightRef.current || submitting || pricePreviewLoading)
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

      const payload = buildReservationMutationPayload({
            ...(isWizard && hasOnRequest && hasInstant ? {} : { status: selectedStatus }),
            propertyId: selectedPropertyId,
            roomTypeId: Number(draft.roomTypeId),
            roomId: Number(draft.roomIds[0] ?? 0),
            guestId: isEditMode ? reservation?.guestId ?? null : Number(draft.guestId),
            checkInDate: draft.checkInDate,
            checkOutDate: draft.checkOutDate,
            adults: toPositiveInt(draft.adults, 1),
            children: toNonNegativeInt(draft.children),
            childAges: childAgesPayload(
              draft.childAges,
              toNonNegativeInt(draft.children),
            ),
            roomCount: selectedRoomCount,
            roomIds: draft.roomIds.map((id) => Number(id)),
            ...(isWizard ? { roomTypeSelections: typeSelections } : {}),
            guestType: draft.guestType,
            notes: draft.notes.trim() || null,
          });
      if (willRecordReceived && pricePreview) {
        const fingerprint = JSON.stringify({ payload, amount: pricePreview.finalAmount, currency: pricePreview.currency,
          roomAmounts: roomPrices.map(price => price.finalAmount), method: receiptMethod, reference: receiptReference.trim() });
        if (receivedSubmission.current?.fingerprint !== fingerprint) receivedSubmission.current = {
          fingerprint, key: crypto.randomUUID(), date: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
          }).format(new Date()),
        };
        payload.receivedPayment = { idempotencyKey: receivedSubmission.current.key, confirmedAmount: pricePreview.finalAmount,
          currency: pricePreview.currency, method: receiptMethod, referenceNumber: receiptReference.trim() || null,
          paymentDate: receivedSubmission.current.date };
        payload.reviewedRoomAmounts = roomPrices.map(price => price.finalAmount);
      }
      const result = await apiRequest<ManualBookingCreateResponse>(endpoint, {
        method: isEditMode ? "PUT" : "POST", body: JSON.stringify(payload),
      });

      toast.success(isEditMode ? "رزرو به‌روز شد." : "رزرو اضافه شد.");
      setConfirmCreateOpen(false);
      if (isWizard) {
        setCreatedOrder(result);
        try { await onCreated(); }
        catch { toast.warning("سفارش ثبت شد؛ فهرست رزروها را دوباره دریافت کنید."); }
      } else {
        setDialogOpen(false);
        await onCreated();
      }
    } catch (caught) {
      if (willRecordReceived && caught instanceof ApiRequestError && caught.status === 409 &&
          typeof caught.body === "object" && caught.body !== null && "code" in caught.body &&
          caught.body.code === "ManualBookingReviewChanged") {
        setPricePreview(null);
        setPriceReviewVersion(version => version + 1);
        setWizardStep(2);
        setSubmissionError(caught.message);
        toast.error(caught.message);
        return;
      }
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
        if (isWizard) {
          invalidateWizardAvailability();
          setWizardStep(1);
          setAvailabilityError("ظرفیت اتاق تغییر کرده است. لطفاً دوباره اتاق‌ها را بررسی کنید.");
        }
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
          isWizard && createdOrder ? <KoochButton type="button" onClick={() => setDialogOpen(false)}>بستن</KoochButton>
          : isWizard ? <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {wizardStep === 2 && <div className="grid w-full min-w-0 gap-1 text-sm">
              <p role="status" aria-live="polite" className="font-semibold text-foreground">
                {toPersianDigits(selectedRoomCount)} از {toPersianDigits(requestedRoomCount)} اتاق انتخاب شده
              </p>
              {selectedRoomSummary.length > 0 && <ul aria-label="خلاصه تخصیص اتاق‌ها" tabIndex={selectedRoomSummary.length > 4 ? 0 : undefined}
                className="grid max-h-24 gap-1 overflow-y-auto text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {selectedRoomSummary.map(option => <li className="break-words" key={option.roomTypeId}>
                  {option.name} × {toPersianDigits(option.quantity)}
                </li>)}
              </ul>}
            </div>}
            <KoochButton disabled={submitting} onClick={() => wizardStep === 1 ? setDialogOpen(false) : goToStep(wizardStep === 3 ? 2 : 1)} type="button" variant="outline">
              {wizardStep === 1 ? "انصراف" : "بازگشت"}
            </KoochButton>
            {wizardStep === 1 && stayInputHint && !loadingRooms && <p id="manual-stay-hint"
              className="min-w-0 flex-1 text-end text-xs leading-5 text-muted-foreground">{stayInputHint}</p>}
            {wizardStep < 3 ? <KoochButton type="button"
              aria-describedby={wizardStep === 1 && stayInputHint && !loadingRooms ? "manual-stay-hint" : undefined}
              loading={wizardStep === 1 && loadingRooms}
              disabled={wizardStep === 1 ? !stayInputsValid || loadingRooms : !roomsReady}
              onClick={() => wizardStep === 1 ? void checkWizardAvailability() : goToStep(3)}>
              {wizardStep === 1 ? "انتخاب اتاق‌ها" : "بررسی نهایی"}
            </KoochButton> : <KoochButton type="button" loading={submitting}
              disabled={!stayInputsValid || !roomsReady || submitting}
              onClick={async () => {
                if (wizardStep !== 3 || !stayInputsValid || !roomsReady) return;
                try { await createReservation(); }
                catch (caught) { setSubmissionError(caught instanceof Error ? caught.message : "ذخیره رزرو انجام نشد."); }
              }}>{willRecordReceived ? "ثبت دریافت کامل و تأیید رزرو" : "ثبت رزرو بدون دریافت وجه"}</KoochButton>}
          </div> : <>
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
        onOpenChange={next => { if (!submitting) setDialogOpen(next); }}
        open={dialogOpen}
        size={isWizard ? "md" : "lg"}
        className={isWizard ? styles.wizard : undefined}
        bodyClassName={isWizard ? styles.body : undefined}
        footerClassName={isWizard ? styles.footer : undefined}
        closeDisabled={submitting}
        title={createdOrder ? "سفارش دستی ثبت شد" : isEditMode ? "ویرایش رزرو" : "افزودن رزرو"}
      >
        {isWizard && !createdOrder && <NumberedSteps label="مراحل ایجاد رزرو" currentStep={wizardStep}
          labels={["اطلاعات اقامت", "انتخاب اتاق", "بررسی و ثبت"]} />}
        {isWizard && createdOrder ? <section aria-label="سفارش ثبت‌شده" className="grid gap-3" dir="rtl">
          <svg className={styles.savedCheck} viewBox="0 0 52 52" fill="none" aria-hidden="true">
            <circle cx="26" cy="26" r="24" />
            <path d="m15 27 7 7 15-16" />
          </svg>
          <h3 ref={stepHeadingRef} tabIndex={-1} className="font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring" role="status">سفارش با موفقیت ثبت شد.</h3>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-muted-foreground">شماره سفارش</dt><dd><bdi>{createdOrder.sessionCode}</bdi></dd></div>
            <div><dt className="text-muted-foreground">تعداد رزروها</dt><dd>{toPersianDigits(createdOrder.reservations.length)}</dd></div>
            <div><dt className="text-muted-foreground">مبلغ کل سفارش</dt><dd className="font-bold">{formatCurrency(createdOrder.totalAmount, {
              currencyLabel: createdOrder.currency === "IRR" ? "ریال" : createdOrder.currency,
            })}</dd></div>
          </dl>
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="رزروهای ایجادشده">
            {createdOrder.reservations.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="grid min-w-0 gap-1">
                <Link className="break-words text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/admin/reservations?reservationId=${item.id}`} onClick={() => setDialogOpen(false)}>
                  {item.reservationNumber} — {item.roomName || item.roomTypeName}
                </Link>
                <span>{formatCurrency(item.finalAmount, { currencyLabel: createdOrder.currency === "IRR" ? "ریال" : createdOrder.currency })}</span>
                <KoochBadge variant={item.status ? statusVariant(item.status) : "muted"}>
                  {item.status ? statusLabels[item.status] ?? item.status : "وضعیت در پاسخ موجود نیست"}
                </KoochBadge>
              </div>
              {canReviewCreated(item) &&
                <KoochButton type="button" variant="outline" size="sm" aria-label={`بررسی و تأیید رزرو ${item.reservationNumber}`}
                  onClick={() => { setDialogOpen(false); onReviewCreatedReservation?.(item.id); }}>بررسی و تأیید این رزرو</KoochButton>}
            </li>)}
          </ul>
          {createdOrder.reservations.some(canReviewCreated) && <p className="text-xs text-muted-foreground">تأیید از جزئیات همان رزرو انجام می‌شود؛ این اقدام مربوط به کل سفارش نیست.</p>}
        </section> : <form
          className="grid gap-3"
          id="manual-reservation-form"
          onSubmit={submitReservation}
        >
          {isWizard && <>
            <h3 className="text-base font-bold outline-none" ref={stepHeadingRef} tabIndex={-1}>
              {["اطلاعات اقامت و مهمانان", "اتاق‌های قابل رزرو", "بررسی و ثبت سفارش"][wizardStep - 1]}
            </h3>
            {submissionError && <KoochAlert title="ثبت سفارش انجام نشد" variant="destructive">{submissionError}</KoochAlert>}
            {wizardStep < 3 && excludedOptions.length > 0 && <KoochAlert title="گزینه‌های غیرقابل رزرو" variant="warning">
              <ul className="grid gap-2">
                {excludedOptions.map(option => <li key={option.roomTypeId}>
                  <strong>{option.name}: </strong>
                  {option.reason === "MissingNightlyPricing"
                    ? `قیمت معتبر برای شب‌های ${option.missingDates.map(toPersianDigits).join("، ")} ثبت نشده است.`
                    : option.reason === "NoEligibleNamedRooms"
                      ? "اتاق نام‌دار فعال و آزاد برای این نوع اتاق موجود نیست."
                      : option.reason === "GuestCapacityExceeded" ? "این نوع اتاق ظرفیت پذیرش یک بزرگسال را ندارد."
                      : "برای بازهٔ انتخاب‌شده موجودی قابل فروش ندارد."}
                </li>)}
              </ul>
            </KoochAlert>}
          </>}
          {showReview && (!isWizard || (!isTerminalReadOnly && !willRecordReceived && statusSelectionOptions.length > 1)) && <KoochCard className="grid gap-3" padding="sm" variant="muted">
            {!isWizard && <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-muted-foreground">
                  وضعیت رزرو
                </p>
                <div className="mt-2">
                  <KoochBadge variant={statusVariant(willRecordReceived ? "Confirmed" : displayedStatus)}>
                    {statusLabels[willRecordReceived ? "Confirmed" : displayedStatus] ?? displayedStatus}
                  </KoochBadge>
                </div>
              </div>
              <p className="max-w-md text-xs font-semibold leading-6 text-muted-foreground">
                {willRecordReceived ? "پس از ثبت رسید دریافت کامل، تمام رزروهای این سفارش تأیید می‌شوند." : isEditMode
                  ? "فقط وضعیت‌های مجاز بازگشتی از گردش‌کار قابل انتخاب هستند. تغییر انتخاب‌شده همراه ذخیره اعمال می‌شود."
                  : "وضعیت پیش‌فرض از نوع رزرو اتاق تعیین می‌شود. فقط وضعیت‌های مجاز ثبت دستی قابل انتخاب هستند."}
              </p>
            </div>}
            {!isTerminalReadOnly && !willRecordReceived && statusSelectionOptions.length > (isWizard ? 1 : 0) && (
              <div role="group" aria-label="انتخاب وضعیت رزرو" className="flex flex-wrap gap-2 border-t border-border pt-3">
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
          </KoochCard>}

          {isEditMode && (
            <section aria-label="اطلاعات مهمان ثبت‌شده" className="grid gap-2">
              <h3 className="text-sm font-semibold text-foreground">مهمان ثبت‌شده</h3>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">نام مهمان</dt>
                  <dd className="break-words text-foreground">
                    {reservation?.guestFullName || reservation?.guestName || "—"}
                  </dd>
                </div>
                {reservation?.guestMobile && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">موبایل</dt>
                    <dd className="break-words text-foreground">{reservation.guestMobile}</dd>
                  </div>
                )}
                {reservation?.guestEmail && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">ایمیل</dt>
                    <dd className="break-words text-foreground">{reservation.guestEmail}</dd>
                  </div>
                )}
                {reservation?.guestNationalCode && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">کد ملی</dt>
                    <dd className="break-words text-foreground">{reservation.guestNationalCode}</dd>
                  </div>
                )}
              </dl>
              <p className="text-xs text-muted-foreground">
                اطلاعات مهمان ثبت‌شده در این فرم قابل تغییر نیست.
              </p>
            </section>
          )}

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
                {isWizard && showRooms && selectedRoomCount === 0 && <p role="status" className="text-sm text-muted-foreground md:col-span-2">
                  نوع و تعداد واحد یا اتاق‌های نام‌دار را انتخاب کنید؛ قوانین و قیمت پس از انتخاب نمایش داده می‌شوند.
                </p>}
                {showRooms && (!isWizard || selectedRoomCount > 0) && (rulesLoading ? (
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
                ) : isWizard && wizardRules.length > 1 ? (
                  <div className="grid gap-3 md:col-span-2 sm:grid-cols-2">
                    {wizardRules.map(rules => {
                      const summary = buildChildRuleSummary(rules, previewCurrencyLabel);
                      return <section key={rules.roomTypeId} className="rounded-lg border border-border bg-muted p-3 text-xs leading-6">
                        <h3 className="font-bold">{manualOptions.find(option => option.roomTypeId === rules.roomTypeId)?.name}</h3>
                        <p>{summary.freeChildText}</p><p>{summary.childPricingText}</p>
                        <p>{summary.adultText}</p><p>{summary.roomText}</p>
                      </section>;
                    })}
                  </div>
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
                ))}

                {context === "admin" && showStay && (
                  <KoochField className={isWizard ? "md:col-span-2" : undefined} label="اقامتگاه" required>
                    <KoochSearchableSelect
                      disabled={isLockedEdit}
                      emptyText="اقامتگاهی پیدا نشد."
                      onChange={(value) => {
                        if (value === draft.propertyId) return;
                        if (isWizard) {
                          invalidateWizardAvailability();
                          setDraft(current => ({ ...current, propertyId: value, roomTypeId: "", roomIds: [], typeQuantities: {} }));
                          return;
                        }
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

                {!isEditMode && showStay && (
                  <KoochField className="md:col-span-2" label="مهمان" required>
                    <div className={isWizard ? styles.guestRow : "grid gap-2 sm:grid-cols-[1fr_auto]"}>
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
                )}

                {showStay && <KoochField
                  className={`md:col-span-2 ${isWizard ? styles.stayDates : ""}`}
                  label="بازه اقامت"
                  required
                >
                  <KoochDatePicker
                    {...(isWizard ? { combinedField: true, showCombinedFieldLabels: true, fieldSize: "compact" as const } : {})}
                    labels={{ start: "ورود", end: "خروج" }}
                    mode="range"
                    minDate={isEditMode ? undefined : todayIsoDate()}
                    openOnDialog
                    dialogContentClassName="!h-auto !max-h-[calc(100vh-2rem)] !grid-rows-[auto_minmax(0,auto)_auto]"
                    dialogBodyClassName={isWizard ? "!py-3" : "!overflow-visible !py-4"}
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
                      if (isWizard) {
                        invalidateWizardAvailability();
                        setDraft(current => ({ ...current, checkInDate: nextCheckInDate, checkOutDate: nextCheckOutDate }));
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
                        adults: isWizard ? current.adults : initialDraft.adults,
                      }));
                    }}
                    placeholderEnd={isWizard ? "انتخاب تاریخ" : ""}
                    placeholderStart={isWizard ? "انتخاب تاریخ" : ""}
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
                </KoochField>}

                {isWizard && showStay && <div className="md:col-span-2" aria-live="polite" aria-busy={loadingRooms}>
                  {loadingRooms ? <p role="status" className="text-sm text-muted-foreground">در حال دریافت اتاق‌های موجود…</p>
                    : availabilityError ? <KoochAlert title="خطا در دریافت اتاق‌ها" variant="destructive">
                      <p>{availabilityError}</p>
                      <KoochButton type="button" size="sm" variant="outline" disabled={!stayInputsValid}
                        onClick={() => void checkWizardAvailability()}>تلاش دوباره برای دریافت اتاق‌ها</KoochButton>
                    </KoochAlert>
                    : availabilityLoaded && manualOptions.length === 0 && excludedOptions.length === 0 ? <p role="status" className="text-sm text-muted-foreground">برای این اقامتگاه در بازهٔ انتخاب‌شده اتاق قابل رزرو نیست.</p> : null}
                </div>}

                {showRooms && <div className="grid gap-3 md:col-span-2" aria-busy={loadingRooms}>
                  {isWizard && manualOptions.some(option => option.inventoryMode === "TypeBasedInventory") && <div className="grid gap-2">
                    <KoochField label="نوع اتاق">
                      <KoochMultiSelect
                        id="manual-room-types"
                        floating
                        options={manualOptions.filter(option => option.inventoryMode === "TypeBasedInventory").map(option => {
                          return { value: String(option.roomTypeId), label: option.name, searchText: option.name,
                            description: <span className="flex flex-wrap gap-x-3 gap-y-1">
                              <span>ظرفیت پایه: {option.baseCapacity != null ? `${toPersianDigits(option.baseCapacity)} نفر` : "نامشخص"}</span>
                              <span>نفر اضافه: {option.maxExtraGuests != null ? `${toPersianDigits(option.maxExtraGuests)} نفر` : "نامشخص"}</span>
                              <span>{toPersianDigits(option.availableCount)} واحد موجود</span>
                            </span>,
                            disabled: !selectedTypeOptions.some(selected => selected.roomTypeId === option.roomTypeId) &&
                              (option.availableCount <= 0 || selectedRoomCount >= requestedRoomCount),
                          };
                        })}
                        value={selectedTypeOptions.map(option => String(option.roomTypeId))}
                        onChange={values => {
                          const selected = new Set(values.map(String));
                          for (const option of manualOptions.filter(option => option.inventoryMode === "TypeBasedInventory")) {
                            const id = String(option.roomTypeId);
                            const quantity = toNonNegativeInt(draft.typeQuantities[id] ?? "0");
                            if (!selected.has(id) && quantity > 0) updateTypeSelection(id, "0");
                            else if (selected.has(id) && quantity === 0 && option.availableCount > 0 && selectedRoomCount < requestedRoomCount)
                              updateTypeSelection(id, "1");
                          }
                        }}
                        showBulkActions={false}
                        placeholder="انتخاب نوع اتاق"
                        searchPlaceholder="جستجوی نوع اتاق..."
                        emptyText="نوع اتاقی با این جستجو پیدا نشد."
                        dropdownClassName={styles.typePickerPanel}
                      />
                    </KoochField>
                    {selectedTypeOptions.map(option => {
                      const quantity = toNonNegativeInt(draft.typeQuantities[option.roomTypeId] ?? "0");
                      return <div key={option.roomTypeId} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                        <div className="grid min-w-0 gap-1">
                          <p className="break-words text-sm font-semibold text-foreground">{option.name}</p>
                          <p className="text-xs text-muted-foreground">{toPersianDigits(option.availableCount)} واحد موجود</p>
                        </div>
                        <div role="group" aria-label={`انتخاب ${option.name}`} className="flex shrink-0 items-center gap-2" dir="ltr">
                          {quantity > 0 && <>
                            <KoochButton type="button" size="icon" variant="outline" aria-label={quantity === 1 ? `حذف ${option.name}` : `کاهش تعداد ${option.name}`}
                              onClick={() => {
                                updateTypeSelection(String(option.roomTypeId), String(quantity - 1));
                                if (quantity === 1) window.requestAnimationFrame(() => document.getElementById("manual-room-types")?.focus());
                              }}>
                              {quantity === 1 ? <KoochIcon name="delete" className="!h-4 !w-4" /> : <span aria-hidden="true">−</span>}
                            </KoochButton>
                            <output aria-label={`تعداد ${option.name}`} aria-live="polite" aria-atomic="true"
                              className="min-w-6 text-center text-sm font-semibold tabular-nums">{toPersianDigits(quantity)}</output>
                          </>}
                          <KoochButton type="button" size="icon" variant="outline" data-room-increase aria-label={`افزایش تعداد ${option.name}`}
                            disabled={!availabilityLoaded || loadingRooms || quantity >= option.availableCount || selectedRoomCount >= requestedRoomCount}
                            onClick={() => updateTypeSelection(String(option.roomTypeId), String(quantity + 1))}>
                            <span aria-hidden="true">+</span>
                          </KoochButton>
                        </div>
                      </div>;
                    })}
                  </div>}
                  {!isEditMode && !isWizard && <>
                    {!selectedPropertyId || !hasValidDateRange ? <p role="status" className="text-sm text-muted-foreground">ابتدا اقامتگاه و بازهٔ معتبر اقامت را انتخاب کنید.</p>
                      : loadingRooms ? <p role="status" className="text-sm text-muted-foreground">در حال دریافت اتاق‌های موجود…</p>
                      : availabilityError ? <KoochAlert title="خطا در دریافت اتاق‌ها" variant="destructive">
                        <p>{availabilityError}</p>
                        <KoochButton type="button" size="sm" variant="outline" onClick={() => setAvailabilityReloadKey(value => value + 1)}>تلاش دوباره برای دریافت اتاق‌ها</KoochButton>
                      </KoochAlert>
                      : availabilityLoaded && rooms.length === 0 ? <p role="status" className="text-sm text-muted-foreground">برای این اقامتگاه و بازهٔ اقامت، اتاق قابل رزرو موجود نیست. تاریخ‌ها را تغییر دهید.</p> : null}
                  </>}
                  {(!isWizard || rooms.length > 0) && <KoochField label="اتاق" required>
                  {!isEditMode ? (
                    <KoochMultiSelect
                      disabled={!selectedPropertyId || loadingRooms || nightsCount <= 0 || Boolean(availabilityError) || !availabilityLoaded || rooms.length === 0}
                      options={isWizard ? roomOptions.map(option => ({ ...option,
                        disabled: !draft.roomIds.includes(String(option.value)) && selectedRoomCount >= requestedRoomCount }))
                        : roomOptions.filter(option => !draft.roomIds.length ||
                        rooms.find(room => room.roomId.toString() === String(option.value))?.roomTypeId.toString() === draft.roomTypeId)}
                      value={draft.roomIds}
                      onChange={value => updateSelectedRooms(value.map(String))}
                      placeholder="انتخاب اتاق‌ها"
                      searchPlaceholder="جستجوی اتاق..."
                      emptyText="اتاقی با این جستجو پیدا نشد."
                    />
                  ) : (
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
                  )}
                  </KoochField>}
                  {!isEditMode && !isWizard && draft.roomIds.length > 0 && <p className="text-xs text-muted-foreground">انتخاب چند اتاق از همین نوع اتاق ممکن است؛ برای تغییر نوع، انتخاب‌ها را پاک کنید.</p>}
                </div>}

                {isWizard && showStay && <div className={`${styles.guestFields} md:col-span-2`}>
                  <GuestSelector label="مهمانان و اتاق‌ها" floating requireChildAges defaultChildAge=""
                    maxRooms={100} maxAdults={100} maxChildren={100}
                    controlClassName="h-[52px] w-full px-3 text-right text-xs"
                    value={{ rooms: requestedRoomCount, adults: toPositiveInt(draft.adults, 1),
                      children: toNonNegativeInt(draft.children), childAges: draft.childAges }}
                    onChange={updateWizardGuests} />
                    <KoochField label="نوع مهمان"><KoochSelect className="h-[52px]" value={draft.guestType} onChange={event => {
                      invalidateWizardAvailability(); updateDraft("guestType", event.target.value as PricingGuestType);
                    }}><option value="Iranian">ایرانی</option><option value="Foreign">خارجی</option></KoochSelect></KoochField>
                  {Number(draft.children) > 0 && <p className={`${styles.guestHint} text-xs text-muted-foreground`}>سن واقعی هر کودک لازم است؛ ظرفیت و هزینه در انتخاب اتاق بررسی می‌شود.</p>}
                </div>}
                {showStay && !isWizard && <KoochField
                  helperText={
                    isWizard ? "تعداد بزرگسالان را وارد کنید؛ ظرفیت و ترکیب مهمانان در مرحلهٔ انتخاب اتاق بررسی می‌شود." : effectiveRules?.extraGuestAllowed
                      ? `ظرفیت پایه: ${new Intl.NumberFormat("fa-IR").format(selectedRoomBaseAdults)}؛ حداکثر با نفر اضافه: ${new Intl.NumberFormat("fa-IR").format(selectedRoomMaxAdults)}`
                      : effectiveRules
                        ? "این اتاق نفر اضافه نمی‌پذیرد."
                        : "ابتدا اتاق را انتخاب کنید."
                  }
                  label="بزرگسالان"
                >
                  <KoochInput
                    disabled={!isWizard && (
                      isLockedEdit ||
                      rulesLoading ||
                      Boolean(rulesError) ||
                      !effectiveRules
                    )}
                    max={isWizard ? 100 : maximumSelectableAdults}
                    min={1}
                    onChange={(event) => {
                      if (isWizard) { updateDraft("adults", event.target.value); return; }
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
                </KoochField>}

                {showStay && !isWizard && <KoochField
                  helperText={
                    isWizard ? "سن واقعی هر کودک از صفر تا ۱۷ سال لازم است؛ هزینه بر اساس قوانین اتاق محاسبه می‌شود." : effectiveRules
                      ? `حداکثر ${formatAge(maxDeclaredChildren)} کودک؛ کودک رایگان و نیم‌بها از ظرفیت بزرگسال کم نمی‌کند.`
                      : "پس از بارگذاری قوانین اتاق، شرایط کودک نمایش داده می‌شود."
                  }
                  label="کودکان"
                >
                  <div className="grid gap-3">
                    <KoochInput
                      aria-label={isWizard ? "تعداد کودکان" : undefined}
                      max={isWizard ? 100 : maxDeclaredChildren}
                      min={0}
                      disabled={!isWizard && (
                        isLockedEdit ||
                        rulesLoading ||
                        !effectiveRules ||
                        Boolean(rulesError)
                      )}
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
                              {isWizard ? <KoochField label={`سن کودک ${index + 1}`} required>
                                <KoochInput type="number" min={0} max={17} value={age}
                                  onChange={event => updateChildAge(index, event.target.value)} />
                              </KoochField> : <div
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
                              </div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </KoochField>}

                {showStay && !isWizard && <KoochField label="نوع مهمان">
                  <KoochSelect
                    disabled={isLockedEdit}
                    onChange={(event) =>
                      { if (isWizard) invalidateWizardAvailability();
                        updateDraft("guestType", event.target.value as PricingGuestType); }
                    }
                    value={draft.guestType}
                  >
                    <option value="Iranian">ایرانی</option>
                    <option value="Foreign">خارجی</option>
                  </KoochSelect>
                </KoochField>}
              </div>

              {showRooms && hasOnRequest && (
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

              {showRooms && (!isWizard || selectedRoomCount > 0) && <KoochCard className="grid gap-3" padding="sm" variant="elevated">
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
                        currencyLabel: previewCurrencyLabel,
                      })}
                    </span>
                    <span>
                      هزینه کودک:{" "}
                      {formatCurrency(pricePreview.childAmount, {
                        currencyLabel: previewCurrencyLabel,
                      })}
                    </span>
                    <span>
                      هزینه نفر اضافه:{" "}
                      {formatCurrency(pricePreview.extraGuestAmount, {
                        currencyLabel: previewCurrencyLabel,
                      })}
                    </span>
                    <span>
                      تخفیف پروموشن:{" "}
                      {formatCurrency(pricePreview.discountAmount, {
                        currencyLabel: previewCurrencyLabel,
                      })}
                    </span>
                    <span className="font-bold">
                      مبلغ کل:{" "}
                      {formatCurrency(pricePreview.finalAmount, {
                        currencyLabel: previewCurrencyLabel,
                      })}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-muted-foreground">
                    برای محاسبه قیمت، تاریخ و اتاق را انتخاب کنید.
                  </p>
                )}
              </KoochCard>}
              {isWizard && wizardStep === 2 && pricePreview && !pricePreviewLoading && roomPrices.length !== selectedRoomCount &&
                <KoochAlert title="تفکیک قیمت آماده نیست" variant="warning">نسخهٔ فعلی سرور تفکیک قیمت اتاق‌ها را برنمی‌گرداند. پس از به‌روزرسانی سرور دوباره تلاش کنید.</KoochAlert>}
            </>
          )}

          {isWizard && wizardStep === 3 && <section aria-label="خلاصه سفارش دستی" className="grid gap-3">
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">اقامتگاه</dt><dd className="font-semibold">{properties.find(property => property.id === selectedPropertyId)?.name}</dd></div>
              <div><dt className="text-muted-foreground">مهمان</dt><dd>{selectedGuest ? guestName(selectedGuest) : draft.guestSearch}</dd></div>
              <div><dt className="text-muted-foreground">ورود</dt><dd><time dateTime={draft.checkInDate}>{displayDateParts(draft.checkInDate, "jalali").date}</time></dd></div>
              <div><dt className="text-muted-foreground">خروج</dt><dd><time dateTime={draft.checkOutDate}>{displayDateParts(draft.checkOutDate, "jalali").date}</time></dd></div>
              <div><dt className="text-muted-foreground">مهمانان</dt><dd>{toPersianDigits(draft.adults)} بزرگسال، {toPersianDigits(draft.children)} کودک</dd></div>
            </dl>
            <ul aria-label="قیمت اتاق‌های انتخاب‌شده" className="divide-y divide-border rounded-lg border border-border">
              {selectedRoomNames.map((name, index) => <li key={draft.roomIds[index] ?? `${draft.roomTypeId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>{name}</span>
                <strong>{roomPrices[index] ? formatCurrency(roomPrices[index].finalAmount, { currencyLabel: roomPrices[index].currency === "IRR" ? "ریال" : roomPrices[index].currency }) : "قیمت آماده نیست"}</strong>
              </li>)}
            </ul>
            <p className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 font-bold"><span>مبلغ کل سفارش</span><span>{pricePreview ? formatCurrency(pricePreview.finalAmount, { currencyLabel: pricePreview.currency === "IRR" ? "ریال" : pricePreview.currency }) : "قیمت آماده نیست"}</span></p>
            <fieldset className="grid gap-2" disabled={submitting} aria-labelledby="manual-mode-label">
              <div className="flex items-center gap-2 text-sm font-semibold"><span id="manual-mode-label">نحوه ثبت رزرو</span>
                <KoochInfoHint ariaLabel="توضیح نحوه ثبت رزرو" constrainToViewport content={<div className="grid gap-2">
                  <p>ثبت بدون دریافت وجه فقط سفارش و رزروهای آن را ایجاد می‌کند؛ رسید یا پرداختی ثبت نمی‌شود و رزروها تأیید نشده‌اند. آماده‌سازی برای پرداخت، اقدام جداگانه‌ای است. رزروهای درخواستی در انتظار تأیید می‌مانند.</p>
                  <p>ثبت دریافت کامل: وجه کاملِ از قبل دریافت‌شده با یک رسید ثبت و بین رزروها تخصیص داده می‌شود؛ همهٔ رزروهای سفارش تأیید می‌شوند. از مهمان وجهی برداشت نمی‌شود. تاریخ رسید، امروز به وقت ایران است.</p>
                  <p>برای هر اتاق یک رزرو جدا ایجاد می‌شود. ظرفیت و قیمت هنگام ثبت دوباره در سرور بررسی می‌شوند.</p>
                </div>} />
              </div>
              <div className="grid gap-x-4 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="manual-create-payment"
                checked={!willRecordReceived} onChange={() => setRecordReceived(false)} />ثبت رزرو بدون دریافت وجه</label>
              {canReceiveFull && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="manual-create-payment"
                checked={willRecordReceived} onChange={() => setRecordReceived(true)} />ثبت دریافت کامل و تأیید رزرو</label>}
              </div>
              {willRecordReceived && <>
                <div className="grid gap-2 sm:grid-cols-2"><ManualReceiptFields method={receiptMethod} reference={receiptReference}
                  onMethodChange={setReceiptMethod} onReferenceChange={setReceiptReference} disabled={submitting} /></div>
              </>}
            </fieldset>
          </section>}
          {showReview && <KoochField label="یادداشت داخلی">
            <KoochTextarea
              disabled={isTerminalReadOnly}
              onChange={(event) => updateDraft("notes", event.target.value)}
              rows={isWizard ? 2 : 3}
              value={draft.notes}
            />
          </KoochField>}
        </form>}
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
                  ? toPersianDigits(confirmationRoomNames.join("، "))
                  : "-"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">ورود</span>
              <span className="font-bold text-foreground">
                {toPersianDigits(draft.checkInDate || "-")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">خروج</span>
              <span className="font-bold text-foreground">
                {toPersianDigits(draft.checkOutDate || "-")}
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
        open={guestDialogOpen && !isEditMode}
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
