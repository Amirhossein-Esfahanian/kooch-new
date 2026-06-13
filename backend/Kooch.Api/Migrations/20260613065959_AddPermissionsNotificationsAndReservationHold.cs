using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPermissionsNotificationsAndReservationHold : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Reservations_RoomTypeId_CheckInDate_CheckOutDate",
                table: "Reservations");

            migrationBuilder.AddColumn<bool>(
                name: "CanBeRestricted",
                table: "Users",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "CanManageUsers",
                table: "Users",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ParentUserId",
                table: "Users",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ConfirmedAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ExpiredAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "HoldUntilUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaidAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Status",
                table: "Availabilities",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql(
                """
                UPDATE [Users]
                SET [Role] = CASE [Role]
                    WHEN 0 THEN 0
                    WHEN 1 THEN 2
                    WHEN 2 THEN 4
                    ELSE [Role]
                END,
                [CanManageUsers] = CASE WHEN [Role] = 0 THEN 1 ELSE [CanManageUsers] END,
                [CanBeRestricted] = CASE WHEN [Role] = 0 THEN 0 ELSE [CanBeRestricted] END;
                """);

            migrationBuilder.CreateTable(
                name: "NotificationLogs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: true),
                    PropertyId = table.Column<int>(type: "int", nullable: true),
                    ReservationId = table.Column<int>(type: "int", nullable: true),
                    EventType = table.Column<int>(type: "int", nullable: false),
                    Channel = table.Column<int>(type: "int", nullable: false),
                    Recipient = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Message = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    SentAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ErrorMessage = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
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
                    table.PrimaryKey("PK_NotificationLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NotificationLogs_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_NotificationLogs_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_NotificationLogs_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "NotificationSubscriptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    PropertyId = table.Column<int>(type: "int", nullable: true),
                    EventType = table.Column<int>(type: "int", nullable: false),
                    Channel = table.Column<int>(type: "int", nullable: false),
                    IsEnabled = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
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
                    table.PrimaryKey("PK_NotificationSubscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NotificationSubscriptions_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_NotificationSubscriptions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Permissions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Key = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
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
                    table.PrimaryKey("PK_Permissions", x => x.Id);
                    table.UniqueConstraint("AK_Permissions_Key", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "UserPermissions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    PermissionKey = table.Column<int>(type: "int", nullable: false),
                    IsAllowed = table.Column<bool>(type: "bit", nullable: false),
                    PropertyId = table.Column<int>(type: "int", nullable: true),
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
                    table.PrimaryKey("PK_UserPermissions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserPermissions_Permissions_PermissionKey",
                        column: x => x.PermissionKey,
                        principalTable: "Permissions",
                        principalColumn: "Key");
                    table.ForeignKey(
                        name: "FK_UserPermissions_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_UserPermissions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Users_ParentUserId",
                table: "Users",
                column: "ParentUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_RoomTypeId_CheckInDate_CheckOutDate_Status",
                table: "Reservations",
                columns: new[] { "RoomTypeId", "CheckInDate", "CheckOutDate", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_Status_HoldUntilUtc",
                table: "Reservations",
                columns: new[] { "Status", "HoldUntilUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Availabilities_RoomTypeId_Date_Status",
                table: "Availabilities",
                columns: new[] { "RoomTypeId", "Date", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_PropertyId",
                table: "NotificationLogs",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_ReservationId",
                table: "NotificationLogs",
                column: "ReservationId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_SentAtUtc",
                table: "NotificationLogs",
                column: "SentAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_Status",
                table: "NotificationLogs",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationLogs_UserId",
                table: "NotificationLogs",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationSubscriptions_PropertyId",
                table: "NotificationSubscriptions",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationSubscriptions_UserId_PropertyId_EventType_Channel",
                table: "NotificationSubscriptions",
                columns: new[] { "UserId", "PropertyId", "EventType", "Channel" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissions_PermissionKey",
                table: "UserPermissions",
                column: "PermissionKey");

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissions_PropertyId",
                table: "UserPermissions",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissions_UserId_PermissionKey_PropertyId",
                table: "UserPermissions",
                columns: new[] { "UserId", "PermissionKey", "PropertyId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Users_ParentUserId",
                table: "Users",
                column: "ParentUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Users_Users_ParentUserId",
                table: "Users");

            migrationBuilder.DropTable(
                name: "NotificationLogs");

            migrationBuilder.DropTable(
                name: "NotificationSubscriptions");

            migrationBuilder.DropTable(
                name: "UserPermissions");

            migrationBuilder.DropTable(
                name: "Permissions");

            migrationBuilder.DropIndex(
                name: "IX_Users_ParentUserId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_RoomTypeId_CheckInDate_CheckOutDate_Status",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_Status_HoldUntilUtc",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Availabilities_RoomTypeId_Date_Status",
                table: "Availabilities");

            migrationBuilder.Sql(
                """
                UPDATE [Users]
                SET [Role] = CASE [Role]
                    WHEN 0 THEN 0
                    WHEN 1 THEN 0
                    WHEN 2 THEN 1
                    WHEN 3 THEN 1
                    WHEN 4 THEN 2
                    ELSE [Role]
                END;
                """);

            migrationBuilder.DropColumn(
                name: "CanBeRestricted",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CanManageUsers",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "ParentUserId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CancelledAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "ConfirmedAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "ExpiredAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "HoldUntilUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "PaidAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Availabilities");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_RoomTypeId_CheckInDate_CheckOutDate",
                table: "Reservations",
                columns: new[] { "RoomTypeId", "CheckInDate", "CheckOutDate" });
        }
    }
}
