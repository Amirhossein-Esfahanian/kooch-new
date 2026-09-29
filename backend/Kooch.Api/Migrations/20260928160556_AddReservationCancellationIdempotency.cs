using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationCancellationIdempotency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CancellationIdempotencyKey",
                table: "Reservations",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CancellationRequestFingerprint",
                table: "Reservations",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_CancellationIdempotencyKey",
                table: "Reservations",
                column: "CancellationIdempotencyKey",
                unique: true,
                filter: "[CancellationIdempotencyKey] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservations_CancellationIdempotencyPair",
                table: "Reservations",
                sql: "([CancellationIdempotencyKey] IS NULL AND [CancellationRequestFingerprint] IS NULL) OR ([CancellationIdempotencyKey] IS NOT NULL AND [CancellationRequestFingerprint] IS NOT NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Reservations_CancellationIdempotencyKey",
                table: "Reservations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservations_CancellationIdempotencyPair",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "CancellationIdempotencyKey",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "CancellationRequestFingerprint",
                table: "Reservations");
        }
    }
}
