# Kooch Database Draft

This model supports traditional stays with individually named rooms and hotels that sell pooled room-type inventory. It also establishes extension points for daily pricing, rate plans, promotions, stay restrictions, SEO, auditing, and soft deletion.

## Shared entity fields

Every business entity inherits `BaseEntity` and therefore has:

`Id`, `CreatedAtUtc`, `CreatedByUserId`, `UpdatedAtUtc`, `UpdatedByUserId`, `DeletedAtUtc`, `DeletedByUserId`, `IsDeleted`.

`CreatedAtUtc` and `UpdatedAtUtc` are populated by `KoochDbContext.SaveChangesAsync`. User attribution is intentionally left unset until a current-user service exists. A global query filter excludes rows where `IsDeleted` is true.

## Inventory model

- `Property.InventoryMode = NamedRooms`: each physical unit is a `Room` with a unique name inside its room type. A reservation may point to that room.
- `Property.InventoryMode = TypeBasedInventory`: `RoomType.TotalInventory` represents the physical pool and reservations leave `RoomId` null.
- `Availability` stores the sellable count and price for each room type and calendar date. Its daily `Price` is authoritative; nullable `OriginalPrice` supports strike-through pricing and `RoomType.BasePrice` is only an optional fallback.

## Core entities

| Entity | Purpose and key fields |
| --- | --- |
| `User` | Guest, owner, or administrator; includes `Role`, name, email, and phone. |
| `Property` | Owner-managed stay assigned to a destination, with slug, status, type, inventory mode, location, check-in/out times, highlights, warnings, and SEO fields. |
| `RoomType` | Property accommodation category with slug, occupancy limits, bed configuration, total inventory, optional base price, and SEO fields. |
| `Room` | One named physical unit belonging to a room type. |
| `Availability` | Daily room-type price, available count, closure flag, and optional minimum-night override. |
| `Reservation` | Client booking for a property and room type, optionally assigned to a named room; includes dates, guest counts, currency, status, source, and immutable pricing snapshots. |
| `Payment` | Reservation payment attempt or refund record with amount, currency, provider, reference, status, and paid timestamp. |
| `Review` | Property review by a client, optionally linked to the reservation that enabled it. |

## Discovery and classification

- `Amenity` declares an amenity and its `Property`, `RoomType`, or `Both` scope.
- `PropertyAmenity` and `RoomTypeAmenity` are explicit join entities.
- `TravelPurpose` classifies stays, joined through `PropertyTravelPurpose`.
- `PropertyImage` and `RoomTypeImage` store ordered images, alt text, and cover selection.
- `NearbyPlace` stores a named point of interest, category, and distance from a property.
- `PropertyHighlight` stores ordered badges and selling points, uniquely identified by slug within a property.
- `PropertyWarning` stores ordered guest-facing limitations classified by `WarningType`.
- `Destination` provides a unique-slug location hierarchy for cities and future geographic expansion. Every property belongs to a destination.
- `SeoMetadata` targets exactly one property, destination, or named landing-page key and stores title, description, keywords, canonical URL, and Open Graph image.
- `BedType` is reusable bed reference data; `RoomTypeBed` records the quantity of each bed type in a room type.

## Pricing and stay policy

- `CancellationPolicy` belongs to a property and can be referenced by rate plans.
- `MealPlan` defines reusable breakfast and meal options that rate plans may reference.
- `RatePlan` belongs to a room type and applies a percentage or fixed price modifier, optional minimum nights, cancellation policy, and meal plan.
- `Promotion` has an explicit global, property, or room-type scope, start/end dates, and a percentage or fixed discount. Scope and nullable target IDs are protected by a check constraint.
- `StayRule` targets exactly one property or room type, has start/end dates, minimum/maximum nights, and `ClosedToArrival` / `ClosedToDeparture` flags.

Reservation price history is retained in `BaseAmount`, `DiscountAmount`, `ExtraGuestAmount`, `ServiceFeeAmount`, and `FinalAmount`. These values are snapshots and must not be recalculated from later pricing-rule changes.

Date ranges describe when a promotion or stay rule applies. They do not replace the per-date `Availability` price rows.

## Relationships

```text
User 1 -------- * Property (Owner)
User 1 -------- * Reservation (Client)
User 1 -------- * Review (Client)

Property 1 ---- * RoomType
Destination 1 - * Property
Destination 1 - * Destination (optional parent)
Property 1 ---- * Reservation
Property 1 ---- * Review
Property 1 ---- * PropertyImage / NearbyPlace / CancellationPolicy / PropertyHighlight / PropertyWarning
Property * ---- * Amenity (PropertyAmenity)
Property * ---- * TravelPurpose (PropertyTravelPurpose)
Property 1 ---- 0..1 SeoMetadata
Destination 1 - 0..1 SeoMetadata

RoomType 1 ---- * Room / Availability / RoomTypeImage / RatePlan
RoomType 1 ---- * Reservation
RoomType * ---- * Amenity (RoomTypeAmenity)
RoomType * ---- * BedType (RoomTypeBed with Quantity)

Reservation 1 - * Payment
Reservation 1 - * Review (optional from Review)
Reservation * - 0..1 Room
RatePlan * ----- 0..1 CancellationPolicy
RatePlan * ----- 0..1 MealPlan
```

`Reservation`, `Payment`, and `Review` relationships use `NoAction` to protect historical business records from cascading deletion.

## Unique indexes

- `Property.Slug`
- `RoomType (PropertyId, Slug)`
- `Room (RoomTypeId, Name)`
- `Availability (RoomTypeId, Date)`
- `PropertyAmenity (PropertyId, AmenityId)`
- `RoomTypeAmenity (RoomTypeId, AmenityId)`
- `PropertyTravelPurpose (PropertyId, TravelPurposeId)`
- `PropertyHighlight (PropertyId, Slug)`
- `RoomTypeBed (RoomTypeId, BedTypeId)`
- `BedType.Slug`
- `MealPlan.Slug`
- `Destination.Slug`
- `User.Email`

All monetary values use `decimal(18,2)`, except percentages and geographic coordinates where narrower precision is configured.

## Enums

- `UserRole`: Admin, Owner, Client
- `PropertyStatus`: Draft, PendingReview, Approved, Rejected, Suspended
- `PropertyType`: TraditionalHouse, BoutiqueHotel, EcoLodge, Hotel, Villa, Apartment
- `InventoryMode`: NamedRooms, TypeBasedInventory
- `ReservationStatus`: Pending, Confirmed, Rejected, Cancelled, Paid, Completed
- `ReservationSource`: Website, OwnerManual, PhoneReferral, AdminCreated, ExternalChannel
- `PaymentStatus`: Pending, Successful, Failed, Refunded
- `AmenityScope`: Property, RoomType, Both
- `DiscountType`: Percentage, FixedAmount
- `PriceModifierType`: Percentage, FixedAmount
- `WarningType`: Accessibility, Noise, Stairs, NoElevator, NoWindow, SharedBathroom, Parking, Other
- `PromotionScope`: Global, Property, RoomType

## Deferred implementation

- Authentication and current-user audit attribution
- Booking concurrency and inventory decrement transactions
- Taxes, service fees, commissions, and exchange rates
- External channel synchronization
- Database migrations
