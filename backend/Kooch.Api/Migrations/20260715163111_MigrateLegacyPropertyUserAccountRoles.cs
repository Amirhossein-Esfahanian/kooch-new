using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class MigrateLegacyPropertyUserAccountRoles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DECLARE @LegacyOwnerRole int = 2;
                DECLARE @LegacyOwnerAssistantRole int = 3;
                DECLARE @ClientRole int = 4;
                DECLARE @PropertyOwnerRole int = 0;
                DECLARE @ActiveMembershipStatus int = 1;

                IF EXISTS
                (
                    SELECT 1
                    FROM Properties AS property
                    INNER JOIN Users AS ownerAccount
                        ON ownerAccount.Id = property.OwnerId
                    WHERE property.IsDeleted = 0
                      AND ownerAccount.IsDeleted = 0
                      AND ownerAccount.Role IN (@LegacyOwnerRole, @LegacyOwnerAssistantRole)
                      AND
                      (
                          SELECT COUNT(*)
                          FROM UserPropertyAccesses AS access
                          WHERE access.UserId = property.OwnerId
                            AND access.PropertyId = property.Id
                            AND access.PropertyRole = @PropertyOwnerRole
                            AND access.Status = @ActiveMembershipStatus
                            AND access.IsActive = 1
                            AND access.IsDeleted = 0
                      ) <> 1
                )
                BEGIN
                    THROW 51020, N'AUTH-C3 cannot convert legacy owner account roles because a property owner is missing exactly one active canonical PropertyOwner membership.', 1;
                END;

                DECLARE @ConvertedUserIds nvarchar(max);

                SELECT @ConvertedUserIds = STRING_AGG(CONVERT(nvarchar(max), Id), N', ')
                FROM Users
                WHERE Role IN (@LegacyOwnerRole, @LegacyOwnerAssistantRole);

                IF @ConvertedUserIds IS NULL
                BEGIN
                    PRINT N'AUTH-C3: no legacy Owner or OwnerAssistant account roles found.';
                END
                ELSE
                BEGIN
                    PRINT CONCAT(N'AUTH-C3: converting legacy Owner/OwnerAssistant account roles to Client for UserIds: ', @ConvertedUserIds);
                END;

                UPDATE Users
                SET Role = @ClientRole
                WHERE Role IN (@LegacyOwnerRole, @LegacyOwnerAssistantRole);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                THROW 51029, N'AUTH-C3 is intentionally irreversible because previous legacy account roles are not tracked separately.', 1;
                """);
        }
    }
}
