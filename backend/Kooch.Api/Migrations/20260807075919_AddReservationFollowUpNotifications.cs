using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationFollowUpNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DedupeKey",
                table: "NotificationLogs",
                type: "nvarchar(240)",
                maxLength: 240,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PropertyReservationFollowUpRecipients",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PropertyReservationFollowUpRecipients", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PropertyReservationFollowUpRecipients_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_PropertyReservationFollowUpRecipients_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_DedupeKey",
                table: "NotificationLogs",
                column: "DedupeKey",
                unique: true,
                filter: "[DedupeKey] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PropertyReservationFollowUpRecipients_PropertyId_IsActive",
                table: "PropertyReservationFollowUpRecipients",
                columns: new[] { "PropertyId", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_PropertyReservationFollowUpRecipients_PropertyId_UserId",
                table: "PropertyReservationFollowUpRecipients",
                columns: new[] { "PropertyId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PropertyReservationFollowUpRecipients_UserId",
                table: "PropertyReservationFollowUpRecipients",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PropertyReservationFollowUpRecipients");

            migrationBuilder.DropIndex(
                name: "IX_NotificationLogs_DedupeKey",
                table: "NotificationLogs");

            migrationBuilder.DropColumn(
                name: "DedupeKey",
                table: "NotificationLogs");
        }
    }
}
