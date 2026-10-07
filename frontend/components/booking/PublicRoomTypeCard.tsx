"use client";

import Image from "next/image";
import { KoochButton } from "@/components/KoochButton";
import { bookingModePresentation } from "@/components/booking/booking-display";
import type { PublicBookingRatePlanOption, PublicBookingRoomTypeOption } from "@/lib/booking-sessions";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";
import { formatPrice, type PublicRoomType } from "@/lib/public-properties";

export type RoomTypeUnavailableReason =
  | "GuestCapacityExceeded"
  | "NoActiveNamedRooms"
  | "InsufficientAvailability"
  | "IncompleteDailyPricing";

export interface PublicRoomTypeBookingState {
  option: PublicBookingRoomTypeOption | null;
  unavailableReason?: RoomTypeUnavailableReason;
  availableToAdd: number;
  selectedQuantity: number;
  totalSelectedQuantity: number;
  onAdd: () => void;
  onRemove: () => void;
  ratePlans: Array<PublicBookingRatePlanOption & {
    selectedQuantity: number;
    onAdd: () => void;
    onRemove: () => void;
  }>;
}

export function PublicRoomTypeCard({
  roomType,
  galleryFallback,
  booking,
  onShowDetails,
}: {
  roomType: PublicRoomType;
  galleryFallback: string;
  booking?: PublicRoomTypeBookingState;
  onShowDetails: () => void;
}) {
  const currencyLabel = useSiteCurrencyLabel();
  const ratePlanOption = booking?.option;
  const details = [
    roomType.floorNumber != null ? `طبقه ${roomType.floorNumber}` : "",
    roomType.stairCount != null ? `${roomType.stairCount} پله` : "",
    roomType.hasPrivateBathroom == null
      ? ""
      : roomType.hasPrivateBathroom
        ? "سرویس بهداشتی اختصاصی"
        : "سرویس مشترک",
    roomType.hasWindow == null
      ? ""
      : roomType.hasWindow
        ? "دارای پنجره"
        : "بدون پنجره",
  ].filter(Boolean);

  return (
    <article
      className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm"
      data-testid={`room-type-card-${roomType.id}`}
      role="listitem"
    >
      <div className="grid md:grid-cols-[220px_minmax(0,1fr)_190px]">
        <Image
          alt={roomType.name}
          className="h-full min-h-52 w-full object-cover"
          height={624}
          loading="lazy"
          sizes="(max-width: 767px) calc(100vw - 2.5rem), 220px"
          src={roomType.images[0]?.url ?? galleryFallback}
          unoptimized={shouldBypassImageOptimization(
            roomType.images[0]?.url ?? galleryFallback,
          )}
          width={660}
        />
        <div className="p-5">
          <h3 className="text-xl font-bold">{roomType.name}</h3>
          {roomType.englishName && (
            <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
              {roomType.englishName}
            </p>
          )}
          <p className="mt-3 text-sm font-semibold text-foreground">
            {roomType.maxAdults + roomType.maxChildren} نفر |{" "}
            {roomType.bedInformation.map(persianBed).join(" | ") ||
              "ترکیب تخت ثبت نشده"}
          </p>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {roomType.description}
          </p>
          {details.length > 0 && (
            <p className="mt-3 text-sm font-semibold text-foreground">
              {details.join(" | ")}
            </p>
          )}
          {roomType.notes && (
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              {roomType.notes}
            </p>
          )}
          {roomType.amenities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {roomType.amenities.map((amenity) => (
                <span
                  className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-foreground"
                  key={amenity.id}
                >
                  {amenity.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col justify-between gap-5 border-t border-border p-5 md:border-r md:border-t-0">
          <RoomTypeBookingDetails
            booking={booking}
            currencyLabel={currencyLabel}
            roomType={roomType}
          />
          <KoochButton
            className="w-full"
            onClick={onShowDetails}
            variant="outline"
          >
            مشاهده جزئیات
          </KoochButton>
        </div>
      </div>
      {ratePlanOption && booking.ratePlans.length > 0 && (
        <div className="border-t border-border px-5 py-2">
          <RateOfferRow
            availableToAdd={booking.availableToAdd}
            currencyLabel={currencyLabel}
            name="نرخ استاندارد"
            controlName={`${roomType.name}، نرخ استاندارد`}
            finalAmount={ratePlanOption.finalAmount}
            mealPlanName={ratePlanOption.defaultMealPlanName}
            onAdd={booking.onAdd}
            onRemove={booking.onRemove}
            selectedQuantity={booking.selectedQuantity}
            totalAvailable={ratePlanOption.availableCount}
          />
          {booking.ratePlans.map((plan) => (
            <RateOfferRow
              availableToAdd={booking.availableToAdd}
              controlName={`${roomType.name}، ${plan.name}`}
              currencyLabel={currencyLabel}
              finalAmount={plan.finalAmount}
              key={plan.ratePlanId}
              mealPlanName={plan.mealPlanName}
              name={plan.name}
              onAdd={plan.onAdd}
              onRemove={plan.onRemove}
              selectedQuantity={plan.selectedQuantity}
              totalAvailable={ratePlanOption.availableCount}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function RateOfferRow({
  availableToAdd,
  controlName,
  currencyLabel,
  finalAmount,
  mealPlanName,
  name,
  onAdd,
  onRemove,
  selectedQuantity,
  totalAvailable,
}: {
  availableToAdd: number;
  controlName: string;
  currencyLabel: string;
  finalAmount: number;
  mealPlanName?: string | null;
  name: string;
  onAdd: () => void;
  onRemove: () => void;
  selectedQuantity: number;
  totalAvailable: number;
}) {
  return (
    <div className="grid gap-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-bold text-foreground">{name}</p>
        {mealPlanName && mealPlanName !== name && (
          <p className="mt-1 text-xs text-muted-foreground">{mealPlanName}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
        <p className="font-bold text-foreground">{formatCurrency(finalAmount, { currencyLabel })}</p>
        <OfferQuantityControl
          availableToAdd={availableToAdd}
          name={controlName}
          onAdd={onAdd}
          onRemove={onRemove}
          selectedQuantity={selectedQuantity}
          totalAvailable={totalAvailable}
        />
      </div>
    </div>
  );
}

function RoomTypeBookingDetails({
  booking,
  currencyLabel,
  roomType,
}: {
  booking?: PublicRoomTypeBookingState;
  currencyLabel: string;
  roomType: PublicRoomType;
}) {
  if (!booking) {
    return (
      <div>
        <p className="text-xs text-muted-foreground">
          {roomType.displayPrice != null && roomType.displayPrice > 0
            ? "کمترین قیمت روزانه آینده"
            : "قیمت اقامت"}
        </p>
        <p className="mt-1 text-lg font-bold text-primary">
          {formatPrice(roomType.displayPrice, currencyLabel)}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          برای قیمت قطعی و موجودی، تاریخ اقامت را بررسی کنید.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {roomType.totalInventory === 1
            ? "یک واحد قابل فروش"
            : `${roomType.totalInventory.toLocaleString("fa-IR")} واحد قابل فروش`}
        </p>
      </div>
    );
  }

  if (!booking.option) {
    return (
      <div>
        <p className="text-sm font-bold text-foreground">
          در این بازه قابل رزرو نیست
        </p>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {unavailableRoomTypeMessage(booking.unavailableReason)}
        </p>
        {booking.selectedQuantity > 0 && (
          <KoochButton
            aria-label={`کاهش تعداد ${roomType.name}`}
            className="mt-4 w-full"
            onClick={booking.onRemove}
            variant="outline"
          >
            حذف یک واحد از انتخاب
          </KoochButton>
        )}
      </div>
    );
  }

  const option = booking.option;
  const isOverCapacity = booking.totalSelectedQuantity > option.availableCount;
  const mode = bookingModePresentation(option.bookingMode);

  if (booking.ratePlans.length > 0) {
    return (
      <div>
        <p className="text-xs font-bold text-foreground">
          <span aria-hidden="true">{mode.icon}</span> {mode.label}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {option.availableCount.toLocaleString("fa-IR")} واحد برای این بازه
        </p>
        {isOverCapacity && (
          <p className="mt-2 text-xs font-bold leading-6 text-destructive" role="status">
            موجودی جدید حداکثر {option.availableCount.toLocaleString("fa-IR")} واحد است؛ تعداد انتخاب‌شده را کاهش دهید.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-bold text-foreground">نرخ استاندارد</p>
      {option.defaultMealPlanName && (
        <p className="mt-1 text-xs text-muted-foreground">{option.defaultMealPlanName}</p>
      )}
      <p className="text-xs text-muted-foreground">مبلغ کل اقامت</p>
      <p className="mt-1 text-lg font-bold text-primary">
        {formatCurrency(option.finalAmount, { currencyLabel })}
      </p>
      <p className="mt-2 text-xs font-bold text-foreground">
        <span aria-hidden="true">{mode.icon}</span> {mode.label}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {option.availableCount.toLocaleString("fa-IR")} واحد برای این بازه
      </p>
      {isOverCapacity && (
        <p
          className="mt-2 text-xs font-bold leading-6 text-destructive"
          role="status"
        >
          موجودی جدید حداکثر {option.availableCount.toLocaleString("fa-IR")}{" "}
          واحد است؛ تعداد انتخاب‌شده را کاهش دهید.
        </p>
      )}
      <div className="mt-4 flex min-h-11 items-center justify-start md:justify-end">
        <OfferQuantityControl
          availableToAdd={booking.availableToAdd}
          fullWidth
          name={option.name}
          onAdd={booking.onAdd}
          onRemove={booking.onRemove}
          selectedQuantity={booking.selectedQuantity}
          totalAvailable={option.availableCount}
        />
      </div>
    </div>
  );
}

function OfferQuantityControl({
  availableToAdd,
  fullWidth = false,
  name,
  onAdd,
  onRemove,
  selectedQuantity,
  totalAvailable,
}: {
  availableToAdd: number;
  fullWidth?: boolean;
  name: string;
  onAdd: () => void;
  onRemove: () => void;
  selectedQuantity: number;
  totalAvailable: number;
}) {
  const isSingleUnit = selectedQuantity <= 1 && selectedQuantity + availableToAdd <= 1;
  if (selectedQuantity === 0) {
    return (
      <KoochButton
        aria-label={availableToAdd === 0 ? `تکمیل ظرفیت ${name}` : `انتخاب ${name}`}
        className={fullWidth ? "w-full" : "min-w-28"}
        disabled={availableToAdd === 0}
        onClick={onAdd}
        variant={availableToAdd === 0 ? "outline" : "primary"}
      >
        {availableToAdd === 0 ? "تکمیل ظرفیت" : "انتخاب"}
      </KoochButton>
    );
  }
  if (isSingleUnit) {
    return (
      <KoochButton
        aria-label={`حذف انتخاب ${name}`}
        aria-pressed={true}
        className={fullWidth ? "w-full" : "min-w-28"}
        onClick={onRemove}
        variant="outline"
      >
        <span aria-hidden="true">✓</span> انتخاب شد؛ حذف
      </KoochButton>
    );
  }
  return (
    <div aria-label={`تعداد انتخاب‌شده ${name}`} className="flex items-center gap-2" role="group">
      <KoochButton aria-label={`کاهش تعداد ${name}`} onClick={onRemove} size="icon" variant="outline">
        <span aria-hidden="true" className="text-lg">−</span>
      </KoochButton>
      <output aria-atomic="true" aria-live="polite" className="min-w-8 text-center text-base font-bold text-foreground">
        {selectedQuantity.toLocaleString("fa-IR")}
      </output>
      <KoochButton
        aria-label={`افزایش تعداد ${name}`}
        disabled={availableToAdd === 0 || selectedQuantity > totalAvailable}
        onClick={onAdd}
        size="icon"
        variant="outline"
      >
        <span aria-hidden="true" className="text-lg">+</span>
      </KoochButton>
    </div>
  );
}

export function unavailableRoomTypeMessage(reason?: RoomTypeUnavailableReason) {
  if (reason === "GuestCapacityExceeded") {
    return "ظرفیت این اتاق برای تعداد مهمانان انتخاب‌شده کافی نیست. تعداد مهمانان یا نوع اتاق را تغییر دهید.";
  }
  if (reason === "IncompleteDailyPricing") {
    return "قیمت همه شب‌های این بازه هنوز در تقویم تعیین نشده است. تاریخ دیگری را انتخاب کنید یا بعداً دوباره بررسی کنید.";
  }
  return "در این بازه ظرفیت قابل رزرو وجود ندارد. تاریخ‌ها را تغییر دهید و دوباره بررسی کنید.";
}

function persianBed(value: string) {
  const lower = value.toLowerCase();
  const count = value.match(/\d+/)?.[0] ?? "";
  const label = lower.includes("double")
    ? "تخت دابل"
    : lower.includes("single")
      ? "تخت یک‌نفره"
      : lower.includes("twin")
        ? "تخت تویین"
        : value;
  return count ? `${count} × ${label}` : label;
}
