# Kooch Backlog

Last reviewed: 2026-09-28
Status: Living document

Statuses:

- ✅ Completed
- 🚧 In progress / partially complete
- ⏳ Planned
- ⛔ Blocked / decision required

Priorities:

- P0 — correctness / security / financial integrity
- P1 — next product capability
- P2 — polish / follow-up

## Completed foundations

| ID | Priority | Status | Category | Item |
|---|---|---|---|---|
| ARCH-01 | P0 | ✅ | Architecture | One User identity model |
| ARCH-02 | P0 | ✅ | Architecture | Property Membership / `UserPropertyAccess` |
| ARCH-03 | P0 | ✅ | Authorization | Permission Matrix |
| ARCH-04 | P0 | ✅ | Workspace | Guest / Owner / Admin workspace architecture |
| AUTH-01 | P0 | ✅ | Authentication | Login / OTP / session |
| UI-01 | P1 | ✅ | Shared UI | Core shared components and reusable table family |
| PROP-01 | P1 | ✅ | Property | Property management, rooms, amenities, members |
| PRICE-01 | P0 | ✅ | Pricing | Calendar-driven pricing/capacity/availability foundation |
| RES-01 | P0 | ✅ | Reservation | Reservation workflow foundation / payment-gated confirmation |

## Payments / Voucher

| ID | Priority | Status | Category | Item |
|---|---|---|---|---|
| PAY-01 | P0 | ✅ | Payments | Successful payment financialization |
| PAY-02 | P0 | ✅ | Payments | Manual payment domain + Admin create/approve/reject workflow |
| VOU-01 | P0 | ✅ | Voucher | Persisted immutable ReservationVoucher |
| VOU-02 | P1 | ✅ | Voucher | Guest / Property / Admin voucher projections |
| VOU-03 | P1 | ✅ | Voucher | Shared printable RTL/A4 voucher UI |
| PRIV-01 | P0 | ✅ | Privacy | Property guest-phone visibility setting and server enforcement |

## Finance / Settlement

| ID | Priority | Status | Category | Item |
|---|---|---|---|---|
| FIN-01 | P0 | ✅ | Finance | `ReservationFinancialSnapshot` + append-only `FinancialEntry` ledger |
| FIN-02 | P0 | ✅ | Finance | Commission policy, types, Property overrides, calculator/resolver |
| FIN-03 | P0 | ✅ | Finance | Persist reservation commission classification |
| FIN-04 | P0 | ✅ | Finance | Create PropertyPayable on successful payment |
| SET-01 | P0 | ✅ | Settlement | Global settlement policy + snapshotted `PayableDueDate` |
| SET-02 | P0 | ✅ | Settlement | Admin settlement create/detail/list/payables flow |
| SET-03 | P0 | ✅ | Settlement | Server-side filter/sort support |
| SET-04 | P0 | ✅ | Settlement | Cancellation + payable release/history preservation |
| SET-05 | P0 | ✅ | Settlement | Public Settlement reference `S-XXXXXX` |
| SET-06 | P0 | ✅ | Settlement | Immutable `SettlementPaymentRecord` |
| SET-07 | P0 | ✅ | Settlement | Property name snapshot at payment time |
| SET-08 | P0 | ✅ | Settlement | Reservation reference snapshot on SettlementItem |
| SET-09 | P1 | ✅ | Settlement | Admin/Property printable Settlement Receipt |
| SET-10 | P1 | ✅ | Settlement | Property Settlement History with `financial.view` |

## Candidate next finance work

These are planned candidates, not automatic commitments. Choose one explicitly before implementation.

| ID | Priority | Status | Category | Item |
|---|---|---|---|---|
| FIN-N01 | P1 | ⏳ | Notifications | Settlement-paid notification delivery/logging; delivery failure must never alter Paid state |
| FIN-R01 | P0 | ⏳ | Finance | Reversal / Adjustment model for corrections to Paid financial history |
| FIN-R02 | P0 | ⏳ | Refund | Refund workflow with append-only financial effects |
| FIN-C01 | P0 | ⏳ | Cancellation | Connect reservation cancellation/refund to explicit financial adjustments without rewriting original payment/settlement history |
| FIN-O01 | P2 | ⏳ | Owner UX | Owner finance/reporting polish beyond Settlement history |

## Other product roadmap

| ID | Priority | Status | Category | Item |
|---|---|---|---|---|
| GUEST-01 | P1 | 🚧 | Guest Workspace | Continue Guest workspace expansion |
| REPORT-01 | P1 | ⏳ | Reports | Analytical reporting; keep separate from operational Finance |
| PROMO-01 | P1 | 🚧 | Promotions | Promotion/rate-plan improvements as required |
| WALLET-01 | P2 | ⏳ | Future | Wallet |
| COUPON-01 | P2 | ⏳ | Future | Coupons |
| OTA-01 | P2 | ⏳ | Future | OTA / Channel Manager |

## Migration / technical debt

| ID | Priority | Status | Category | Item |
|---|---|---|---|---|
| MIG-01 | P0 | ⏳ | Migration | Verify environment application status of recent snapshot migrations before relying on a specific deployed DB |
| MIG-02 | P1 | ⏳ | Migration | Keep orphan source-only migrations non-discoverable until an explicit archive/removal plan is approved |
| MIG-03 | P1 | ⏳ | Migration | Verify current deployment status of `20260716090000_FixRoomDailyPriceHistoryPropertyIds`; do not infer from documentation |

## Rules for backlog updates

- A feature moves to Completed only after code + focused verification succeeds.
- Migration source creation and migration application are separate statuses.
- Do not mark a database migration applied unless the target environment application was explicitly confirmed.
- Financial history changes require explicit product semantics before implementation.
