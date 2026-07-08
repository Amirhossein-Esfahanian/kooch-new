# Kooch Project Guide

## Purpose
Kooch is a property/accommodation management and booking platform. The admin and owner panels are currently the main focus. Public guest-facing booking will come later.

## Current Development Rule
Work module by module. Stabilize each module before moving to the next one. Prefer small, testable changes.

## Main Panels

### Admin Panel
Used for platform-level management.

Main areas:
- Dashboard
- Property management
- Rooms
- Pricing
- Inventory / capacity
- Promotions
- Amenities and amenity categories
- Users and permissions
- Reviews
- Settings
- Reports, later
- Reservations, in progress

### Owner Panel
Used by property owners and their assigned users.

Main areas:
- Dashboard
- Current property context
- Rooms
- Pricing
- Inventory / capacity
- Promotions
- Property users
- Reviews
- Guests
- Reservations, in progress
- Settings / property settings

## Important Architecture Decisions

### 1. Reuse shared UI components
Do not create one-off buttons, dialogs, tables, cards, inputs, alerts, or uploaders. Use Kooch shared components whenever possible.

### 2. Dialog vs Alert
- `KoochDialog` is for large create/edit forms.
- `KoochAlert` / `KoochConfirmDialog` is for confirmations, warnings, delete prompts, unusual price confirmation, and question/approval flows.

### 3. Pricing and inventory calendars
Pricing and inventory calendars use specialized calendar/grid logic. Do not replace these grids with generic `KoochTable`.

`KoochTable` is for normal lists, not calendar grids.

### 4. Child price and extra guest price
Child price and extra guest price are property-level financial/rule settings, not room-level daily prices.

Pricing calendar should only edit room daily base prices. It may display warnings or success messages about child/extra guest pricing, but should not edit those fields.

### 5. Permissions first
Roles are templates. Actual access should come from permission matrix values.

Role = default permission template.
Permission matrix = real access rights.

Authorization should use permission checks, not role names alone.

### 6. Property context
Non-admin users are assigned to one or more properties. Owner panel must know the current property. Sidebar/header should show the current property name instead of placeholder text.

### 7. Guest Foundation
Guest is the main customer/guest entity for future reservations.

Reservations should use `GuestId` for new flows. Legacy `ClientId` may remain temporarily for compatibility.

## Current Known Backlog / Unresolved Items

### Date picker
The date picker component needs review and later changes. Pricing bulk edit date range display has known issues. Do not rewrite date picker blindly.

### Login / username / OTP
Username/login sprint is incomplete and has defects. It should support:
- login with email or mobile
- fixed password login
- OTP login by mobile
- development-only OTP display
- first-password setup link for invited users

Do not assume authentication flows are stable.

### Reservation module
Reservation currently has data foundations but not a full operational module.

Existing:
- Reservation entity
- Status/source enums
- DbContext mapping
- related Payment, Review, NotificationLog, CancellationPolicy, RatePlan
- PricingService
- Inventory module
- Owner reservation route placeholder

Missing/incomplete:
- reservation controller
- reservation service
- reservation DTOs
- create/hold/confirm/cancel/check-in/check-out endpoints
- availability lock/decrement logic
- pricing snapshot creation flow
- admin/owner booking management UI
- notification flow for reservation events

## Module Status

### UI Foundation
Mostly in progress / partially stable.

Shared components include or should include:
- KoochCard
- KoochPageHeader
- KoochButton
- KoochInput
- KoochSelect
- KoochTextarea
- KoochDialog
- KoochAlert / KoochConfirmDialog
- KoochTable
- KoochBadge
- KoochEmptyState
- KoochSvgUploader

### Amenities
Admin manages amenity items and amenity categories.
Owners only select existing amenities. Owners should not create/edit/delete amenity items or categories.

Amenity SVGs should be uploaded, not typed as raw paths. Store relative paths.

### Rooms
Rooms use wizard-style create/edit flow with `KoochDialog`.
Room add/edit dialog should be fixed-size, with scrollable body and sticky footer.
Room can be Draft then Active.
Draft rooms are not bookable.

### Pricing
Supports Iranian/Foreign guest tabs.
Pricing history, quick prices, outlier warning, and child/extra guest warnings are important.

Unusual price warning rule:
- warn if entered price is less than 20% of property minimum room price
- warn if entered price is more than 4x property maximum room price
Use `KoochAlert` / `KoochConfirmDialog`.

### Inventory / Capacity
Inventory uses calendar grid. Preserve selection logic, drag/range behavior, mobile behavior, and status colors.

Status values:
- Available
- Unavailable
- OnRequest

### Users / Permissions
Admin users and owner/property users are separate contexts but should reuse components.
Admin can assign non-admin users to properties.
Owner can add same-level or lower-level users to current property, limited by permissions.

### Guests
Guest foundation is added. Guests are used for future reservation flows.

### Reservations
Next major module after Guest foundation. Should be built in phases:
- DTOs
- reservation number generator
- status workflow
- availability validator
- price preview
- reservation service create flow
- owner/admin UI

## Database Rules
- If entity/model changes, create EF migration.
- Do not ignore EF Core warnings.
- Keep DTOs, APIs, and entities aligned.
- Prefer nullable compatibility fields when migrating from legacy fields.
- Do not remove legacy fields until all dependent code is updated.

## API Rules
- Admin routes stay in admin context.
- Owner routes stay in owner/property context.
- Shared functionality can reuse services/components, but routing/layout must remain correct.
- Do not redirect admin users into owner panel routes unless explicitly required.

## UI Rules
- Respect RTL and Persian labels.
- Respect light/dark mode.
- Prefer `rounded-lg` in admin/owner panels unless design requires otherwise.
- Use Sonner for toast messages.
- Use `KoochConfirmDialog` / `KoochAlert` instead of `window.confirm()`.
- Use Kooch shared components before creating new ones.

## Final Response Requirement for AI Agents
After changes, explain:
1. What changed
2. Which files changed
3. Why this approach was chosen
4. Risks or follow-up items
