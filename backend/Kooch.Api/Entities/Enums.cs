namespace Kooch.Api.Entities;

public enum UserRole { SuperAdmin, AdminAssistant, Owner, OwnerAssistant, Client }
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
public enum ReservationStatus { Pending, Confirmed, Rejected, Cancelled, Paid, Completed, OnHold, Expired }
public enum ReservationSource { Website, OwnerManual, PhoneReferral, AdminCreated, ExternalChannel }
public enum PaymentStatus { Pending, Successful, Failed, Refunded }
public enum AmenityScope { Property, RoomType, Both }
public enum DiscountType { Percentage, FixedAmount }
public enum PriceModifierType { Percentage, FixedAmount }
public enum WarningType { Accessibility, Noise, Stairs, NoElevator, NoWindow, SharedBathroom, Parking, Other }
public enum PromotionScope { Global, Property, RoomType }
public enum NotificationEventType
{
    ReservationCreated,
    ReservationConfirmed,
    ReservationCancelled,
    PaymentSuccessful,
    ReservationExpired,
    PropertyApproved,
    CheckInReminder
}
public enum NotificationChannel { Sms, Email, InApp, WhatsApp, Telegram }
public enum NotificationStatus { Pending, Sent, Failed }
public enum AvailabilityStatus { Available, Unavailable, OnRequest }
public enum NearbyPlaceCategory { Attraction, Transport, Landmark, Market, Other }
public enum PropertyViewType { CourtyardView, GardenView, CityView, MountainView, DesertView }
public enum PropertyDescriptionSectionType
{
    PropertyIntroduction = 0,
    ImportantNotes = 3
}
