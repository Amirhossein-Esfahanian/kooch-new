# Kooch — Project Context

Last reviewed: 2026-09-28
Status: Living document

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS
- ASP.NET Core Web API (.NET)
- Entity Framework Core
- SQL Server
- REST / JSON
- RTL-first, responsive, theme-aware UI

## Repository

```text
kooch/
├── frontend/   Next.js application
├── backend/    ASP.NET Core API + EF Core
└── docs/       Product / architecture / migration notes
```

## Workspaces

Kooch has three user workspaces plus the public booking surface:

- Public / Booking
- Guest / Account
- Property / Owner
- Admin

A person has one canonical `User` identity and may use more than one workspace without creating duplicate accounts.

## Core architecture decisions

- One canonical User model.
- Property access is membership-driven (`UserPropertyAccess`) and permission-driven.
- Platform roles are global only; they must not be used as a shortcut for Property authorization.
- Role supplies initial permissions; the saved Permission Matrix is authoritative afterward.
- Multi-property membership is supported.
- Business logic belongs in backend Services; controllers stay thin.
- Frontend owns presentation, state, and API interaction, not business rules.
- DTOs are separate from entities.
- EF Core migrations are the schema source of truth.
- Important financial / reservation operations use transactions.
- Reuse → Extend → Create.

## Core product modules

- Authentication and workspace switching
- Property management
- Rooms / room types
- Calendar-driven pricing, capacity, and availability
- Reservations and OnRequest workflow
- Guest workspace
- Members and Permission Matrix
- Payments
- Voucher
- Finance / settlements
- Reports
- Promotions

## Reservation / payment rules

- A reservation becomes Confirmed only after verified successful payment.
- Admin cannot bypass payment verification with a direct Confirm action.
- Online payment: successful payment → reservation confirmation → voucher.
- Manual payment: admin records evidence → verifies/approves → successful payment → reservation confirmation → voucher.
- Reservation voucher is a reservation document, not a settlement receipt.

## Public references

Current public reference family:

- Order: `O-XXXXXX`
- Reservation: `R-XXXXXX`
- Voucher: `V-XXXXXX`
- Settlement: `S-XXXXXX`

Raw numeric database IDs are internal implementation details and should not be used as public document references.

## Finance — current implemented foundation

Implemented finance capabilities include:

- immutable `ReservationFinancialSnapshot`
- append-only `FinancialEntry` ledger
- commission type/rate resolution with Property override support
- payment financialization on successful payment
- manual payment verification workflow
- immutable reservation vouchers
- global settlement policy with snapshotted payable due dates
- settlement creation / history / cancellation and payable release
- public settlement reference `S-XXXXXX`
- immutable `SettlementPaymentRecord`
- payment-time Property name snapshot
- SettlementItem reservation-number snapshot
- Admin / Property printable Settlement Receipt
- read-only Property Settlement History gated by `financial.view`

## Settlement rules

- Settlement timing is global, not per Property.
- Policy uses base date (`CheckIn` or `CheckOut`) plus signed offset days.
- `PayableDueDate` is snapshotted when the payable is created.
- Policy changes do not retroactively alter existing obligations.
- Early settlement is explicit and does not change the original due date.
- Cancelled settlements remain in history; released items may be reallocated.
- Paid settlement records remain financial history.
- Notification failure must never roll back a Paid settlement.

## Historical document rules

Receipt and voucher projections must use persisted historical data, not mutable live fields.

For Settlement Receipt specifically:

- Property name → `SettlementPaymentRecord.PropertyNameSnapshot`
- Reservation reference → `SettlementItem.ReservationNumberSnapshot`
- amount / currency → persisted Settlement data
- payable due date → persisted financial entry data
- payment method/reference/time → `SettlementPaymentRecord`

Missing legacy snapshots are not reconstructed from live data.

## UI / shared component rules

- Reuse shared Kooch components before creating feature-specific alternatives.
- Tables use the `KoochTable` family; business filtering/sorting stays in page/API layers.
- Dialogs use `KoochDialog`; confirmations use `KoochConfirmDialog`.
- Forms use React Hook Form + Zod for redesigned forms.
- RTL, light/dark themes, semantic tokens, responsive layout, and accessibility are required.

## Current direction

Finance has reached a usable Settlement flow for Admin and Property users:

```text
Financialized payable
→ Settlement batch (S-XXXXXX)
→ Due / early settlement / cancellation
→ Mark Paid + SettlementPaymentRecord
→ Settlement Receipt
→ Property Settlement History
```

Likely next finance work should be selected explicitly from:

- settlement notifications
- refunds / reversals / adjustments
- cancellation-linked financial adjustments
- Owner finance UX/reporting polish

These are not automatically considered implemented until completed and verified.
