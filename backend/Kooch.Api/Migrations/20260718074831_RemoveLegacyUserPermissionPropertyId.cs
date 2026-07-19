using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class RemoveLegacyUserPermissionPropertyId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DECLARE @NonNullIds nvarchar(max);

                SELECT @NonNullIds = STRING_AGG(CONVERT(nvarchar(max), [Id]), N',')
                FROM [UserPermissions]
                WHERE [PropertyId] IS NOT NULL;

                IF @NonNullIds IS NOT NULL
                BEGIN
                    DECLARE @ErrorMessage nvarchar(2048) = CONCAT(N'Cannot remove UserPermissions.PropertyId. Non-null row IDs: ', @NonNullIds);
                    THROW 51030, @ErrorMessage, 1;
                END;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_UserPermissions_Properties_PropertyId",
                table: "UserPermissions");

            migrationBuilder.DropIndex(
                name: "IX_UserPermissions_PropertyId",
                table: "UserPermissions");

            migrationBuilder.DropIndex(
                name: "IX_UserPermissions_UserId_PermissionKey_PropertyId",
                table: "UserPermissions");

            migrationBuilder.DropColumn(
                name: "PropertyId",
                table: "UserPermissions");

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissions_UserId_PermissionKey",
                table: "UserPermissions",
                columns: new[] { "UserId", "PermissionKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserPermissions_UserId_PermissionKey",
                table: "UserPermissions");

            migrationBuilder.AddColumn<int>(
                name: "PropertyId",
                table: "UserPermissions",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissions_PropertyId",
                table: "UserPermissions",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissions_UserId_PermissionKey_PropertyId",
                table: "UserPermissions",
                columns: new[] { "UserId", "PermissionKey", "PropertyId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_UserPermissions_Properties_PropertyId",
                table: "UserPermissions",
                column: "PropertyId",
                principalTable: "Properties",
                principalColumn: "Id");
        }
    }
}
