using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class LinkRoomPriceHistoryToAuditLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AuditLogId",
                table: "RoomDailyPriceHistory",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_RoomDailyPriceHistory_AuditLogId_AffectedDateFrom_Id",
                table: "RoomDailyPriceHistory",
                columns: new[] { "AuditLogId", "AffectedDateFrom", "Id" });

            migrationBuilder.AddForeignKey(
                name: "FK_RoomDailyPriceHistory_AuditLogs_AuditLogId",
                table: "RoomDailyPriceHistory",
                column: "AuditLogId",
                principalTable: "AuditLogs",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RoomDailyPriceHistory_AuditLogs_AuditLogId",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropIndex(
                name: "IX_RoomDailyPriceHistory_AuditLogId_AffectedDateFrom_Id",
                table: "RoomDailyPriceHistory");

            migrationBuilder.DropColumn(
                name: "AuditLogId",
                table: "RoomDailyPriceHistory");
        }
    }
}
