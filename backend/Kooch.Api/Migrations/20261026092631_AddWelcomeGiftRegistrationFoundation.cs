using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWelcomeGiftRegistrationFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PendingRegistrationNationalCode",
                table: "Users",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftGrants_NationalCodeSnapshot_Lifetime",
                table: "WelcomeGiftGrants",
                column: "NationalCodeSnapshot",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftGrants_UserId_Lifetime",
                table: "WelcomeGiftGrants",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_WelcomeGiftGrants_NationalCodeSnapshot_Lifetime",
                table: "WelcomeGiftGrants");

            migrationBuilder.DropIndex(
                name: "IX_WelcomeGiftGrants_UserId_Lifetime",
                table: "WelcomeGiftGrants");

            migrationBuilder.DropColumn(
                name: "PendingRegistrationNationalCode",
                table: "Users");
        }
    }
}
