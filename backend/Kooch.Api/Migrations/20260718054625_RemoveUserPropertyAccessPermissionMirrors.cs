using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUserPropertyAccessPermissionMirrors : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DECLARE @InvalidMatrixIds nvarchar(max) = (
                    SELECT STRING_AGG(CONVERT(nvarchar(max), [Id]), N',') WITHIN GROUP (ORDER BY [Id])
                    FROM [UserPropertyAccesses]
                    WHERE [IsDeleted] = CAST(0 AS bit)
                      AND (
                          [PermissionMatrixJson] IS NULL
                          OR LTRIM(RTRIM([PermissionMatrixJson])) = N''
                          OR ISJSON([PermissionMatrixJson]) <> 1
                          OR LTRIM(RTRIM([PermissionMatrixJson])) IN (N'{}', N'[]')
                      )
                );

                IF @InvalidMatrixIds IS NOT NULL
                BEGIN
                    DECLARE @InvalidMatrixMessage nvarchar(max) = CONCAT(
                        N'AUTH-D8B cannot remove UserPropertyAccess legacy permission mirror columns because non-deleted memberships have invalid or empty PermissionMatrixJson. Membership IDs: ',
                        @InvalidMatrixIds);
                    THROW 51030, @InvalidMatrixMessage, 1;
                END;

                DECLARE @LegacyMirrorIds nvarchar(max) = (
                    SELECT STRING_AGG(CONVERT(nvarchar(max), [Id]), N',') WITHIN GROUP (ORDER BY [Id])
                    FROM [UserPropertyAccesses]
                    WHERE [CanManageProperty] = CAST(1 AS bit)
                       OR [CanManageRooms] = CAST(1 AS bit)
                       OR [CanManageAvailability] = CAST(1 AS bit)
                       OR [CanManagePricing] = CAST(1 AS bit)
                       OR [CanManageReservations] = CAST(1 AS bit)
                       OR [CanManagePayments] = CAST(1 AS bit)
                       OR [CanManageReviews] = CAST(1 AS bit)
                       OR [CanManageNotifications] = CAST(1 AS bit)
                       OR [CanViewReports] = CAST(1 AS bit)
                );

                PRINT CONCAT(N'AUTH-D8B UserPropertyAccess legacy permission mirror true membership ids: ', COALESCE(@LegacyMirrorIds, N'(none)'));
                """);

            migrationBuilder.DropColumn(
                name: "CanManageAvailability",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanManageNotifications",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanManagePayments",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanManagePricing",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanManageProperty",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanManageReservations",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanManageReviews",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanManageRooms",
                table: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "CanViewReports",
                table: "UserPropertyAccesses");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CanManageAvailability",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanManageNotifications",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanManagePayments",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanManagePricing",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanManageProperty",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanManageReservations",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanManageReviews",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanManageRooms",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanViewReports",
                table: "UserPropertyAccesses",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }
    }
}
