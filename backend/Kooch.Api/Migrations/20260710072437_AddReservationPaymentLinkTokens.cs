using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationPaymentLinkTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReservationPaymentLinkTokens",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    TokenHash = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UsedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
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
                    table.PrimaryKey("PK_ReservationPaymentLinkTokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReservationPaymentLinkTokens_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationPaymentLinkTokens_ReservationId_UsedAtUtc_ExpiresAtUtc",
                table: "ReservationPaymentLinkTokens",
                columns: new[] { "ReservationId", "UsedAtUtc", "ExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationPaymentLinkTokens_TokenHash",
                table: "ReservationPaymentLinkTokens",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReservationPaymentLinkTokens");
        }
    }
}
