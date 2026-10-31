import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const auditTimeZone = "Asia/Tehran";

function tehranDayStartUtc(date: string): string {
  return dayjs.tz(date, auditTimeZone).utc().toISOString();
}

export const auditActionLabels = {
  PriceChanged: "تغییر قیمت", InventoryChanged: "تغییر موجودی و دسترس‌پذیری",
  RoomCreated: "ایجاد اتاق", RoomDeleted: "حذف اتاق", BookingConfirmed: "تأیید رزرو",
  BookingCancelled: "لغو رزرو", BookingApproved: "پذیرش درخواست رزرو", BookingExpired: "انقضای رزرو",
  PropertyOwnershipTransferred: "انتقال مالکیت اقامتگاه", PlatformAdminCreated: "ایجاد مدیر",
  PlatformAdminUpdated: "تغییر مدیر", PlatformAdminActivated: "فعال‌سازی مدیر",
  PlatformAdminDeactivated: "غیرفعال‌سازی مدیر", PropertyMemberIdentityUpdated: "تغییر عضو اقامتگاه",
  RoomCapacityChanged: "تغییر ظرفیت اتاق", PropertyInformationChanged: "تغییر اطلاعات اقامتگاه",
  SiteSettingsChanged: "تغییر تنظیمات سایت",
} as const;
export type AdminAuditAction = keyof typeof auditActionLabels;
export type AuditValue = string | number | boolean | null;
export type AdminAuditLog = {
  id: number; userId: number; actorDisplayName: string; occurredAtUtc: string;
  action: AdminAuditAction; entityType: string; entityId: number | null;
  entityName?: string | null; hasPriceDetails?: boolean;
  propertyId: number | null; propertyName: string | null; description: string | null;
  previousValues: Record<string, AuditValue> | null; newValues: Record<string, AuditValue> | null;
};
export type AdminPriceChangePage = {
  items: { date: string; previousPrice: number; newPrice: number; guestType: string }[];
  hasMore: boolean; nextAfter: string | null;
};
export type AdminAuditPage = {
  items: AdminAuditLog[]; page: number; pageSize: number; totalCount: number; totalPages: number;
};
export type AuditFilters = { actor: string; property: string; action: string; from: string | null; to: string | null };
export const emptyAuditFilters: AuditFilters = { actor: "", property: "", action: "", from: null, to: null };

export function adminAuditPath(filters: AuditFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.actor) params.set("actorUserId", filters.actor);
  if (filters.property) params.set("propertyId", filters.property);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("fromUtc", tehranDayStartUtc(filters.from));
  if (filters.to) {
    const nextDay = dayjs.utc(filters.to).add(1, "day").format("YYYY-MM-DD");
    params.set("toUtc", tehranDayStartUtc(nextDay));
  }
  return `/admin/audit-logs?${params}`;
}

// Mirror the permitted display fields, never render arbitrary response keys.
export const auditFieldLabels: Record<string, string> = {
  Status: "وضعیت", Type: "نوع اقامتگاه", InventoryMode: "نوع موجودی", DestinationId: "مقصد",
  DefaultMealPlanId: "وعده غذایی پیش‌فرض", CheckInTime: "زمان ورود", CheckOutTime: "زمان خروج",
  RegularReceptionFrom: "شروع پذیرش", RegularReceptionUntil: "پایان پذیرش",
  SameNightInstantBookingTime: "مهلت رزرو فوری امشب", SameNightInstantBookingDayOffset: "روز مهلت رزرو فوری",
  SameNightFinalBookingTime: "مهلت نهایی رزرو امشب", SameNightFinalBookingDayOffset: "روز مهلت نهایی",
  TotalAreaM2: "زیربنا", LandAreaM2: "مساحت زمین", FloorsCount: "تعداد طبقات", StairCount: "تعداد پله‌ها",
  HasElevator: "آسانسور", IsWheelchairAccessible: "دسترسی ویلچر", HasGroundFloorRoom: "اتاق همکف",
  HasAccessibleBathroom: "سرویس بهداشتی دسترس‌پذیر", HasSeparateForeignPricing: "قیمت‌گذاری مهمان خارجی",
  FreeChildAgeLimit: "حد سن کودک رایگان", MaxFreeChildren: "تعداد کودک رایگان", ChildPrice: "قیمت کودک",
  ExtraGuestPrice: "قیمت مهمان اضافه", TotalInventory: "موجودی کل", MaxAdults: "ظرفیت بزرگسال",
  MaxChildren: "ظرفیت کودک", AllowExtraGuest: "پذیرش مهمان اضافه", MaxExtraGuests: "ظرفیت مهمان اضافه",
  AvailableCount: "موجودی روز", IsClosed: "بسته بودن", MinNightsOverride: "حداقل شب",
  RoomTypeId: "نوع اتاق", Date: "تاریخ", ChangedCellCount: "تعداد خانه تغییرکرده",
  RoomTypeCount: "تعداد نوع اتاق", GuestType: "نوع مهمان", From: "از تاریخ", To: "تا تاریخ",
  ReservationCommissionPercent: "کمیسیون رزرو", ReferralCommissionPercent: "کمیسیون معرفی",
  CommissionType3Percent: "کمیسیون نوع سوم", "pricing.minPrice": "حداقل قیمت", "pricing.maxPrice": "حداکثر قیمت",
  "reservation.freeChildMaxAge": "حد سن کودک رایگان", "reservation.halfPriceChildMinAge": "حداقل سن کودک نیم‌بها",
  "reservation.halfPriceChildMaxAge": "حداکثر سن کودک نیم‌بها", "reservation.halfPriceChildRate": "نرخ کودک نیم‌بها",
  "reservation.paymentWindowMinutes": "مهلت پرداخت (دقیقه)", "reservation.ownerApprovalWindowMinutes": "مهلت تأیید (دقیقه)",
  "reservation.ownerApprovalReminderIntervalMinutes": "فاصله یادآوری تأیید (دقیقه)",
  "image.maxFileSizeMb": "حداکثر حجم تصویر", "image.minWidth": "حداقل عرض تصویر",
  "image.minHeight": "حداقل ارتفاع تصویر", "image.maxImagesPerProperty": "حداکثر تعداد تصاویر",
  "image.enableWebpConversion": "تبدیل تصویر WebP",
  Enabled: "فعال", CalculationMode: "روش محاسبه", PercentageRate: "درصد کش‌بک", SpendUnitAmount: "واحد هزینه",
  RewardAmount: "مبلغ پاداش", MaxCashbackPerReservation: "سقف کش‌بک رزرو", ExpiryDays: "مدت اعتبار (روز)", Currency: "ارز",
};
const valueLabels: Record<string, string> = {
  Available: "قابل رزرو", Unavailable: "ناموجود", OnRequest: "درخواست رزرو", Draft: "پیش‌نویس",
  PendingReview: "در انتظار بررسی", Approved: "تأییدشده", Rejected: "ردشده", Suspended: "تعلیق‌شده",
  Iranian: "ایرانی", Foreign: "خارجی", TypeBasedInventory: "موجودی نوع اتاق", NamedRooms: "اتاق مشخص",
  TraditionalHouse: "خانه سنتی", BoutiqueHotel: "هتل بوتیک", EcoLodge: "بوم‌گردی", Hotel: "هتل", Villa: "ویلا", Apartment: "آپارتمان",
  Percentage: "درصدی", FixedPerUnit: "مبلغ ثابت به‌ازای واحد",
};
export function auditValue(value: AuditValue | undefined): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  if (typeof value === "number") return value.toLocaleString("fa-IR");
  return valueLabels[value] ?? value;
}
