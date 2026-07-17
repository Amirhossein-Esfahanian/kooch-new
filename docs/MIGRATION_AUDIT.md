# EF Core migration audit notes

Last updated: 2026-07-16

This note records the migration cleanup decisions from the AUTH-C7 through AUTH-C10 audits. It is intentionally documentation-only: do not edit `__EFMigrationsHistory` manually, do not apply migrations from this note, and do not make the orphan source-only files discoverable.

## Why `__EFMigrationsHistory` must not be edited manually

`__EFMigrationsHistory` is EF Core's record of what has actually run against a database. Manual edits break the contract between the database and the repository:

- removing a row can make EF try to re-run schema or data migrations that already ran;
- inserting a row can make EF skip schema or data changes that never ran;
- changing order or ids makes generated rollback/upgrade scripts unreliable;
- environments drift silently because EF can no longer prove which migrations shaped the schema.

If a migration history/source mismatch is found, fix repository source or add an explicit corrective migration. Do not directly edit migration history rows.

## Source-only orphan migrations

The following nine files are source-only migration fragments. EF does not discover them as migrations because they do not have matching generated designer metadata and are not present in `__EFMigrationsHistory`.

They must never be made discoverable in place. Making them discoverable now would cause EF to execute old, duplicate, or partially superseded operations on existing and new databases.

No safe archive location currently exists in the repository. Keep these files untouched until a dedicated migration archive/removal plan is approved.

| Source-only file | Superseded by discovered migration | Decision |
|---|---|---|
| `backend/Kooch.Api/Migrations/20260701090000_AddPropertyIdToRoomDailyPriceHistory.cs` | Schema shape superseded by `20260701072620_Pricingchangesreport`; its intended RoomType-based data correction is handled separately by `20260716090000_FixRoomDailyPriceHistoryPropertyIds`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260701091000_ExpandRoomDailyPriceHistory.cs` | Superseded by `20260701072620_Pricingchangesreport`, which introduced the discovered `RoomDailyPriceHistory` history-shape changes. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260701094000_MoveChildAndExtraGuestPricesToProperty.cs` | Schema superseded by `20260701080116_AddPropertyChildAndExtraGuestPrices` and `20260701101236_pricehistoryedit`. The old data-copy SQL was not recorded as an applied discovered migration. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702090000_AddPropertyUsersFoundation.cs` | Folded into `20260702174114_usermanager`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702093000_AddPropertyUserPermissionMatrix.cs` | Folded into `20260702174114_usermanager`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702100000_AddAuditLogs.cs` | Folded into `20260702174114_usermanager`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260702190000_AddPasswordSetupFlow.cs` | Superseded by `20260703084423_usermanagerchanges`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260703093000_AddMobileOtpCodes.cs` | Superseded by `20260703091153_usermanagerotp`. | Keep source-only. Do not add designer/metadata. |
| `backend/Kooch.Api/Migrations/20260703100000_AddUniqueUserMobileIndex.cs` | Superseded by `20260703093458_usermanagerpreventrepeate`. | Keep source-only. Do not add designer/metadata. |

## Restored no-op migration

`20260708074233_guestaddedforreservation` existed in database history but its source was missing from the repository.

Decision:

- restore a discovered migration source with the exact id `20260708074233_guestaddedforreservation`;
- keep `Up` and `Down` as no-op;
- include EF metadata and a designer file;
- use the immediately preceding discovered model snapshot relationship as the safest historical target model;
- do not edit existing database history.

Effect:

- existing databases skip it because their `__EFMigrationsHistory` already contains the id;
- new databases record this migration id and then continue to `20260708090000_AddGuests`, `20260708100000_AddReservationGuest`, and `20260708103000_AddReservationNumber`;
- repository migration discovery is again aligned with the known history row.

## Data-fix migration

`20260716090000_FixRoomDailyPriceHistoryPropertyIds` is a pending data-fix migration.

Purpose:

- correct historical `RoomDailyPriceHistory.PropertyId` values where they do not match the canonical `RoomTypes.PropertyId`;
- update only rows where `RoomDailyPriceHistory.PropertyId <> RoomTypes.PropertyId`;
- preserve `RoomTypeId`, prices, dates, guest type, actor fields, and timestamps;
- throw if mismatched rows reference missing/deleted room types or canonical properties;
- print the affected history ids and old/new property ids when applied.

This migration was added because `20260701072620_Pricingchangesreport` renamed the old `RoomDailyPriceHistory.UserId` column to `PropertyId`, while the source-only `20260701090000_AddPropertyIdToRoomDailyPriceHistory.cs` contained the safer RoomType-based property backfill that never became a discovered applied migration.

Do not apply this migration from documentation. Apply it only through the normal release/database update process.

## Cleanup policy

- Do not delete the nine orphan source-only files until the project has an agreed archive/removal policy.
- Do not add designer files or `[Migration]` metadata to those orphan files.
- Do not use those orphan files as a basis for generated migration scripts.
- Treat discovered migrations plus explicit corrective migrations as the source of truth.
- Keep this note updated when migration cleanup decisions change.
