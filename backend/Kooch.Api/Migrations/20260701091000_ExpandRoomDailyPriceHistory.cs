using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class ExpandRoomDailyPriceHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "UserId",
                table: "RoomDailyPriceHistory",
                newName: "ChangedByUserId");

            migrationBuilder.RenameColumn(
                name: "OldPrice",
                table: "RoomDailyPriceHistory",
                newName: "OldBasePrice");

            migrationBuilder.RenameColumn(
                name: "NewPrice",
                table: "RoomDailyPriceHistory",
                newName: "NewBasePrice");

            migrationBuilder.RenameColumn(
                name: "AffectedStartDate",
                table: "RoomDailyPriceHistory",
                newName: "AffectedDateFrom");

            migrationBuilder.RenameColumn(
                name: "AffectedEndDate",
                table: "RoomDailyPriceHistory",
                newName: "AffectedDateTo");

            migrationBuilder.RenameIndex(
                name: "IX_RoomDailyPriceHistory_UserId",
                table: "RoomDailyPriceHistory",
                newName: "IX_RoomDailyPriceHistory_ChangedByUserId");

            migrationBuilder.AddColumn<decimal>(
                name: "OldChildPrice",
                table: "RoomDailyPriceHistory",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "NewChildPrice",
                table: "RoomDailyPriceHistory",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "OldExtraGuestPrice",
                table: "RoomDailyPriceHistory",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "NewExtraGuestPrice",
                table: "RoomDailyPriceHistory",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OldChildPrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "NewChildPrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "OldExtraGuestPrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "NewExtraGuestPrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.RenameIndex(
                name: "IX_RoomDailyPriceHistory_ChangedByUserId",
                table: "RoomDailyPriceHistory",
                newName: "IX_RoomDailyPriceHistory_UserId");

            migrationBuilder.RenameColumn(
                name: "ChangedByUserId",
                table: "RoomDailyPriceHistory",
                newName: "UserId");

            migrationBuilder.RenameColumn(
                name: "OldBasePrice",
                table: "RoomDailyPriceHistory",
                newName: "OldPrice");

            migrationBuilder.RenameColumn(
                name: "NewBasePrice",
                table: "RoomDailyPriceHistory",
                newName: "NewPrice");

            migrationBuilder.RenameColumn(
                name: "AffectedDateFrom",
                table: "RoomDailyPriceHistory",
                newName: "AffectedStartDate");

            migrationBuilder.RenameColumn(
                name: "AffectedDateTo",
                table: "RoomDailyPriceHistory",
                newName: "AffectedEndDate");
        }
    }
}
