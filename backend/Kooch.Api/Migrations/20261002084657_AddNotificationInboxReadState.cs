using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationInboxReadState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NotificationLogs_RecipientUserId",
                table: "NotificationLogs");

            migrationBuilder.AddColumn<DateTime>(
                name: "ReadAtUtc",
                table: "NotificationLogs",
                type: "datetime2",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_RecipientUserId_CreatedAtUtc_Id",
                table: "NotificationLogs",
                columns: new[] { "RecipientUserId", "CreatedAtUtc", "Id" },
                descending: new[] { false, true, true });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NotificationLogs_RecipientUserId_CreatedAtUtc_Id",
                table: "NotificationLogs");

            migrationBuilder.DropColumn(
                name: "ReadAtUtc",
                table: "NotificationLogs");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_RecipientUserId",
                table: "NotificationLogs",
                column: "RecipientUserId");
        }
    }
}
