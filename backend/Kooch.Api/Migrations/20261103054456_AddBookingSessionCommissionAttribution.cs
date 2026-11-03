using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingSessionCommissionAttribution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CommissionType",
                table: "BookingSessions",
                type: "int",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_BookingSessions_CommissionType",
                table: "BookingSessions",
                sql: "[CommissionType] IS NULL OR [CommissionType] IN (0, 1, 2)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_BookingSessions_CommissionType",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "CommissionType",
                table: "BookingSessions");
        }
    }
}
