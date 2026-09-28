# Kooch Database Model — Current Working Draft

Last reviewed: 2026-09-28
Status: Living technical summary; EF Core model/migrations remain authoritative

> This document is a high-level model summary. Exact columns, constraints, enums, and indexes must be verified against the current EF Core entities/configuration and model snapshot before schema work.

## Shared persistence principles

- SQL Server + Entity Framework Core.
- Monetary values use `decimal(18,2)` unless a narrower type is explicitly configured.
- Historical business/financial records should not be cascade-deleted.
- Important financial/reservation state changes are transactional.
- Mutable live configuration must not silently rewrite historical snapshots/documents.
- EF migrations, not this document, are the schema source of truth.

## Identity / access

### User

One canonical identity for every person.

A User may participate in multiple workspaces and Properties.

### UserPropertyAccess / Membership

Property authorization is membership-based and stores/evaluates Property role + effective Permission Matrix.

Platform roles are global only and must not replace Property membership authorization.

## Property / inventory

The system supports both:

- `NamedRooms` — physical named rooms
- `TypeBasedInventory` — pooled room-type inventory

Core concepts include:

- Property
- RoomType
- Room
- Availability / calendar rows
- property/room images
- amenities
- destinations and related discovery metadata

Daily Availability/Calendar values are authoritative for day-specific sellable inventory and pricing; base prices are fallback/reference values where the current pricing model allows it.

## Reservation

Reservation is attached to the canonical User and Property/room inventory context.

Historical reservation values include immutable pricing/payment-facing snapshots where required so later pricing-rule changes do not rewrite the booking that was actually made.

Public reservation reference:

```text
R-XXXXXX
```

Booking/order reference:

```text
O-XXXXXX
```

## Payment

Payment supports at least the current Online / Manual channel distinction.

Manual payment evidence/metadata is stored separately and verified by authorized Admin workflow.

A reservation is Confirmed only after verified successful payment.

A successful payment is also the trigger for financial recognition and voucher issuance.

## Reservation Voucher

`ReservationVoucher` is a persisted immutable reservation document/projection source.

Public voucher reference:

```text
V-XXXXXX
```

Voucher is not a settlement receipt.

## Commission

Current concepts include:

- Commission type/classification on Reservation
- global commission policy
- Property commission-rate override
- resolver/calculator

Property override for the same commission type wins when enabled; otherwise global policy applies.

Commission base is the actually paid amount. Current financial rounding uses midpoint rounding AwayFromZero.

## Reservation financialization

### ReservationFinancialSnapshot

Immutable recognition snapshot for a successful payment/reservation allocation.

### FinancialEntry

Append-only ledger/history entry.

Current entry concepts include:

- PropertyPayable
- Commission (type reserved/available in the ledger model even where recognition policy avoids duplicate booking)
- Refund
- Adjustment
- Settlement
- Reversal

`PayableDueDate` is persisted/snapshotted on the payable entry and must not be recalculated from later settlement-policy changes.

## Settlement

Settlement is a Property-specific batch of payable obligations in one currency.

Public reference:

```text
S-XXXXXX
```

Key behavior:

- status lifecycle includes unpaid/due/overdue/paid/cancelled semantics
- default selection targets due/overdue obligations
- early settlement requires explicit intent
- cancellation preserves historical batch/items while releasing active allocations
- Paid settlements cannot be cancelled

### SettlementItem

Links one payable FinancialEntry to a Settlement.

Important historical snapshot:

- `ReservationNumberSnapshot`

This snapshot is captured when the item is allocated to the Settlement. Legacy null snapshots must not be reconstructed from live Reservation data for historical receipts.

### SettlementPaymentRecord

Zero/one immutable payment record per Settlement.

Current fields/semantics include:

- payment method
- reference/tracking number
- actual payment timestamp
- optional Admin note
- recorded-by / recorded-at system metadata
- `PropertyNameSnapshot`

`PropertyNameSnapshot` is captured at payment registration time. Legacy null values must not be fabricated from the current Property name.

## Settlement Receipt

No separate SettlementReceipt table is required in the current design.

The receipt is a read-only projection from persisted historical sources:

- `Settlement.SettlementNumber`
- `Settlement.TotalAmount`
- `Settlement.Currency`
- `SettlementPaymentRecord`
- `SettlementPaymentRecord.PropertyNameSnapshot`
- `SettlementItem.ReservationNumberSnapshot`
- persisted item amount
- persisted `FinancialEntry.PayableDueDate`

Receipt is available only when the required persisted historical data exists.

## Settlement Policy

One global settlement policy for all Properties:

- `SettlementBaseDate = CheckIn | CheckOut`
- `SettlementOffsetDays = signed integer`

```text
PayableDueDate = selected reservation base date + offset days
```

The result is snapshotted when PropertyPayable is created; policy changes are non-retroactive.

## Public reference family

| Domain | Public reference |
|---|---|
| Booking / Order | `O-XXXXXX` |
| Reservation | `R-XXXXXX` |
| Voucher | `V-XXXXXX` |
| Settlement | `S-XXXXXX` |

## Pricing / promotion extensions

Existing/legacy planning includes concepts such as:

- RatePlan
- Promotion
- StayRule
- CancellationPolicy
- MealPlan
- daily Availability pricing

Exact current implementation status should be checked in code before extending these areas.

## Deferred / next financial model work

Not yet treated as complete in this document:

- full Refund workflow
- Reversal / Adjustment correction flows for Paid history
- cancellation-linked financial effects
- notification delivery records

These should extend financial history append-only rather than overwrite original successful-payment or settlement records.
