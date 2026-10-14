using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGuestNationalityIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Guests_NationalCode",
                table: "Guests");

            migrationBuilder.DropIndex(
                name: "IX_Guests_PassportNumber",
                table: "Guests");

            migrationBuilder.CreateIndex(
                name: "IX_Guests_NationalCode",
                table: "Guests",
                column: "NationalCode",
                unique: true,
                filter: "[NationalCode] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Guests_Nationality_PassportNumber",
                table: "Guests",
                columns: new[] { "Nationality", "PassportNumber" },
                unique: true,
                filter: "[Nationality] IS NOT NULL AND [PassportNumber] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Guests_NationalCode",
                table: "Guests");

            migrationBuilder.DropIndex(
                name: "IX_Guests_Nationality_PassportNumber",
                table: "Guests");

            migrationBuilder.CreateIndex(
                name: "IX_Guests_NationalCode",
                table: "Guests",
                column: "NationalCode");

            migrationBuilder.CreateIndex(
                name: "IX_Guests_PassportNumber",
                table: "Guests",
                column: "PassportNumber");
        }
    }
}
