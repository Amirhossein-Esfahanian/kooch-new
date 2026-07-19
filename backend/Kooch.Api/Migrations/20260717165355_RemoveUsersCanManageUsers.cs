using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUsersCanManageUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DECLARE @CanManageUsersCount int = (
                    SELECT COUNT(*)
                    FROM [Users]
                    WHERE [CanManageUsers] = CAST(1 AS bit)
                );
                DECLARE @CanManageUsersIds nvarchar(max) = (
                    SELECT STRING_AGG(CONVERT(nvarchar(max), [Id]), N',') WITHIN GROUP (ORDER BY [Id])
                    FROM [Users]
                    WHERE [CanManageUsers] = CAST(1 AS bit)
                );

                PRINT CONCAT(N'AUTH-D8A Users.CanManageUsers true count: ', @CanManageUsersCount);
                PRINT CONCAT(N'AUTH-D8A Users.CanManageUsers true user ids: ', COALESCE(@CanManageUsersIds, N'(none)'));
                """);

            migrationBuilder.DropColumn(
                name: "CanManageUsers",
                table: "Users");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CanManageUsers",
                table: "Users",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }
    }
}
