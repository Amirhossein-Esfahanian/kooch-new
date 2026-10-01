using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFundingAwareCancellationResolution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CancellationFinancialResolutions_PaymentId_ReservationId",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropIndex(
                name: "IX_CancellationFinancialResolutions_ReservationId",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CancellationFinancialResolutions_AllocationSum",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CancellationFinancialResolutions_NonnegativeAmounts",
                table: "CancellationFinancialResolutions");

            migrationBuilder.AlterColumn<int>(
                name: "PaymentId",
                table: "CancellationFinancialResolutions",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<decimal>(
                name: "ForfeitedAmount",
                table: "CancellationFinancialResolutions",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "GuestWalletRestoreAmount",
                table: "CancellationFinancialResolutions",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateTable(
                name: "CancellationCashRefundExecutions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CancellationFinancialResolutionId = table.Column<int>(type: "int", nullable: false),
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
                    table.PrimaryKey("PK_CancellationCashRefundExecutions", x => x.Id);
                    table.CheckConstraint("CK_CancellationCashRefundExecutions_Amount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_CancellationCashRefundExecutions_CancellationFinancialResolutions_CancellationFinancialResolutionId",
                        column: x => x.CancellationFinancialResolutionId,
                        principalTable: "CancellationFinancialResolutions",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationCashRefundExecutions_Users_RecordedByUserId",
                        column: x => x.RecordedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "CancellationSourceDispositions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CancellationFinancialResolutionId = table.Column<int>(type: "int", nullable: false),
                    PaymentId = table.Column<int>(type: "int", nullable: true),
                    PaymentItemId = table.Column<int>(type: "int", nullable: true),
                    ReservationWalletFundingAllocationId = table.Column<int>(type: "int", nullable: true),
                    RestoreWalletEntryId = table.Column<int>(type: "int", nullable: true),
                    FundedAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CashRefundAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    WalletRestoreAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    NotReturnedAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
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
                    table.PrimaryKey("PK_CancellationSourceDispositions", x => x.Id);
                    table.CheckConstraint("CK_CancellationSourceDispositions_Amounts", "[FundedAmount] > 0 AND [CashRefundAmount] >= 0 AND [WalletRestoreAmount] >= 0 AND [NotReturnedAmount] >= 0 AND [CashRefundAmount] + [WalletRestoreAmount] + [NotReturnedAmount] = [FundedAmount]");
                    table.CheckConstraint("CK_CancellationSourceDispositions_Source", "([PaymentId] IS NOT NULL AND [ReservationWalletFundingAllocationId] IS NULL AND [WalletRestoreAmount] = 0) OR ([PaymentId] IS NULL AND [PaymentItemId] IS NULL AND [ReservationWalletFundingAllocationId] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_CancellationSourceDispositions_CancellationFinancialResolutions_CancellationFinancialResolutionId",
                        column: x => x.CancellationFinancialResolutionId,
                        principalTable: "CancellationFinancialResolutions",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationSourceDispositions_PaymentItems_PaymentItemId",
                        column: x => x.PaymentItemId,
                        principalTable: "PaymentItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationSourceDispositions_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationSourceDispositions_ReservationWalletFundingAllocations_ReservationWalletFundingAllocationId",
                        column: x => x.ReservationWalletFundingAllocationId,
                        principalTable: "ReservationWalletFundingAllocations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CancellationSourceDispositions_WalletEntries_RestoreWalletEntryId",
                        column: x => x.RestoreWalletEntryId,
                        principalTable: "WalletEntries",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_PaymentId_ReservationId",
                table: "CancellationFinancialResolutions",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true,
                filter: "[PaymentId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ReservationId",
                table: "CancellationFinancialResolutions",
                column: "ReservationId",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_CancellationFinancialResolutions_AllocationSum",
                table: "CancellationFinancialResolutions",
                sql: "[GuestRefundAmount] + [GuestWalletRestoreAmount] + [ForfeitedAmount] + [FinalPropertyShare] + [FinalKoochShare] = [GrossPaidAmount]");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CancellationFinancialResolutions_NonnegativeAmounts",
                table: "CancellationFinancialResolutions",
                sql: "[GrossPaidAmount] >= 0 AND [GuestRefundAmount] >= 0 AND [GuestWalletRestoreAmount] >= 0 AND [ForfeitedAmount] >= 0 AND [FinalPropertyShare] >= 0 AND [FinalKoochShare] >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationCashRefundExecutions_CancellationFinancialResolutionId",
                table: "CancellationCashRefundExecutions",
                column: "CancellationFinancialResolutionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CancellationCashRefundExecutions_IdempotencyKey",
                table: "CancellationCashRefundExecutions",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CancellationCashRefundExecutions_RecordedByUserId",
                table: "CancellationCashRefundExecutions",
                column: "RecordedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationSourceDispositions_CancellationFinancialResolutionId_PaymentId",
                table: "CancellationSourceDispositions",
                columns: new[] { "CancellationFinancialResolutionId", "PaymentId" },
                unique: true,
                filter: "[PaymentId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationSourceDispositions_PaymentId",
                table: "CancellationSourceDispositions",
                column: "PaymentId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationSourceDispositions_PaymentItemId",
                table: "CancellationSourceDispositions",
                column: "PaymentItemId");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationSourceDispositions_ReservationWalletFundingAllocationId",
                table: "CancellationSourceDispositions",
                column: "ReservationWalletFundingAllocationId",
                unique: true,
                filter: "[ReservationWalletFundingAllocationId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CancellationSourceDispositions_RestoreWalletEntryId",
                table: "CancellationSourceDispositions",
                column: "RestoreWalletEntryId",
                unique: true,
                filter: "[RestoreWalletEntryId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CancellationCashRefundExecutions");

            migrationBuilder.DropTable(
                name: "CancellationSourceDispositions");

            migrationBuilder.DropIndex(
                name: "IX_CancellationFinancialResolutions_PaymentId_ReservationId",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropIndex(
                name: "IX_CancellationFinancialResolutions_ReservationId",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CancellationFinancialResolutions_AllocationSum",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CancellationFinancialResolutions_NonnegativeAmounts",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropColumn(
                name: "ForfeitedAmount",
                table: "CancellationFinancialResolutions");

            migrationBuilder.DropColumn(
                name: "GuestWalletRestoreAmount",
                table: "CancellationFinancialResolutions");

            migrationBuilder.AlterColumn<int>(
                name: "PaymentId",
                table: "CancellationFinancialResolutions",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_PaymentId_ReservationId",
                table: "CancellationFinancialResolutions",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CancellationFinancialResolutions_ReservationId",
                table: "CancellationFinancialResolutions",
                column: "ReservationId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CancellationFinancialResolutions_AllocationSum",
                table: "CancellationFinancialResolutions",
                sql: "[GuestRefundAmount] + [FinalPropertyShare] + [FinalKoochShare] = [GrossPaidAmount]");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CancellationFinancialResolutions_NonnegativeAmounts",
                table: "CancellationFinancialResolutions",
                sql: "[GrossPaidAmount] >= 0 AND [GuestRefundAmount] >= 0 AND [FinalPropertyShare] >= 0 AND [FinalKoochShare] >= 0");
        }
    }
}
