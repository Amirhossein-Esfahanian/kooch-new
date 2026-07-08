namespace Kooch.Api.Entities;

public enum UserRole { SuperAdmin, AdminAssistant, Owner, OwnerAssistant, Client }
public enum PropertyUserStatus { Pending, Active, Suspended, Inactive }
public enum PropertyUserRole { PropertyOwner, Manager, Reception, Accounting, Housekeeping, Custom }
public enum AuditAction
{
    PriceChanged,
    InventoryChanged,
    RoomCreated,
    RoomDeleted,
    BookingConfirmed,
    BookingCancelled
}
public enum PermissionKey
{
    ManageUsers,
    ManageRoles,
    ManageProperties,
    ManageReservations,
    ManagePayments,
    ManageAvailability,
    ManageReviews,
    ManageSeo,
    ManageNotifications,
    ViewReports,
    ManageStaff,
    ManageSettings
}
public enum SiteSettingType { Text, LongText, ImageUrl, Color, Boolean, Number }
public enum PropertyStatus { Draft, PendingReview, Approved, Rejected, Suspended }
public enum PropertyType { TraditionalHouse, BoutiqueHotel, EcoLodge, Hotel, Villa, Apartment }
public enum InventoryMode { NamedRooms, TypeBasedInventory }
public enum BreakfastOption { NoBreakfast, Included, Paid }
public enum ReservationStatus
{
    Pending = 0,
    Confirmed = 1,
    Rejected = 2,
    Cancelled = 3,
    Paid = 4,
    Completed = 5,
    OnHold = 6,
    Expired = 7,
    PendingApproval = 8,
    ApprovedAwaitingPayment = 9,
    PaymentExpired = 10
}
public enum ReservationSource { Website, OwnerManual, PhoneReferral, AdminCreated, ExternalChannel }
public enum PaymentStatus { Pending, Successful, Failed, Refunded }
public enum AmenityScope { Property, RoomType, Both }
public enum DiscountType { Percentage, FixedAmount }
public enum PromotionType { PercentageDiscount, FixedAmountDiscount, LastMinute, Informational }
public enum PromotionSource { Admin, Owner }
public enum PricingGuestType { Iranian, Foreign }
public enum CouponType { PercentageDiscount, FixedAmountDiscount, FreeNight, Informational }
[Flags]
public enum PromotionWeekday
{
    None = 0,
    Saturday = 1 << 0,
    Sunday = 1 << 1,
    Monday = 1 << 2,
    Tuesday = 1 << 3,
    Wednesday = 1 << 4,
    Thursday = 1 << 5,
    Friday = 1 << 6,
    All = Saturday | Sunday | Monday | Tuesday | Wednesday | Thursday | Friday
}
public enum PriceModifierType { Percentage, FixedAmount }
public enum WarningType { Accessibility, Noise, Stairs, NoElevator, NoWindow, SharedBathroom, Parking, Other }
public enum PromotionScope { Global, Property, RoomType }
public enum NotificationEventType
{
    ReservationCreated = 0,
    ReservationConfirmed = 1,
    ReservationCancelled = 2,
    PaymentSuccessful = 3,
    ReservationExpired = 4,
    PropertyApproved = 5,
    CheckInReminder = 6,
    ReservationPendingApproval = 7,
    ReservationApprovedAwaitingPayment = 8,
    ReservationPaymentExpired = 9,
    UserInvitationCreated = 10,
    PasswordSetupRequested = 11,
    OtpRequested = 12
}
[Flags]
public enum NotificationChannel
{
    None = 0,
    InApp = 1 << 0,
    Sms = 1 << 1,
    Email = 1 << 2
}
public enum NotificationStatus
{
    Queued = 0,
    Sent = 1,
    Failed = 2,
    Logged = 3
}
public enum AvailabilityStatus { Available, Unavailable, OnRequest }
public enum NearbyPlaceCategory { Attraction, Transport, Landmark, Market, Other }
public enum PropertyViewType { CourtyardView, GardenView, CityView, MountainView, DesertView }
public enum PropertyDescriptionSectionType
{
    PropertyIntroduction = 0,
    ImportantNotes = 3
}
