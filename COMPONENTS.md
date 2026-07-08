# Kooch Component Guide

This file tells AI agents and developers which shared components should be reused in Kooch. Before creating a new UI component, check this file and the existing codebase.

## General Rule
Use shared Kooch components instead of one-off page-level implementations.

Do not create new raw buttons, dialogs, form controls, uploaders, alerts, tables, or cards when a Kooch component already exists.

## KoochDialog / KoochModal

### Use for
Large create/edit forms and multi-section dialogs.

Examples:
- Add/edit room
- Add/edit amenity
- Add/edit amenity category
- Add/edit property
- Add/edit user
- Guest create/edit
- Booking detail or booking create form

### Required behavior
- Fixed-size shell when appropriate
- Scrollable body
- Sticky footer
- Sticky header if supported
- RTL support
- Dark/light support
- Consistent close behavior

### Do not use for
Small confirmations, delete prompts, warnings, or yes/no questions.

Use `KoochAlert` / `KoochConfirmDialog` instead.

## KoochAlert / KoochConfirmDialog

### Use for
Small confirmation and alert flows.

Examples:
- Delete confirmation
- Unusual price confirmation
- Bulk apply confirmation
- Cancel booking confirmation
- Confirm reservation status change
- “Are you sure?” flows
- Warning before destructive actions

### Required behavior
- Use for questions and approvals
- Do not use browser `window.confirm()`
- Support variants such as warning, destructive, success, default
- Use `KoochButton` inside

### Do not use for
Large forms or multi-step edit screens.

## KoochButton

### Use for
All admin/owner buttons.

Examples:
- Add
- Edit
- Delete
- Save
- Cancel
- Filter
- Open dialog
- Confirm actions

### Variants
- primary
- secondary
- outline
- ghost
- destructive

### Rules
- Do not create raw `<button className=...>` in admin/owner pages if `KoochButton` can be used.
- Keep button heights and radius consistent.
- Use destructive variant for destructive actions.

## KoochInput / KoochSelect / KoochTextarea

### Use for
Admin/owner form fields.

Examples:
- User form
- Property form
- Amenity form
- Room form
- Guest form
- Reservation form

### Rules
- Label should be above the field when using `KoochField`.
- Helper/error text should be below.
- Keep normal input/select heights consistent.
- Textarea can be taller.
- Support disabled, error, helper text, RTL, and dark mode.

## KoochField / KoochLabel

### Use for
Form layout and labels.

### Rules
- `KoochField` wraps label + control + message.
- Avoid duplicating error/helper messages when a control already renders them.

## KoochCard

### Use for
Page sections, content wrappers, stat cards, warning cards, and list containers.

Examples:
- Amenities section
- Property completion card
- Dashboard stat card
- Settings section
- Empty or warning block

### Rules
- Use semantic theme-safe colors.
- Do not hardcode `bg-white`, `bg-black`, or fixed dark backgrounds unless required.

## KoochPageHeader

### Use for
Admin/owner page title blocks.

Props usually include:
- eyebrow
- title
- description
- actions

### Rules
- Avoid custom page header blocks with fixed dark backgrounds.
- Use for consistent page spacing and theme support.

## KoochTable

### Use for
Normal data lists.

Examples:
- Users table
- Guests table
- Amenities table
- Amenity categories table
- Properties table
- Reviews table
- Reservations table

### Do not use for
Pricing calendar or inventory/capacity calendar grids.

Those use specialized calendar grid components and must preserve selection behavior, sticky headers, mobile/desktop logic, and cell layout.

## KoochBadge

### Use for
Small status labels.

Examples:
- Draft
- Active
- Inactive
- Pending
- Suspended
- Confirmed
- Cancelled
- Iranian / Foreign guest type
- Available / Unavailable / OnRequest

### Rules
- Use consistent variants/colors.
- Keep text readable in dark/light mode.

## KoochEmptyState

### Use for
Empty lists or missing setup states.

Examples:
- No rooms defined
- No pricing entered
- No inventory entered
- No guests found
- No reservations yet

### Should include
- title
- description
- optional action button

## KoochSvgUploader

### Use for
Uploading SVG icons.

Examples:
- Amenity icon
- Amenity category icon
- Promotion icon
- Feature icon

### Rules
- Accept SVG only.
- Show preview.
- Allow replacing existing SVG.
- Store relative path only.
- Do not store absolute URLs.
- Prefer deterministic filenames based on slug/name.

Suggested paths:
- `/svgs/amenities/`
- `/svgs/amenity-categories/`
- `/svgs/promotions/`

## KoochMediaUploader

### Future use
Generic media uploader for images and other assets.

Potential uses:
- Property images
- Room images
- Logo
- Hero image
- Avatar

### Rule
If this component exists and is stable, use it instead of creating upload logic in pages.

## KoochDatePicker / KoochDateRangePicker

### Use for
Single date or date range selection.

### Known caution
Date picker and pricing bulk edit date range display have known issues. Do not rewrite or replace date picker blindly.

### Rules
- Preserve Jalali/Gregorian conversion behavior.
- Selected date range must display inside the related field, not only below it.
- Preserve desktop/mobile behavior.
- Do not change calendar grid logic unless the task requires it.

## KoochAutocomplete / MultiSelect

### Use for
Searchable selection and multi-selection.

Examples:
- Select property by name
- Select room types
- Select amenities
- Assign properties to users
- Multi-select rooms in pricing bulk edit

### Rules
- Use instead of raw select when the list can grow.
- Show selected items clearly.
- Keep input height reasonable.
- Support RTL and dark mode.

## PermissionMatrix

### Use for
Property user permissions.

Groups:
- Dashboard
- Property
- Rooms
- Pricing
- Inventory
- Bookings
- Reviews
- Users
- Financial
- Reports
- Settings

### Rules
- Role fills default permissions.
- Permissions can be customized if current user has permission.
- User cannot grant permissions they do not have.

## CalendarGridEditor

### Use for
Pricing and inventory/capacity calendar grids.

### Rules
- Do not replace with KoochTable.
- Preserve selection logic.
- Preserve range/drag/mobile behavior.
- Preserve sticky headers and layout.
- UI components may wrap the grid, but the grid itself should remain specialized.

## Sonner Toast

### Use for
All toast notifications.

Examples:
- Save success
- Error messages
- Delete success
- Validation errors

### Rule
Do not introduce another toast system.

## Component Selection Quick Reference

- Large form → `KoochDialog`
- Confirmation/question → `KoochAlert` / `KoochConfirmDialog`
- Button → `KoochButton`
- Input/select/textarea → Kooch form controls
- Normal table → `KoochTable`
- Calendar pricing/inventory grid → `CalendarGridEditor`
- Status label → `KoochBadge`
- Empty list → `KoochEmptyState`
- SVG icon upload → `KoochSvgUploader`
- Searchable multi-select → `KoochAutocomplete` / multi-select component
