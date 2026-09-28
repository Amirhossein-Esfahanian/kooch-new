# Kooch Project Overview

Last reviewed: 2026-09-28
Status: Living document

## Purpose

Kooch is a booking and property-management platform for discovering, reserving, and operating stays. It is no longer a technical-foundation-only repository: the frontend and backend are connected, authentication and authorization exist, reservation/payment workflows are implemented, and finance/settlement capabilities are actively developed.

The long-term direction combines a booking engine with an extensible PMS-style Property Workspace.

## Repository structure

```text
kooch/
├── frontend/   Next.js App Router application
├── backend/    ASP.NET Core Web API + EF Core data model
└── docs/       Product, architecture, migration, and development notes
```

## Product surfaces

### Public / Booking

- property discovery and details
- date / guest selection
- room-type selection
- booking sessions/orders
- reservation creation and payment flow

### Guest / Account Workspace

- account/profile
- personal reservations
- reservation vouchers
- payment-related views

### Property / Owner Workspace

- dashboard
- rooms / room types
- reservations
- pricing
- calendar / capacity
- guests
- members / permissions
- reports
- settlement history and settlement receipts for users with `financial.view`

### Admin Workspace

- users
- properties
- amenities
- commissions
- payments, including manual verification
- site settings
- settlement management
- settlement payment records and receipts

## Identity and access

Kooch uses one canonical `User` identity. A user can be a guest, Property member, and/or platform administrator without duplicate accounts.

Property authorization is based on Membership + Permission Matrix. Platform role is not a substitute for Property access.

## Reservation and availability model

The system supports both named physical rooms and pooled room-type inventory. Availability/pricing are calendar-driven. Reservation history keeps pricing snapshots so later pricing-rule changes do not rewrite historical reservations.

OnRequest inventory follows its own approval/payment flow; confirmed reservations require successful verified payment.

## Payments and vouchers

Two payment channels are supported in the current finance flow:

- Online
- Manual (admin-recorded and approved)

A successful verified payment financializes the reservation, confirms it, and allows voucher issuance.

Voucher roles:

- Guest: booking/payment-facing values only
- Property: includes commission/payable projection where permitted
- Admin: persisted administrative projection

Voucher is not a settlement receipt.

## Finance and settlements

Current finance foundation includes:

- immutable reservation financial snapshots
- append-only ledger entries
- commission policy and Property overrides
- persisted PropertyPayable obligations
- global settlement timing policy
- settlement batches with `S-XXXXXX`
- cancellation and payable release
- immutable settlement payment records
- payment-time / allocation-time historical snapshots needed for stable receipts
- printable Admin and Property settlement receipts
- read-only Property settlement history with server-side search/filter/sort/pagination

## Public reference model

- `O-XXXXXX` — booking/order
- `R-XXXXXX` — reservation
- `V-XXXXXX` — voucher
- `S-XXXXXX` — settlement batch/accounting reference

For Property/customer communication about an individual booking, `R-XXXXXX` remains the primary reservation reference even when that reservation belongs to a Settlement batch.

## Technical conventions

- Next.js App Router + TypeScript
- ASP.NET Core Web API
- EF Core + SQL Server
- REST / JSON
- Service-layer business logic
- thin controllers
- DTOs separate from entities
- migration-driven schema
- reusable shared components
- RTL-first, responsive, theme-aware UI

## Current boundaries / deferred areas

Not all long-term features are complete. The following remain candidates for future phases:

- full refunds/reversals/adjustments workflow
- settlement notifications and delivery tracking
- broader accounting/reporting experiences
- wallet/coupons
- OTA / channel-manager integration
- cloud/local synchronization

## Near-term direction

Finance has a complete read-only Owner settlement history → detail → receipt path. The next finance feature should be chosen explicitly rather than inferred; likely candidates are notification delivery or paid-settlement correction flows (reversal/adjustment/refund).
