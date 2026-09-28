# EF Core Migration Audit Notes

Original audit last updated: 2026-07-16
Documentation review: 2026-09-28

This note preserves the migration cleanup decisions from the AUTH-C7 through AUTH-C10 audits and adds later migration-safety context. It is documentation-only: do not edit `__EFMigrationsHistory` manually and do not make orphan source-only files discoverable.

## Why `__EFMigrationsHistory` must not be edited manually

`__EFMigrationsHistory` is EF Core's record of what actually ran against a database. Manual edits break the contract between the database and repository:

- removing a row can make EF try to re-run schema/data migrations that already ran;
- inserting a row can make EF skip changes that never ran;
- changing order or ids makes generated rollback/upgrade scripts unreliable;
- environments can silently drift because EF can no longer prove which migrations shaped the schema.

If a migration history/source mismatch is found, fix repository source or add an explicit corrective migration. Do not directly edit migration-history rows.

## Source-only orphan migrations

The following nine files are source-only migration fragments. EF does not discover them as migrations because they do not have matching generated designer metadata and are not present in `__EFMigrationsHistory`.

They must never be made discoverable in place. Making them discoverable now could execute old, duplicate, or partially superseded operations on existing/new databases.

Keep these files untouched until a dedicated migration archive/removal plan is approved.

| Source-only file | Superseded by discovered migration | Decision |
|---|---|---|
| `backend/Kooch.Api/Migrations/20260701090000_AddPropertyIdToRoomDailyPriceHistory.cs` | Schema shape superseded by `20260701072620_Pricingchangesreport`; intended RoomType-based data correction handled separately by `20260716090000_FixRoomDailyPriceHistoryPropertyIds`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260701091000_ExpandRoomDailyPriceHistory.cs` | Superseded by `20260701072620_Pricingchangesreport`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260701094000_MoveChildAndExtraGuestPricesToProperty.cs` | Schema superseded by `20260701080116_AddPropertyChildAndExtraGuestPrices` and `20260701101236_pricehistoryedit`; old data-copy SQL was not recorded as an applied discovered migration. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702090000_AddPropertyUsersFoundation.cs` | Folded into `20260702174114_usermanager`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702093000_AddPropertyUserPermissionMatrix.cs` | Folded into `20260702174114_usermanager`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702100000_AddAuditLogs.cs` | Folded into `20260702174114_usermanager`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702190000_AddPasswordSetupFlow.cs` | Superseded by `20260703084423_usermanagerchanges`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260703093000_AddMobileOtpCodes.cs` | Superseded by `20260703091153_usermanagerotp`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260703100000_AddUniqueUserMobileIndex.cs` | Superseded by `20260703093458_usermanagerpreventrepeate`. | Keep source-only. Do not add designer/metadata. |

## Restored no-op migration

`20260708074233_guestaddedforreservation` existed in database history but its source was missing from the repository.

Decision:

- restore a discovered migration source with exact id `20260708074233_guestaddedforreservation`;
- keep `Up` and `Down` as no-op;
- include EF metadata and designer file;
- use the immediately preceding discovered model-snapshot relationship as the safest historical target model;
- do not edit existing database history.

Effect:

- existing databases skip it because their `__EFMigrationsHistory` already contains the id;
- new databases record this id and continue to `20260708090000_AddGuests`, `20260708100000_AddReservationGuest`, and `20260708103000_AddReservationNumber`;
- repository migration discovery is aligned with the known history row.

## Historical data-fix migration

`20260716090000_FixRoomDailyPriceHistoryPropertyIds` was documented as pending in the 2026-07-16 audit.

Purpose:

- correct historical `RoomDailyPriceHistory.PropertyId` values where they do not match canonical `RoomTypes.PropertyId`;
- update only mismatched rows;
- preserve RoomTypeId, prices, dates, guest type, actor fields, and timestamps;
- throw if mismatched rows reference missing/deleted room types or canonical properties;
- print affected history ids and old/new Property ids when applied.

**Current review note:** this document does not contain later confirmation that this migration was applied to every target database. Verify deployment state before relying on it; do not infer application from source existence.

## September finance migrations / schema history

The project has since added finance/settlement migrations. Known migration source names from the current development history include:

- `20260925144256_AddReservationVoucherFoundation`
- `20260926125158_AddPropertyGuestPhoneVisibility`
- `20260927075502_AddSettlementFoundation`
- `20260927181449_AddSettlementCancellation`
- `20260928045054_AddSettlementPublicReference`
- `20260928052014_AddSettlementPaymentRecord`
- `20260928055131_AddSettlementPaymentPropertyNameSnapshot`
- `20260928061755_AddSettlementItemReservationNumberSnapshot`

Known project-development notes indicate the earlier settlement/public-reference/payment-record migrations were applied during development. The two later snapshot migrations were created and validated, but this documentation review does **not** independently prove application to every target database.

Before release/deployment, verify the target environment using normal EF tooling rather than assumptions:

```powershell
dotnet ef migrations list
dotnet ef database update
```

Do not manually insert/delete migration-history rows.

## Settlement public-reference migration note

`20260928045054_AddSettlementPublicReference` originally contained a SQL Server expression that mixed incompatible numeric types in a bitwise `&` operation during backfill. The unapplied migration source was corrected before successful application; no extra corrective migration was needed for that development database.

Do not reintroduce the incompatible expression when rebuilding or editing historical migration source.

## Historical snapshot migration policy

For fields whose purpose is historical stability (for example Property name or Reservation public reference in Settlement documents):

- nullable columns may be required for legacy compatibility;
- do not backfill from mutable live values unless a deliberate, auditable product/data decision proves that backfill is valid;
- new records must capture the snapshot at the defined business event;
- legacy missing snapshots should remain explicitly unavailable rather than silently reconstructed.

## Cleanup policy

- Do not delete the nine orphan source-only files until the project has an agreed archive/removal policy.
- Do not add designer files or `[Migration]` metadata to those orphan files.
- Do not use those orphan files as the basis for generated migration scripts.
- Treat discovered migrations plus explicit corrective migrations as the source of truth.
- Keep this note updated when migration cleanup decisions change.
- Treat migration **creation**, **source discovery**, and **database application** as separate statuses.
