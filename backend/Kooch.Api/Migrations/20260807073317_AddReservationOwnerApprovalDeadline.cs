using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationOwnerApprovalDeadline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ApprovalExpiresAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_Status_ApprovalExpiresAtUtc",
                table: "Reservations",
                columns: new[] { "Status", "ApprovalExpiresAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Reservations_Status_ApprovalExpiresAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "ApprovalExpiresAtUtc",
                table: "Reservations");
        }
    }
}
