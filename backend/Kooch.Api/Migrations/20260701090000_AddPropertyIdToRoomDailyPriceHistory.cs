using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPropertyIdToRoomDailyPriceHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PropertyId",
                table: "RoomDailyPriceHistory",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE history
                SET PropertyId = roomTypes.PropertyId
                FROM RoomDailyPriceHistory history
                INNER JOIN RoomTypes roomTypes ON roomTypes.Id = history.RoomTypeId
                """);

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPriceHistory_PropertyId_ChangedAtUtc",
                table: "RoomDailyPriceHistory",
                columns: new[] { "PropertyId", "ChangedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPriceHistory_PropertyId_ChangedAtUtc",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "PropertyId",
                table: "RoomDailyPriceHistory");
        }
    }
}
