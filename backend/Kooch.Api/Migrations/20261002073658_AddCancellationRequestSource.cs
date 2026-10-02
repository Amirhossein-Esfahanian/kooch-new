using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCancellationRequestSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RequestSource",
                table: "ReservationCancellationRequests",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "CK_ReservationCancellationRequests_RequestSource",
                table: "ReservationCancellationRequests",
                sql: "[RequestSource] IN (0, 1)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ReservationCancellationRequests_RequestSource",
                table: "ReservationCancellationRequests");

            migrationBuilder.DropColumn(
                name: "RequestSource",
                table: "ReservationCancellationRequests");
        }
    }
}
