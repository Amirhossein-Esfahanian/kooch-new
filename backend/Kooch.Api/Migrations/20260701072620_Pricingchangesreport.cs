using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class Pricingchangesreport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RoomDailyPriceHistory_Users_UserId",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPriceHistory_UserId",
                table: "RoomDailyPriceHistory");

            migrationBuilder.RenameColumn(
                name: "UserId",
                table: "RoomDailyPriceHistory",
                newName: "PropertyId");

            migrationBuilder.RenameColumn(
                name: "OldPrice",
                table: "RoomDailyPriceHistory",
                newName: "OldExtraGuestPrice");

            migrationBuilder.RenameColumn(
                name: "NewPrice",
                table: "RoomDailyPriceHistory",
                newName: "OldChildPrice");

            migrationBuilder.RenameColumn(
                name: "AffectedStartDate",
                table: "RoomDailyPriceHistory",
                newName: "AffectedDateTo");

            migrationBuilder.RenameColumn(
                name: "AffectedEndDate",
                table: "RoomDailyPriceHistory",
                newName: "AffectedDateFrom");

            migrationBuilder.AddColumn<int>(
                name: "ChangedByUserId",
                table: "RoomDailyPriceHistory",
                type: "int",
                nullable: true
                );

            migrationBuilder.AddColumn<decimal>(
                name: "NewBasePrice",
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
                name: "NewExtraGuestPrice",
                table: "RoomDailyPriceHistory",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "OldBasePrice",
                table: "RoomDailyPriceHistory",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPriceHistory_ChangedByUserId",
                table: "RoomDailyPriceHistory",
                column: "ChangedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPriceHistory_PropertyId_ChangedAtUtc",
                table: "RoomDailyPriceHistory",
                columns: new[] { "PropertyId", "ChangedAtUtc" });

            migrationBuilder.AddForeignKey(
                name: "FK_RoomDailyPriceHistory_Users_ChangedByUserId",
                table: "RoomDailyPriceHistory",
                column: "ChangedByUserId",
                principalTable: "Users",
                principalColumn: "Id",onDelete: ReferentialAction.NoAction);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RoomDailyPriceHistory_Users_ChangedByUserId",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPriceHistory_ChangedByUserId",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPriceHistory_PropertyId_ChangedAtUtc",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "ChangedByUserId",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "NewBasePrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "NewChildPrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "NewExtraGuestPrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "OldBasePrice",
                table: "RoomDailyPriceHistory");

            migrationBuilder.RenameColumn(
                name: "PropertyId",
                table: "RoomDailyPriceHistory",
                newName: "UserId");

            migrationBuilder.RenameColumn(
                name: "OldExtraGuestPrice",
                table: "RoomDailyPriceHistory",
                newName: "OldPrice");

            migrationBuilder.RenameColumn(
                name: "OldChildPrice",
                table: "RoomDailyPriceHistory",
                newName: "NewPrice");

            migrationBuilder.RenameColumn(
                name: "AffectedDateTo",
                table: "RoomDailyPriceHistory",
                newName: "AffectedStartDate");

            migrationBuilder.RenameColumn(
                name: "AffectedDateFrom",
                table: "RoomDailyPriceHistory",
                newName: "AffectedEndDate");

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPriceHistory_UserId",
                table: "RoomDailyPriceHistory",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_RoomDailyPriceHistory_Users_UserId",
                table: "RoomDailyPriceHistory",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id");
        }
    }
}
