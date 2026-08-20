"use client";

import Image from "next/image";
import { KoochButton } from "@/components/KoochButton";
import { bookingModePresentation } from "@/components/booking/booking-display";
import type { PublicBookingRoomTypeOption } from "@/lib/booking-sessions";
import { formatCurrency } from "@/lib/currency";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";
import {
  formatPrice,
  type PublicRoomType,
} from "@/lib/public-properties";

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
  onAdd: () => void;
  onRemove: () => void;
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
      className="overflow-hidden rounded-2xl border bg-white shadow-sm"
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
          <h3 className="text-xl font-black">{roomType.name}</h3>
          {roomType.englishName && (
            <p className="mt-1 text-xs text-slate-400" dir="ltr">
              {roomType.englishName}
            </p>
          )}
          <p className="mt-3 text-sm font-semibold text-slate-700">
            {roomType.maxAdults + roomType.maxChildren} نفر |{" "}
            {roomType.bedInformation.map(persianBed).join(" | ") ||
              "ترکیب تخت ثبت نشده"}
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            {roomType.description}
          </p>
          {details.length > 0 && (
            <p className="mt-3 text-sm font-semibold text-slate-700">
              {details.join(" | ")}
            </p>
          )}
          {roomType.notes && (
            <p className="mt-2 text-sm leading-7 text-slate-600">
              {roomType.notes}
            </p>
          )}
          {roomType.amenities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {roomType.amenities.map((amenity) => (
                <span
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold"
                  key={amenity.id}
                >
                  {amenity.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col justify-between gap-5 border-t p-5 md:border-r md:border-t-0">
          <RoomTypeBookingDetails booking={booking} roomType={roomType} />
          <KoochButton className="w-full" onClick={onShowDetails} variant="outline">
            مشاهده جزئیات
          </KoochButton>
        </div>
      </div>
    </article>
  );
}

function RoomTypeBookingDetails({
  booking,
  roomType,
}: {
  booking?: PublicRoomTypeBookingState;
  roomType: PublicRoomType;
}) {
  if (!booking) {
    return (
      <div>
        <p className="text-xs text-slate-400">
          {roomType.displayPrice != null && roomType.displayPrice > 0
            ? "کمترین قیمت روزانه آینده"
            : "قیمت اقامت"}
        </p>
        <p className="mt-1 text-lg font-black text-blue-700">
          {formatPrice(roomType.displayPrice)}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          برای قیمت قطعی و موجودی، تاریخ اقامت را بررسی کنید.
        </p>
        <p className="mt-2 text-xs text-slate-500">
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
        <p className="text-sm font-black text-slate-800">
          در این بازه قابل رزرو نیست
        </p>
        <p className="mt-2 text-xs leading-6 text-slate-600">
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
  const maximumSelectable = booking.selectedQuantity + booking.availableToAdd;
  const isOverCapacity = booking.selectedQuantity > option.availableCount;
  const isSingleUnit = booking.selectedQuantity <= 1 && maximumSelectable <= 1;
  const mode = bookingModePresentation(option.bookingMode);

  return (
    <div>
      <p className="text-xs text-slate-500">مبلغ کل اقامت</p>
      <p className="mt-1 text-lg font-black text-blue-700">
        {formatCurrency(option.finalAmount)}
      </p>
      <p className="mt-2 text-xs font-bold text-slate-700">
        <span aria-hidden="true">{mode.icon}</span> {mode.label}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {option.availableCount.toLocaleString("fa-IR")} واحد برای این بازه
      </p>
      {isOverCapacity && (
        <p className="mt-2 text-xs font-bold leading-6 text-destructive" role="status">
          موجودی جدید حداکثر {option.availableCount.toLocaleString("fa-IR")} واحد است؛ تعداد انتخاب‌شده را کاهش دهید.
        </p>
      )}
      <div className="mt-4 flex min-h-11 items-center justify-start md:justify-end">
        {booking.selectedQuantity === 0 ? (
          <KoochButton
            aria-label={booking.availableToAdd === 0 ? `تکمیل ظرفیت ${option.name}` : `انتخاب ${option.name}`}
            className="w-full"
            disabled={booking.availableToAdd === 0}
            onClick={booking.onAdd}
            variant={booking.availableToAdd === 0 ? "outline" : "primary"}
          >
            {booking.availableToAdd === 0 ? "تکمیل ظرفیت" : "انتخاب"}
          </KoochButton>
        ) : isSingleUnit ? (
          <KoochButton
            aria-label={`حذف انتخاب ${option.name}`}
            aria-pressed={true}
            className="w-full"
            onClick={booking.onRemove}
            variant="outline"
          >
            <span aria-hidden="true">✓</span> انتخاب شد؛ حذف
          </KoochButton>
        ) : (
          <div aria-label={`تعداد انتخاب‌شده ${option.name}`} className="flex items-center gap-2" role="group">
            <KoochButton aria-label={`کاهش تعداد ${option.name}`} onClick={booking.onRemove} size="icon" variant="outline">
              <span aria-hidden="true" className="text-lg">−</span>
            </KoochButton>
            <output aria-atomic="true" aria-live="polite" className="min-w-8 text-center text-base font-black text-slate-900">
              {booking.selectedQuantity.toLocaleString("fa-IR")}
            </output>
            <KoochButton
              aria-label={`افزایش تعداد ${option.name}`}
              disabled={booking.availableToAdd === 0 || isOverCapacity}
              onClick={booking.onAdd}
              size="icon"
              variant="outline"
            >
              <span aria-hidden="true" className="text-lg">+</span>
            </KoochButton>
          </div>
        )}
      </div>
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
