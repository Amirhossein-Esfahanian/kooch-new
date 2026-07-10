using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationStatusChangeAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ChangedAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ChangedByUserId",
                table: "Reservations",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ChangedAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "ChangedByUserId",
                table: "Reservations");
        }
    }
}
