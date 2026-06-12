namespace Kooch.Api.Entities;

public enum UserRole { Admin, Owner, Client }
public enum PropertyStatus { Draft, PendingReview, Approved, Rejected, Suspended }
public enum PropertyType { TraditionalHouse, BoutiqueHotel, EcoLodge, Hotel, Villa, Apartment }
public enum InventoryMode { NamedRooms, TypeBasedInventory }
public enum ReservationStatus { Pending, Confirmed, Rejected, Cancelled, Paid, Completed }
public enum ReservationSource { Website, OwnerManual, PhoneReferral, AdminCreated, ExternalChannel }
public enum PaymentStatus { Pending, Successful, Failed, Refunded }
public enum AmenityScope { Property, RoomType, Both }
public enum DiscountType { Percentage, FixedAmount }
public enum PriceModifierType { Percentage, FixedAmount }
public enum WarningType { Accessibility, Noise, Stairs, NoElevator, NoWindow, SharedBathroom, Parking, Other }
public enum PromotionScope { Global, Property, RoomType }
