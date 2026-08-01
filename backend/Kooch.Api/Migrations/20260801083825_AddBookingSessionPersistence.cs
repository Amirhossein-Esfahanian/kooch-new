using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingSessionPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BookingSessionId",
                table: "Reservations",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BookingSessions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SessionCode = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ClientId = table.Column<int>(type: "int", nullable: false),
                    GuestId = table.Column<int>(type: "int", nullable: true),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    RequestHash = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
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
                    table.PrimaryKey("PK_BookingSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookingSessions_Guests_GuestId",
                        column: x => x.GuestId,
                        principalTable: "Guests",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_BookingSessions_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_BookingSessions_Users_ClientId",
                        column: x => x.ClientId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_BookingSessionId",
                table: "Reservations",
                column: "BookingSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingSessions_ClientId",
                table: "BookingSessions",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingSessions_ClientId_IdempotencyKey",
                table: "BookingSessions",
                columns: new[] { "ClientId", "IdempotencyKey" },
                unique: true,
                filter: "[IdempotencyKey] IS NOT NULL AND [IdempotencyKey] <> ''");

            migrationBuilder.CreateIndex(
                name: "IX_BookingSessions_GuestId",
                table: "BookingSessions",
                column: "GuestId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingSessions_PropertyId",
                table: "BookingSessions",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingSessions_SessionCode",
                table: "BookingSessions",
                column: "SessionCode",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Reservations_BookingSessions_BookingSessionId",
                table: "Reservations",
                column: "BookingSessionId",
                principalTable: "BookingSessions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Reservations_BookingSessions_BookingSessionId",
                table: "Reservations");

            migrationBuilder.DropTable(
                name: "BookingSessions");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_BookingSessionId",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "BookingSessionId",
                table: "Reservations");
        }
    }
}
