using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingSessionReceptionCoordination : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ReceptionCoordinationAcknowledgedAtUtc",
                table: "BookingSessions",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ReceptionCoordinationRequired",
                table: "BookingSessions",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReceptionCoordinationAcknowledgedAtUtc",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "ReceptionCoordinationRequired",
                table: "BookingSessions");
        }
    }
}
