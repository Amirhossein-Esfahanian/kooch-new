using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddUserPropertyAccessAndConcurrency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<byte[]>(
                name: "RowVersion",
                table: "Reservations",
                type: "rowversion",
                rowVersion: true,
                nullable: false,
                defaultValue: new byte[0]);

            migrationBuilder.AddColumn<byte[]>(
                name: "RowVersion",
                table: "Availabilities",
                type: "rowversion",
                rowVersion: true,
                nullable: false,
                defaultValue: new byte[0]);

            migrationBuilder.CreateTable(
                name: "UserPropertyAccesses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    CanManageProperty = table.Column<bool>(type: "bit", nullable: false),
                    CanManageRooms = table.Column<bool>(type: "bit", nullable: false),
                    CanManageAvailability = table.Column<bool>(type: "bit", nullable: false),
                    CanManagePricing = table.Column<bool>(type: "bit", nullable: false),
                    CanManageReservations = table.Column<bool>(type: "bit", nullable: false),
                    CanManagePayments = table.Column<bool>(type: "bit", nullable: false),
                    CanManageReviews = table.Column<bool>(type: "bit", nullable: false),
                    CanManageNotifications = table.Column<bool>(type: "bit", nullable: false),
                    CanViewReports = table.Column<bool>(type: "bit", nullable: false),
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
                    table.PrimaryKey("PK_UserPropertyAccesses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserPropertyAccesses_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_UserPropertyAccesses_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserPropertyAccesses_PropertyId",
                table: "UserPropertyAccesses",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_UserPropertyAccesses_UserId_PropertyId",
                table: "UserPropertyAccesses",
                columns: new[] { "UserId", "PropertyId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserPropertyAccesses");

            migrationBuilder.DropColumn(
                name: "RowVersion",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "RowVersion",
                table: "Availabilities");
        }
    }
}
