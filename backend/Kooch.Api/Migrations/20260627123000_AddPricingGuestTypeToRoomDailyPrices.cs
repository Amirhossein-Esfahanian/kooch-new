using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    public partial class AddPricingGuestTypeToRoomDailyPrices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GuestType",
                table: "RoomDailyPrices",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Iranian");

            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPrices_RoomTypeId_Date",
                table: "RoomDailyPrices");

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPrices_RoomTypeId_Date_GuestType",
                table: "RoomDailyPrices",
                columns: new[] { "RoomTypeId", "Date", "GuestType" },
                unique: true);

            migrationBuilder.AddColumn<string>(
                name: "GuestType",
                table: "RoomDailyPriceHistory",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Iranian");

            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPriceHistory_RoomTypeId_ChangedAtUtc",
                table: "RoomDailyPriceHistory");

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPriceHistory_RoomTypeId_GuestType_ChangedAtUtc",
                table: "RoomDailyPriceHistory",
                columns: new[] { "RoomTypeId", "GuestType", "ChangedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPriceHistory_RoomTypeId_GuestType_ChangedAtUtc",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "GuestType",
                table: "RoomDailyPriceHistory");

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPriceHistory_RoomTypeId_ChangedAtUtc",
                table: "RoomDailyPriceHistory",
                columns: new[] { "RoomTypeId", "ChangedAtUtc" });

            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPrices_RoomTypeId_Date_GuestType",
                table: "RoomDailyPrices");

            migrationBuilder.DropColumn(
                name: "GuestType",
                table: "RoomDailyPrices");

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPrices_RoomTypeId_Date",
                table: "RoomDailyPrices",
                columns: new[] { "RoomTypeId", "Date" },
                unique: true);
        }
    }
}
