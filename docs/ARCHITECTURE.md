# Kooch Architecture

Last reviewed: 2026-09-28
Status: Confirmed / living document

## 1. Runtime architecture

```text
Next.js App Router frontend
        ↓ REST / JSON
ASP.NET Core Web API
        ↓
Service layer
        ↓
Entity Framework Core
        ↓
SQL Server
```

## 2. Workspace architecture

Separate surfaces/layouts:

- Public / booking
- `/account` — Guest Workspace
- `/owner` — Property Workspace
- `/admin` — Admin Workspace

Users may switch workspaces without duplicate identities.

## 3. Identity model

There is one canonical `User`.

Guest, Property Owner, Manager, Reception, Accounting staff, and platform Admin are behaviors/access contexts of that User, not separate identity tables.

## 4. Property authorization

```text
User
↓
UserPropertyAccess (membership)
↓
Property role + saved Permission Matrix
↓
Property Workspace capability
```

Platform roles are global only and must not grant Property access by themselves.

Role provides initial/default permissions; saved permissions are authoritative afterward.

## 5. Layering rules

### Backend

- Business logic in Services.
- Controllers remain thin: authorization/validation/mapping/response.
- Entities are persistence models, not UI models.
- Request/response/summary DTOs are separate.
- Important workflows use transactions.
- EF Core migrations are the schema source of truth.

### Frontend

- Presentation, local UI state, server-state/API interaction.
- No duplicated backend business calculations.
- Reuse shared components before feature-specific alternatives.

## 6. Core domain services

Existing domain/service areas include:

- Pricing / calendar pricing
- Promotions
- Booking / reservation workflow
- Commission resolution/calculation
- Payment processing / manual verification
- Voucher issuance/projection
- Settlement management
- Settlement receipt/history queries

`CouponEngine` remains a future extension unless/until implemented.

## 7. Calendar and inventory

Calendar-based data is authoritative for day-specific pricing, capacity, and availability.

The inventory model supports:

- Named physical rooms
- Pooled room-type inventory

Reservation/availability operations must respect the selected inventory model and existing calendar rules.

## 8. Financial architecture

### Historical truth

Financial and document history must not be silently recalculated from mutable live configuration.

Current persisted concepts include:

- `ReservationFinancialSnapshot`
- `FinancialEntry` append-only ledger
- `PropertyPayable`
- `Settlement`
- `SettlementItem`
- `SettlementPaymentRecord`
- `ReservationVoucher`

### Commission

Commission is resolved from:

1. enabled Property override for the same commission type, otherwise
2. global commission policy.

Commission base is the actually paid amount. Monetary values use scale 2; rounding follows the current finance policy (`AwayFromZero`).

### Settlement

Settlement timing uses one global policy:

```text
Base = CheckIn | CheckOut
PayableDueDate = BaseDate + SettlementOffsetDays
```

The due date is snapshotted on creation of the payable obligation. Later policy changes are non-retroactive.

Settlement batches:

- belong to one Property
- use one currency
- have public reference `S-XXXXXX`
- may be cancelled before payment, releasing active allocations while keeping history
- may be settled early only through explicit early-settlement intent
- become Paid through a persisted immutable `SettlementPaymentRecord`

### Stable Settlement Receipt sources

- Property name: `SettlementPaymentRecord.PropertyNameSnapshot`
- Reservation reference: `SettlementItem.ReservationNumberSnapshot`
- item due date: persisted `FinancialEntry.PayableDueDate`
- payment facts: `SettlementPaymentRecord`
- amount/currency: persisted Settlement/SettlementItem values

Do not fall back to mutable live Property/Reservation values for historical receipts.

## 9. Public references

- Order: `O-XXXXXX`
- Reservation: `R-XXXXXX`
- Voucher: `V-XXXXXX`
- Settlement: `S-XXXXXX`

Internal numeric primary keys remain internal.

## 10. Shared UI architecture

Use the existing design system and shared primitives:

- KoochButton
- KoochDialog
- KoochConfirmDialog
- KoochAlert
- KoochTable family
- KoochTableFilterDialog
- shared form controls/date controls

All new UI must be RTL-first, responsive, accessible, and theme-aware.

## 11. Reuse rule

```text
Reuse
↓
Extend
↓
Create
```

No broad refactor without a specific architecture decision.

## 12. Future architecture

Potential future extensions:

- wallet/coupons
- notifications
- refund/reversal/adjustment workflows
- OTA / channel manager
- cloud/local synchronization
- multi-branch expansion
