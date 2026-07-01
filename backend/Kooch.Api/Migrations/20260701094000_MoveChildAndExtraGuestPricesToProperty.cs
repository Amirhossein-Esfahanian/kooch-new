using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class MoveChildAndExtraGuestPricesToProperty : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ;WITH ChildValues AS (
                    SELECT rt.PropertyId, MAX(rdp.ChildPrice) AS ChildPrice
                    FROM RoomDailyPrices rdp
                    INNER JOIN RoomTypes rt ON rt.Id = rdp.RoomTypeId
                    WHERE rdp.ChildPrice > 0
                    GROUP BY rt.PropertyId
                    HAVING COUNT(DISTINCT rdp.ChildPrice) = 1
                )
                UPDATE p
                SET ChildPrice = cv.ChildPrice
                FROM Properties p
                INNER JOIN ChildValues cv ON cv.PropertyId = p.Id
                WHERE p.ChildPrice IS NULL;
                """);

            migrationBuilder.Sql("""
                ;WITH ExtraGuestValues AS (
                    SELECT rt.PropertyId, MAX(rdp.ExtraGuestPrice) AS ExtraGuestPrice
                    FROM RoomDailyPrices rdp
                    INNER JOIN RoomTypes rt ON rt.Id = rdp.RoomTypeId
                    WHERE rdp.ExtraGuestPrice > 0
                    GROUP BY rt.PropertyId
                    HAVING COUNT(DISTINCT rdp.ExtraGuestPrice) = 1
                )
                UPDATE p
                SET ExtraGuestPrice = egv.ExtraGuestPrice
                FROM Properties p
                INNER JOIN ExtraGuestValues egv ON egv.PropertyId = p.Id
                WHERE p.ExtraGuestPrice IS NULL;
                """);

            migrationBuilder.DropColumn(
                name: "ChildPrice",
                table: "RoomDailyPrices");

            migrationBuilder.DropColumn(
                name: "ExtraGuestPrice",
                table: "RoomDailyPrices");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ChildPrice",
                table: "RoomDailyPrices",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "ExtraGuestPrice",
                table: "RoomDailyPrices",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.Sql("""
                UPDATE rdp
                SET ChildPrice = COALESCE(p.ChildPrice, 0),
                    ExtraGuestPrice = COALESCE(p.ExtraGuestPrice, 0)
                FROM RoomDailyPrices rdp
                INNER JOIN RoomTypes rt ON rt.Id = rdp.RoomTypeId
                INNER JOIN Properties p ON p.Id = rt.PropertyId;
                """);
        }
    }
}
