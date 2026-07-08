using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationServiceFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NotificationLogs_Users_UserId",
                table: "NotificationLogs");

            migrationBuilder.RenameColumn(
                name: "UserId",
                table: "NotificationLogs",
                newName: "RecipientUserId");

            migrationBuilder.RenameColumn(
                name: "ErrorMessage",
                table: "NotificationLogs",
                newName: "Error");

            migrationBuilder.RenameColumn(
                name: "Channel",
                table: "NotificationLogs",
                newName: "Channels");

            migrationBuilder.RenameIndex(
                name: "IX_NotificationLogs_UserId",
                table: "NotificationLogs",
                newName: "IX_NotificationLogs_RecipientUserId");

            migrationBuilder.AddColumn<string>(
                name: "DataJson",
                table: "NotificationLogs",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "NotificationLogs",
                type: "nvarchar(320)",
                maxLength: 320,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Mobile",
                table: "NotificationLogs",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RecipientGuestId",
                table: "NotificationLogs",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Subject",
                table: "NotificationLogs",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE NotificationLogs
                SET Channels = CASE Channels
                    WHEN 0 THEN 2
                    WHEN 1 THEN 4
                    WHEN 2 THEN 1
                    ELSE 0
                END
                """);

            migrationBuilder.Sql(
                """
                UPDATE NotificationSubscriptions
                SET Channel = CASE Channel
                    WHEN 0 THEN 2
                    WHEN 1 THEN 4
                    WHEN 2 THEN 1
                    ELSE 0
                END
                """);

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_RecipientGuestId",
                table: "NotificationLogs",
                column: "RecipientGuestId");

            migrationBuilder.AddForeignKey(
                name: "FK_NotificationLogs_Guests_RecipientGuestId",
                table: "NotificationLogs",
                column: "RecipientGuestId",
                principalTable: "Guests",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_NotificationLogs_Users_RecipientUserId",
                table: "NotificationLogs",
                column: "RecipientUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NotificationLogs_Guests_RecipientGuestId",
                table: "NotificationLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_NotificationLogs_Users_RecipientUserId",
                table: "NotificationLogs");

            migrationBuilder.DropIndex(
                name: "IX_NotificationLogs_RecipientGuestId",
                table: "NotificationLogs");

            migrationBuilder.Sql(
                """
                UPDATE NotificationLogs
                SET Channels = CASE Channels
                    WHEN 2 THEN 0
                    WHEN 4 THEN 1
                    WHEN 1 THEN 2
                    ELSE 0
                END
                """);

            migrationBuilder.Sql(
                """
                UPDATE NotificationSubscriptions
                SET Channel = CASE Channel
                    WHEN 2 THEN 0
                    WHEN 4 THEN 1
                    WHEN 1 THEN 2
                    ELSE 0
                END
                """);

            migrationBuilder.DropColumn(
                name: "DataJson",
                table: "NotificationLogs");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "NotificationLogs");

            migrationBuilder.DropColumn(
                name: "Mobile",
                table: "NotificationLogs");

            migrationBuilder.DropColumn(
                name: "RecipientGuestId",
                table: "NotificationLogs");

            migrationBuilder.DropColumn(
                name: "Subject",
                table: "NotificationLogs");

            migrationBuilder.RenameColumn(
                name: "RecipientUserId",
                table: "NotificationLogs",
                newName: "UserId");

            migrationBuilder.RenameColumn(
                name: "Error",
                table: "NotificationLogs",
                newName: "ErrorMessage");

            migrationBuilder.RenameColumn(
                name: "Channels",
                table: "NotificationLogs",
                newName: "Channel");

            migrationBuilder.RenameIndex(
                name: "IX_NotificationLogs_RecipientUserId",
                table: "NotificationLogs",
                newName: "IX_NotificationLogs_UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_NotificationLogs_Users_UserId",
                table: "NotificationLogs",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id");
        }
    }
}
