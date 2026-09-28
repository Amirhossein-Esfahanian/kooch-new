using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCancellationFinancialResolution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CancellationFinancialResolutionId",
                table: "RefundRecords",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CancellationFinancialResolutions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    PaymentId = table.Column<int>(type: "int", nullable: false),
                    PaymentItemId = table.Column<int>(type: "int", nullable: true),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    ReservationFinancialSnapshotId = table.Column<int>(type: "int", nullable: false),
                    OriginalPropertyPayableEntryId = table.Column<int>(type: "int", nullable: false),
                    GrossPaidAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    GuestRefundAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    FinalPropertyShare = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    FinalKoochShare = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Mode = table.Column<int>(type: "int", nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    ResolvedByUserId = table.Column<int>(type: "int", nullable: false),
                    ResolvedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    RequestFingerprint = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ReversalFinancialEntryId = table.Column<int>(type: "int", nullable: true),
                    ReplacementPropertyPayableEntryId = table.Column<int>(type: "int", nullable: true),
                    ReleasedSettlementId = table.Column<int>(type: "int", nullable: true),
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
                    table.PrimaryKey("PK_CancellationFinancialResolutions", x => x.Id);
                    table.CheckConstraint("CK_CancellationFinancialResolutions_AllocationSum", "[GuestRefundAmount] + [FinalPropertyShare] + [FinalKoochShare] = [GrossPaidAmount]");
                    table.CheckConstraint("CK_CancellationFinancialResolutions_NonnegativeAmounts", "[GrossPaidAmount] >= 0 AND [GuestRefundAmount] >= 0 AND [FinalPropertyShare] >= 0 AND [FinalKoochShare] >= 0");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_FinancialEntries_OriginalPropertyPayableEntryId",
                        column: x => x.OriginalPropertyPayableEntryId,
                        principalTable: "FinancialEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_FinancialEntries_ReplacementPropertyPayableEntryId",
                        column: x => x.ReplacementPropertyPayableEntryId,
                        principalTable: "FinancialEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_FinancialEntries_ReversalFinancialEntryId",
                        column: x => x.ReversalFinancialEntryId,
                        principalTable: "FinancialEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_PaymentItems_PaymentItemId",
                        column: x => x.PaymentItemId,
                        principalTable: "PaymentItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_ReservationFinancialSnapshots_ReservationFinancialSnapshotId",
                        column: x => x.ReservationFinancialSnapshotId,
                        principalTable: "ReservationFinancialSnapshots",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_Settlements_ReleasedSettlementId",
                        column: x => x.ReleasedSettlementId,
                        principalTable: "Settlements",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationFinancialResolutions_Users_ResolvedByUserId",
                        column: x => x.ResolvedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_RefundRecords_CancellationFinancialResolutionId",
                table: "RefundRecords",
                column: "CancellationFinancialResolutionId",
                unique: true,
                filter: "[CancellationFinancialResolutionId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_IdempotencyKey",
                table: "CancellationFinancialResolutions",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_OriginalPropertyPayableEntryId",
                table: "CancellationFinancialResolutions",
                column: "OriginalPropertyPayableEntryId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_PaymentId_ReservationId",
                table: "CancellationFinancialResolutions",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_PaymentItemId",
                table: "CancellationFinancialResolutions",
                column: "PaymentItemId",
                unique: true,
                filter: "[PaymentItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_PropertyId",
                table: "CancellationFinancialResolutions",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ReleasedSettlementId",
                table: "CancellationFinancialResolutions",
                column: "ReleasedSettlementId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ReplacementPropertyPayableEntryId",
                table: "CancellationFinancialResolutions",
                column: "ReplacementPropertyPayableEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ReservationFinancialSnapshotId",
                table: "CancellationFinancialResolutions",
                column: "ReservationFinancialSnapshotId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ReservationId",
                table: "CancellationFinancialResolutions",
                column: "ReservationId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ResolvedByUserId",
                table: "CancellationFinancialResolutions",
                column: "ResolvedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ReversalFinancialEntryId",
                table: "CancellationFinancialResolutions",
                column: "ReversalFinancialEntryId");

            migrationBuilder.AddForeignKey(
                name: "FK_RefundRecords_CancellationFinancialResolutions_CancellationFinancialResolutionId",
                table: "RefundRecords",
                column: "CancellationFinancialResolutionId",
                principalTable: "CancellationFinancialResolutions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RefundRecords_CancellationFinancialResolutions_CancellationFinancialResolutionId",
                table: "RefundRecords");

            migrationBuilder.DropTable(
                name: "CancellationFinancialResolutions");

            migrationBuilder.DropIndex(
                name: "IX_RefundRecords_CancellationFinancialResolutionId",
                table: "RefundRecords");

            migrationBuilder.DropColumn(
                name: "CancellationFinancialResolutionId",
                table: "RefundRecords");
        }
    }
}
