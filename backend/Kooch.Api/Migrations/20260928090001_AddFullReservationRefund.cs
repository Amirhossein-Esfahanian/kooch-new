using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFullReservationRefund : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_FinancialEntries_ReversesEntryId",
                table: "FinancialEntries");

            migrationBuilder.CreateTable(
                name: "RefundRecords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PaymentId = table.Column<int>(type: "int", nullable: false),
                    PaymentItemId = table.Column<int>(type: "int", nullable: true),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    ReservationFinancialSnapshotId = table.Column<int>(type: "int", nullable: true),
                    OriginalPropertyPayableEntryId = table.Column<int>(type: "int", nullable: true),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    RefundedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ReferenceNumber = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    RecordedByUserId = table.Column<int>(type: "int", nullable: false),
                    RecordedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    RequestFingerprint = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
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
                    table.PrimaryKey("PK_RefundRecords", x => x.Id);
                    table.CheckConstraint("CK_RefundRecords_PositiveAmount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_RefundRecords_FinancialEntries_OriginalPropertyPayableEntryId",
                        column: x => x.OriginalPropertyPayableEntryId,
                        principalTable: "FinancialEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RefundRecords_PaymentItems_PaymentItemId",
                        column: x => x.PaymentItemId,
                        principalTable: "PaymentItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RefundRecords_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RefundRecords_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RefundRecords_ReservationFinancialSnapshots_ReservationFinancialSnapshotId",
                        column: x => x.ReservationFinancialSnapshotId,
                        principalTable: "ReservationFinancialSnapshots",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RefundRecords_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RefundRecords_Users_RecordedByUserId",
                        column: x => x.RecordedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_ReversesEntryId",
                table: "FinancialEntries",
                column: "ReversesEntryId",
                unique: true,
                filter: "[EntryType] = 5 AND [ReversesEntryId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_IdempotencyKey",
                table: "RefundRecords",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_OriginalPropertyPayableEntryId",
                table: "RefundRecords",
                column: "OriginalPropertyPayableEntryId",
                unique: true,
                filter: "[OriginalPropertyPayableEntryId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_PaymentId_ReservationId",
                table: "RefundRecords",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_PaymentItemId",
                table: "RefundRecords",
                column: "PaymentItemId",
                unique: true,
                filter: "[PaymentItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_PropertyId",
                table: "RefundRecords",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_RecordedByUserId",
                table: "RefundRecords",
                column: "RecordedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_ReservationFinancialSnapshotId",
                table: "RefundRecords",
                column: "ReservationFinancialSnapshotId");

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_ReservationId",
                table: "RefundRecords",
                column: "ReservationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RefundRecords");

            migrationBuilder.DropIndex(
                name: "IX_FinancialEntries_ReversesEntryId",
                table: "FinancialEntries");

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_ReversesEntryId",
                table: "FinancialEntries",
                column: "ReversesEntryId");
        }
    }
}
