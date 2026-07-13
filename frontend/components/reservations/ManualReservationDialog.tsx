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
      rules.halfPriceChildMinAge !== null &&
      rules.halfPriceChildMaxAge !== null
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

function childAgeOptions(rules: EffectiveReservationRules) {
  const halfPriceMinAge =
    rules.halfPriceChildMinAge ??
    (rules.freeChildMaxAge !== null ? rules.freeChildMaxAge + 1 : 1);
  const halfPriceMaxAge = rules.halfPriceChildMaxAge ?? 17;
  const maximumOptionAge = Math.min(
    120,
    Math.max(18, halfPriceMaxAge + 1, (rules.freeChildMaxAge ?? 0) + 1),
  );

  return Array.from({ length: maximumOptionAge }, (_, index) => {
    const age = index + 1;
    const category =
      age < halfPriceMinAge
        ? "رایگان"
        : age <= halfPriceMaxAge
          ? "نیم‌بها"
          : age > halfPriceMaxAge
            ? "بزرگسال"
            : "رایگان";

    return { age, label: `${formatAge(age)} سال — ${category}` };
  });
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

function roomOptionDescription(
  room: AvailableRoomResponse,
) {
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
  const [savingGuest, setSavingGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pricePreviewRequestId = useRef(0);
  const availabilityAbortRef = useRef<AbortController | null>(null);
  const rulesAbortRef = useRef<AbortController | null>(null);
  const pricePreviewAbortRef = useRef<AbortController | null>(null);
  const guestSearchAbortRef = useRef<AbortController | null>(null);
  const submissionInFlightRef = useRef(false);
  const isEditMode = mode === "edit";
  const dialogOpen = isEditMode ? Boolean(controlledOpen) : open;
  const isLockedEdit =
    isEditMode &&
    reservation?.status !== undefined &&
    ["Paid", "Completed"].includes(reservation.status);

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
  const selectedRoomNames = draft.roomIds
    .map((id) =>
      rooms.find((room) => room.roomId.toString() === id)?.roomName,
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
    ? selectedRoomBaseAdults +
      effectiveRules.maxExtraGuests * selectedRoomCount
    : selectedRoomBaseAdults;
  const maxDeclaredChildren = effectiveRules
    ? effectiveRules.maxDeclaredChildren * selectedRoomCount
    : 0;
  const selectedRoomIdsKey = draft.roomIds.join(",");
  const childAgesKey = draft.childAges.join(",");
  const hasValidDateRange = nightsCount > 0;
  const hasOnRequest = draft.roomIds.some(
    (id) =>
      rooms.find((room) => room.roomId.toString() === id)?.bookingMode ===
      "OnRequest",
  );
  const childRuleSummary = effectiveRules
    ? buildChildRuleSummary(effectiveRules, currencyLabel)
    : null;
  const availableChildAges = effectiveRules
    ? childAgeOptions(effectiveRules)
    : [];
  const confirmationTotal =
    pricePreview?.finalAmount ??
    reservation?.totalPrice ??
    reservation?.finalAmount ??
    null;
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
    const originalRoomName =
      reservation.roomName ?? reservation.roomTypeName ?? "-";
    const updatedRoomName =
      confirmationRoomNames.length > 0
        ? confirmationRoomNames.join("، ")
        : "-";
    const originalGuestCount = `${reservation.adults ?? 0} بزرگسال، ${reservation.children ?? 0} کودک`;
    const updatedGuestCount = `${toPositiveInt(draft.adults, 1)} بزرگسال، ${toNonNegativeInt(draft.children)} کودک`;
    const originalTotal = reservation.totalPrice ?? reservation.finalAmount;

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
      pricePreview.finalAmount !== originalTotal
    ) {
      editChangeSummary.push({
        label: "مبلغ کل",
        before: formatCurrency(originalTotal, { currencyLabel }),
        after: formatCurrency(pricePreview.finalAmount, { currencyLabel }),
      });
    }
    if (draft.notes.trim() !== (reservation.notes ?? "").trim()) {
      editChangeSummary.push({
        label: "یادداشت داخلی",
        before: reservation.notes?.trim() || "-",
        after: draft.notes.trim() || "-",
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
      [...rooms]
        .sort(
          (first, second) =>
            first.baseCapacity - second.baseCapacity ||
            first.roomName.localeCompare(second.roomName, "fa"),
        )
        .map((room) => ({
          value: room.roomId,
          label: room.roomName,
          group: `ظرفیت ${new Intl.NumberFormat("fa-IR").format(room.baseCapacity)} نفر`,
          description: (
            <span className="inline-flex w-fit rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-foreground ring-1 ring-inset ring-primary/30">
              {roomOptionDescription(room)}
            </span>
          ),
          searchText: `${room.roomName} ظرفیت ${room.baseCapacity} ${roomOptionDescription(room)}`,
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
    rulesAbortRef.current?.abort();
    pricePreviewAbortRef.current?.abort();
    const selectedRooms = value
      .map((id) => rooms.find((room) => room.roomId.toString() === id))
      .filter((room): room is AvailableRoomResponse => Boolean(room));
    const roomTypeId = selectedRooms[0]?.roomTypeId?.toString() ?? "";
    const roomIds = roomTypeId
      ? selectedRooms
          .filter((room) => room.roomTypeId.toString() === roomTypeId)
          .map((room) => room.roomId.toString())
      : [];
    setEffectiveRules(null);
    setRulesError("");
    setPricePreview(null);
    setPricePreviewLoading(false);
    pricePreviewRequestId.current += 1;
    setDraft((current) => ({
      ...current,
      roomTypeId,
      roomIds,
      adults: initialDraft.adults,
      children: initialDraft.children,
      childAges: [],
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
    setPricePreviewError("");
    setEffectiveRules(null);
    setRulesLoading(false);
    setRulesError("");
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
  }, [context, dialogOpen, fixedPropertyId, isEditMode, reservation]);

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
            adults: Math.min(
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
  }, [context, dialogOpen, draft.roomTypeId, isLockedEdit, selectedPropertyId, selectedRoomCount]);

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

    setRooms([]);
    setPricePreview(null);
    setPricePreviewLoading(false);
    pricePreviewRequestId.current += 1;
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
          setDraft((current) => {
            const selectedRoomStillAvailable = current.roomIds.every((id) =>
              availableRooms.some((room) => room.roomId.toString() === id),
            );
            return selectedRoomStillAvailable
              ? current
              : {
                  ...current,
                  roomTypeId: "",
                  roomIds: [],
                  adults: initialDraft.adults,
                };
          });
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

    if (
      !dialogOpen ||
      context !== "admin" ||
      isLockedEdit ||
      !selectedPropertyId ||
      !draft.roomTypeId ||
      !effectiveRules ||
      rulesLoading ||
      Boolean(rulesError) ||
      !hasValidDateRange ||
      selectedRoomCount <= 0 ||
      normalizeChildAges(
        draft.childAges,
        toNonNegativeInt(draft.children),
      ).some((age) => age.trim() === "")
    ) {
      setPricePreview(null);
      setPricePreviewLoading(false);
      setPricePreviewError("");
      return;
    }

    setPricePreview(null);
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
    if (submissionInFlightRef.current || submitting || pricePreviewLoading) return;
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
        body: JSON.stringify({
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
              انصراف
            </KoochButton>
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
          {isLockedEdit ? (
            <KoochAlert title="رزرو پرداخت‌شده یا تکمیل‌شده" variant="warning">
              اتاق، تاریخ، تعداد مهمان و قیمت این رزرو قابل تغییر نیست. فقط
              یادداشت داخلی را می‌توانید ویرایش کنید.
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
              <KoochAlert className="md:col-span-2" title="خطا در قوانین اتاق" variant="destructive">
                {rulesError}
              </KoochAlert>
            ) : childRuleSummary ? (
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
                minDate={isEditMode ? undefined : todayIsoDate()}
                openOnDialog
                dialogContentClassName="!h-auto !max-h-[calc(100vh-2rem)] !grid-rows-[auto_minmax(0,auto)_auto]"
                dialogBodyClassName="!overflow-visible !py-4"
                dialogFooterClassName="!py-3 "
                onChange={(value) => {
                  if (isLockedEdit) return;
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

            <KoochField className="md:col-span-2" label="اتاق" required>
              <KoochSearchableSelect
                disabled={
                  isLockedEdit ||
                  !selectedPropertyId ||
                  loadingRooms ||
                  nightsCount <= 0
                }
                emptyText="برای بازه انتخاب‌شده اتاقی موجود نیست."
                onChange={(value) => updateSelectedRooms(value ? [value] : [])}
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
                max={selectedRoomMaxAdults}
                min={1}
                onChange={(event) => {
                  const nextAdults = Math.max(
                    1,
                    Math.min(
                      toPositiveInt(event.target.value, 1),
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
              helperText={
                effectiveRules
                  ? `حداکثر ${formatAge(maxDeclaredChildren)} کودک؛ سن هر کودک را از فهرست قانون موثر انتخاب کنید.`
                  : "پس از بارگذاری قوانین اتاق، شرایط کودک نمایش داده می‌شود."
              }
              label="کودکان"
            >
              <div className="grid gap-3">
                <KoochInput
                  max={maxDeclaredChildren}
                  min={0}
                  disabled={isLockedEdit || rulesLoading || !effectiveRules || Boolean(rulesError)}
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
                        <KoochSelect
                          aria-label={`سن کودک ${index + 1}`}
                          key={index}
                          disabled={
                            isLockedEdit ||
                            rulesLoading ||
                            !effectiveRules ||
                            Boolean(rulesError)
                          }
                          onChange={(event) =>
                            updateChildAge(index, event.target.value)
                          }
                          value={age}
                        >
                          <option value="">
                            {`سن کودک ${new Intl.NumberFormat("fa-IR").format(index + 1)}`}
                          </option>
                          {availableChildAges.map((option) => (
                            <option key={option.age} value={option.age}>
                              {option.label}
                            </option>
                          ))}
                        </KoochSelect>
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
            <KoochAlert title="ظرفیت مهمانان نامعتبر است" variant="destructive">
              {pricePreviewError}
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
                  {formatCurrency(pricePreview.baseAmount, { currencyLabel })}
                </span>
                <span>
                  هزینه کودک:{" "}
                  {formatCurrency(pricePreview.childAmount, { currencyLabel })}
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
                <span className="font-black">
                  مبلغ کل:{" "}
                  {formatCurrency(pricePreview.finalAmount, { currencyLabel })}
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
        {isEditMode && (
          <KoochAlert title="خلاصه تغییرات نهایی" variant="warning">
            {editChangeSummary.length > 0 ? (
              <div className="grid gap-3 text-right" dir="rtl">
                {editChangeSummary.map((change) => (
                  <div
                    className="grid gap-1 border-b border-current/20 pb-2 last:border-0 last:pb-0"
                    key={change.label}
                  >
                    <span className="font-black">{change.label}</span>
                    <span>قبل: {change.before}</span>
                    <span>بعد: {change.after}</span>
                  </div>
                ))}
              </div>
            ) : (
              "تغییری در اطلاعات رزرو ثبت نشده است."
            )}
          </KoochAlert>
        )}
        <KoochAlert title="مرور نهایی رزرو" variant="default">
          <div className="grid gap-2 text-right text-sm" dir="rtl">
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
              {formatCurrency(confirmationTotal, { currencyLabel })}
            </span>
          </div>
          </div>
        </KoochAlert>
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
