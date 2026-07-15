using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class BackfillCanonicalOwnerMemberships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DECLARE @OwnerPermissionMatrix nvarchar(max) = N'{
                  "Dashboard":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Properties":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Rooms":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Pricing":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Inventory":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Bookings":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Reviews":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Users":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Financial":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Reports":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true},
                  "Settings":{"View":true,"Create":true,"Edit":true,"Delete":true,"Export":true}
                }';

                IF EXISTS
                (
                    SELECT required.Id
                    FROM (VALUES (1), (2), (3), (4), (5), (1005), (1006)) AS required(Id)
                    WHERE NOT EXISTS
                    (
                        SELECT 1
                        FROM Properties AS property
                        WHERE property.Id = required.Id
                          AND property.IsDeleted = 0
                    )
                )
                BEGIN
                    THROW 51000, N'AUTH-A5B cannot continue because a mapped property is missing or deleted.', 1;
                END;

                IF EXISTS
                (
                    SELECT required.Id
                    FROM (VALUES (1), (1004), (1011)) AS required(Id)
                    WHERE NOT EXISTS
                    (
                        SELECT 1
                        FROM Users AS account
                        WHERE account.Id = required.Id
                          AND account.IsDeleted = 0
                    )
                )
                BEGIN
                    THROW 51001, N'AUTH-A5B cannot continue because a mapped owner account is missing or deleted.', 1;
                END;

                IF EXISTS
                (
                    SELECT 1
                    FROM Properties
                    WHERE (Id = 5 AND OwnerId NOT IN (1, 1011))
                       OR (Id = 1006 AND OwnerId NOT IN (1, 1004))
                       OR (Id IN (1, 2, 3, 4, 1005) AND OwnerId <> 1)
                )
                BEGIN
                    THROW 51002, N'AUTH-A5B ownership mapping conflicts with the current Property.OwnerId values.', 1;
                END;

                UPDATE Properties
                SET OwnerId = CASE Id
                    WHEN 5 THEN 1011
                    WHEN 1006 THEN 1004
                    ELSE OwnerId
                END
                WHERE (Id = 5 AND OwnerId = 1)
                   OR (Id = 1006 AND OwnerId = 1);

                DECLARE @OwnershipConflicts nvarchar(max);

                SELECT @OwnershipConflicts = STRING_AGG(
                    CONVERT(nvarchar(max), CONCAT(
                        N'PropertyId=', property.Id,
                        N', ExpectedOwnerId=', property.OwnerId,
                        N', MembershipId=', access.Id,
                        N', ConflictingUserId=', access.UserId)),
                    N'; ')
                FROM Properties AS property
                INNER JOIN UserPropertyAccesses AS access
                    ON access.PropertyId = property.Id
                WHERE property.IsDeleted = 0
                  AND access.IsDeleted = 0
                  AND access.PropertyRole = 0
                  AND access.Status = 1
                  AND access.IsActive = 1
                  AND access.UserId <> property.OwnerId;

                IF @OwnershipConflicts IS NOT NULL
                BEGIN
                    DECLARE @ConflictMessage nvarchar(2048) = LEFT(
                        CONCAT(N'AUTH-A5B found a different active PropertyOwner membership. ', @OwnershipConflicts),
                        2048);
                    THROW 51003, @ConflictMessage, 1;
                END;

                IF EXISTS
                (
                    SELECT 1
                    FROM Properties AS property
                    INNER JOIN UserPropertyAccesses AS access
                        ON access.PropertyId = property.Id
                       AND access.UserId = property.OwnerId
                    WHERE property.IsDeleted = 0
                      AND access.IsDeleted = 1
                )
                BEGIN
                    THROW 51004, N'AUTH-A5B found a deleted membership for a mapped owner; manual review is required.', 1;
                END;

                -- Preserve an existing valid matrix. Only missing/invalid matrices receive
                -- the canonical full owner matrix.
                UPDATE access
                SET access.PropertyRole = 0,
                    access.Status = 1,
                    access.IsActive = 1,
                    access.PermissionMatrixJson = CASE
                        WHEN ISJSON(access.PermissionMatrixJson) = 1
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Dashboard') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Properties') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Rooms') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Pricing') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Inventory') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Bookings') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Reviews') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Users') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Financial') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Reports') IS NOT NULL
                         AND JSON_QUERY(access.PermissionMatrixJson, '$.Settings') IS NOT NULL
                            THEN access.PermissionMatrixJson
                        ELSE @OwnerPermissionMatrix
                    END
                FROM UserPropertyAccesses AS access
                INNER JOIN Properties AS property
                    ON property.Id = access.PropertyId
                   AND property.OwnerId = access.UserId
                WHERE property.IsDeleted = 0
                  AND access.IsDeleted = 0;

                INSERT INTO UserPropertyAccesses
                (
                    UserId,
                    PropertyId,
                    CanManageProperty,
                    CanManageRooms,
                    CanManageAvailability,
                    CanManagePricing,
                    CanManageReservations,
                    CanManagePayments,
                    CanManageReviews,
                    CanManageNotifications,
                    CanViewReports,
                    Status,
                    PropertyRole,
                    PermissionMatrixJson,
                    IsActive,
                    CreatedAtUtc,
                    IsDeleted
                )
                SELECT
                    property.OwnerId,
                    property.Id,
                    1, 1, 1, 1, 1, 1, 1, 1, 1,
                    1,
                    0,
                    @OwnerPermissionMatrix,
                    1,
                    SYSUTCDATETIME(),
                    0
                FROM Properties AS property
                WHERE property.IsDeleted = 0
                  AND NOT EXISTS
                  (
                      SELECT 1
                      FROM UserPropertyAccesses AS access
                      WHERE access.UserId = property.OwnerId
                        AND access.PropertyId = property.Id
                  );

                IF EXISTS
                (
                    SELECT 1
                    FROM Properties AS property
                    WHERE property.IsDeleted = 0
                      AND
                      (
                          SELECT COUNT(*)
                          FROM UserPropertyAccesses AS access
                          WHERE access.UserId = property.OwnerId
                            AND access.PropertyId = property.Id
                            AND access.PropertyRole = 0
                            AND access.Status = 1
                            AND access.IsActive = 1
                            AND access.IsDeleted = 0
                            AND ISJSON(access.PermissionMatrixJson) = 1
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Dashboard') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Properties') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Rooms') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Pricing') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Inventory') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Bookings') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Reviews') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Users') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Financial') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Reports') IS NOT NULL
                            AND JSON_QUERY(access.PermissionMatrixJson, '$.Settings') IS NOT NULL
                      ) <> 1
                )
                BEGIN
                    THROW 51005, N'AUTH-A5B canonical owner membership verification failed.', 1;
                END;

                IF EXISTS
                (
                    SELECT 1
                    FROM Properties
                    WHERE (Id = 5 AND OwnerId <> 1011)
                       OR (Id = 1006 AND OwnerId <> 1004)
                       OR (Id IN (1, 2, 3, 4, 1005) AND OwnerId <> 1)
                )
                BEGIN
                    THROW 51006, N'AUTH-A5B final ownership mapping verification failed.', 1;
                END;

                DECLARE @User1011IsActive bit =
                    (SELECT IsActive FROM Users WHERE Id = 1011);
                PRINT CONCAT(
                    N'AUTH-A5B: User 1011 global IsActive=',
                    CONVERT(nvarchar(5), @User1011IsActive),
                    N'; account status was not changed.');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                THROW 51009, N'AUTH-A5B is intentionally irreversible because owner memberships cannot be deleted safely.', 1;
                """);
        }
    }
}
