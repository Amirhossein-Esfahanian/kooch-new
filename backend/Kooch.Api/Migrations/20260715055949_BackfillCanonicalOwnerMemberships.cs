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

                DECLARE @MissingOwners nvarchar(max);

                SELECT @MissingOwners = STRING_AGG(
                    CONVERT(nvarchar(max), CONCAT(
                        N'PropertyId=', property.Id,
                        N', OwnerId=', property.OwnerId)),
                    N'; ')
                FROM Properties AS property
                LEFT JOIN Users AS owner
                    ON owner.Id = property.OwnerId
                   AND owner.IsDeleted = 0
                WHERE property.IsDeleted = 0
                  AND owner.Id IS NULL;

                IF @MissingOwners IS NOT NULL
                BEGIN
                    DECLARE @MissingOwnerMessage nvarchar(2048) = LEFT(
                        CONCAT(N'AUTH-A5B cannot continue because a Property.OwnerId user is missing or deleted. ', @MissingOwners),
                        2048);
                    THROW 51001, @MissingOwnerMessage, 1;
                END;

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
                    THROW 51004, N'AUTH-A5B found a deleted membership for a canonical owner; manual review is required.', 1;
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

                DECLARE @VerifiedPropertyCount int =
                (
                    SELECT COUNT(*)
                    FROM Properties AS property
                    WHERE property.IsDeleted = 0
                );

                PRINT CONCAT(
                    N'AUTH-A5B: canonical owner memberships verified for ',
                    CONVERT(nvarchar(20), @VerifiedPropertyCount),
                    N' existing non-deleted properties.');
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
