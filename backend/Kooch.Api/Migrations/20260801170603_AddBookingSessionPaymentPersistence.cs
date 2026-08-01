using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingSessionPaymentPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "ReservationId",
                table: "Payments",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<int>(
                name: "BookingSessionId",
                table: "Payments",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "RowVersion",
                table: "Payments",
                type: "rowversion",
                rowVersion: true,
                nullable: false,
                defaultValue: new byte[0]);

            migrationBuilder.CreateTable(
                name: "PaymentItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PaymentId = table.Column<int>(type: "int", nullable: false),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    AllocatedAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
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
                    table.PrimaryKey("PK_PaymentItems", x => x.Id);
                    table.CheckConstraint("CK_PaymentItem_PositiveAllocatedAmount", "[AllocatedAmount] > 0");
                    table.ForeignKey(
                        name: "FK_PaymentItems_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_PaymentItems_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Payments_BookingSessionId",
                table: "Payments",
                column: "BookingSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_Provider_TransactionReference",
                table: "Payments",
                columns: new[] { "Provider", "TransactionReference" },
                unique: true,
                filter: "[TransactionReference] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Payment_ExactlyOneParent",
                table: "Payments",
                sql: "([ReservationId] IS NOT NULL AND [BookingSessionId] IS NULL) OR ([ReservationId] IS NULL AND [BookingSessionId] IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentItems_PaymentId_ReservationId",
                table: "PaymentItems",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentItems_ReservationId",
                table: "PaymentItems",
                column: "ReservationId");

            migrationBuilder.AddForeignKey(
                name: "FK_Payments_BookingSessions_BookingSessionId",
                table: "Payments",
                column: "BookingSessionId",
                principalTable: "BookingSessions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Payments_BookingSessions_BookingSessionId",
                table: "Payments");

            migrationBuilder.DropTable(
                name: "PaymentItems");

            migrationBuilder.DropIndex(
                name: "IX_Payments_BookingSessionId",
                table: "Payments");

            migrationBuilder.DropIndex(
                name: "IX_Payments_Provider_TransactionReference",
                table: "Payments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Payment_ExactlyOneParent",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "BookingSessionId",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "RowVersion",
                table: "Payments");

            migrationBuilder.AlterColumn<int>(
                name: "ReservationId",
                table: "Payments",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);
        }
    }
}
